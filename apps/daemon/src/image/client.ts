/**
 * @dforge/daemon · ComfyUI 客户端（本地 GPU 出图，未启动态是一等状态）。
 *
 * 接入方式（架构 v1.1 §4.5.6，ComfyUI 原生 HTTP，不改动用户安装）：
 * - 探测：`GET /system_stats`（存活）+ `GET /object_info`（节点与模型清单，TTL 缓存）；
 * - 提交：`POST /prompt`（模板注入后的 API 格式 workflow + client_id）→ prompt_id；
 * - 状态：`GET /history/{id}`（结果）+ `GET /queue`（排队/运行）；
 * - 取消：`POST /interrupt`（用户取消 = 静默非错误）；
 * - 取回：`GET /view`（字节 → sha256 → 落 `<dataRoot>/image/assets/<sha256>.<ext>`，哈希去重）。
 * 失败态一律结构化（comfy_unreachable / comfy_model_missing / comfy_oom / ...），
 * 消息与动作按架构 §5.5 表——前端据此给可操作提示。
 */

import { randomBytes, randomInt } from 'node:crypto';

import type {
  ComfyFailure,
  ComfyProbeResponse,
  ImageRunArtifact,
  ImageRunHandle,
  ImageRunProvenance,
  ImageRunRequest,
  ImageRunState,
  ImageRunStatus,
  ImageTemplate,
  ImageTemplatesResponse,
} from '@dforge/contracts';

import { ensureDir, sha256Hex, writeFileAtomic } from '../fs-atomic.ts';
import { applyParam, DEFAULT_TEMPLATE_ID, loadTemplates, selectTemplate } from './templates.ts';

/** 探测单次超时（本地回环：未启动时应快速失败）。 */
const PROBE_TIMEOUT_MS = 1500;
/** 提交/取结果的单次请求超时。 */
const REQUEST_TIMEOUT_MS = 15_000;

/** 客户端需要的最小配置视图（从 DaemonContext 读取，支持运行时改地址）。 */
export interface ComfyClientOptions {
  baseUrl: () => string;
  installPath: () => string | null;
  fetchImpl: typeof fetch;
  now: () => Date;
  templatesPath: string;
  assetsDir: string;
  probeTtlMs: number;
}

/** 提交结果（失败即结构化失败态）。 */
export type SubmitResult =
  | { ok: true; handle: ImageRunHandle; template: ImageTemplate; seed: number }
  | { ok: false; failure: ComfyFailure };

/** 客户端接口。 */
export interface ComfyClient {
  probe(options?: { force?: boolean }): Promise<ComfyProbeResponse>;
  templates(): Promise<ImageTemplatesResponse>;
  submit(request: ImageRunRequest): Promise<SubmitResult>;
  /** 已知任务状态（未知 runId 返回 null——路由映射 comfy_run_not_found）。 */
  status(runId: string): Promise<ImageRunStatus | null>;
  cancel(runId: string): Promise<ImageRunStatus | null>;
}

/** 本地任务登记（桩：进程内存；崩溃恢复与持久队列归 P4b）。 */
interface LocalRun {
  template: ImageTemplate;
  seed: number;
  positive: string;
  negative: string;
  checkpoint: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  controlnets: { name: string; strength: number }[];
  cancelRequested: boolean;
}

function unreachableFailure(baseUrl: string, installPath: string | null): ComfyFailure {
  const actions = ['retry-probe', 'set-base-url'];
  if (installPath !== null) actions.push('launch');
  return {
    code: 'comfy_unreachable',
    message: `未检测到本地 ComfyUI 服务（${baseUrl}）`,
    actions,
    missing: [],
    available: [],
  };
}

function missingModelFailure(missing: string[], available: string[]): ComfyFailure {
  return {
    code: 'comfy_model_missing',
    message: `模板引用的模型不存在：${missing.join('、') || '（未指定可用 checkpoint）'}`,
    actions: ['check-model-list'],
    missing,
    available,
  };
}

function timeoutFailure(message: string): ComfyFailure {
  return {
    code: 'comfy_timeout',
    message,
    actions: ['retry-later', 'adjust-params'],
    missing: [],
    available: [],
  };
}

/** 从 object_info 提取节点某字段的字符串清单（ComfyUI 形态：[清单, {...}]）。 */
function stringListAt(
  objectInfo: Record<string, unknown>,
  nodeClass: string,
  field: string,
): string[] {
  const node = objectInfo[nodeClass];
  if (typeof node !== 'object' || node === null) return [];
  const input = (node as Record<string, unknown>).input;
  if (typeof input !== 'object' || input === null) return [];
  const required = (input as Record<string, unknown>).required;
  if (typeof required !== 'object' || required === null) return [];
  const entry = (required as Record<string, unknown>)[field];
  if (!Array.isArray(entry)) return [];
  const values = entry[0];
  return Array.isArray(values)
    ? values.filter((item): item is string => typeof item === 'string')
    : [];
}

/** 创建 ComfyUI 客户端（fetchImpl 注入，测试用假上游）。 */
export function createComfyClient(options: ComfyClientOptions): ComfyClient {
  let cachedProbe: { at: number; baseUrl: string; result: ComfyProbeResponse } | null = null;
  const runs = new Map<string, LocalRun>();

  const probeInternal = async (): Promise<ComfyProbeResponse> => {
    const baseUrl = options.baseUrl();
    const checkedAt = options.now().toISOString();
    const cached = cachedProbe;
    if (
      cached !== null &&
      cached.baseUrl === baseUrl &&
      options.now().getTime() - cached.at < options.probeTtlMs
    ) {
      return cached.result;
    }

    let result: ComfyProbeResponse;
    try {
      const statsResponse = await options.fetchImpl(`${baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!statsResponse.ok) {
        result = {
          reachable: false,
          baseUrl,
          checkedAt,
          models: null,
          device: null,
          failure: unreachableFailure(baseUrl, options.installPath()),
        };
      } else {
        const stats = (await statsResponse.json().catch(() => null)) as unknown;
        const devices =
          typeof stats === 'object' &&
          stats !== null &&
          Array.isArray((stats as Record<string, unknown>).devices)
            ? ((stats as Record<string, unknown>).devices as unknown[])
            : [];
        const first = devices[0];
        const device =
          typeof first === 'object' && first !== null
            ? {
                name:
                  typeof (first as Record<string, unknown>).name === 'string'
                    ? ((first as Record<string, unknown>).name as string)
                    : null,
                vramTotalBytes:
                  typeof (first as Record<string, unknown>).vram_total === 'number'
                    ? ((first as Record<string, unknown>).vram_total as number)
                    : null,
              }
            : null;

        let models: ComfyProbeResponse['models'] = null;
        try {
          const infoResponse = await options.fetchImpl(`${baseUrl}/object_info`, {
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          });
          if (infoResponse.ok) {
            const info = (await infoResponse.json().catch(() => null)) as unknown;
            if (typeof info === 'object' && info !== null && !Array.isArray(info)) {
              const objectInfo = info as Record<string, unknown>;
              const checkpoints = [
                ...stringListAt(objectInfo, 'CheckpointLoaderSimple', 'ckpt_name'),
                ...stringListAt(objectInfo, 'CheckpointLoader', 'ckpt_name'),
              ];
              const loras = [
                ...stringListAt(objectInfo, 'LoraLoader', 'lora_name'),
                ...stringListAt(objectInfo, 'LoraLoaderModelOnly', 'lora_name'),
              ];
              const controlnets = stringListAt(objectInfo, 'ControlNetLoader', 'control_net_name');
              models = {
                checkpoints: [...new Set(checkpoints)],
                loras: [...new Set(loras)],
                controlnets: [...new Set(controlnets)],
              };
            }
          }
        } catch {
          // object_info 失败不判定不可达（仅模型清单未知）
        }

        result = { reachable: true, baseUrl, checkedAt, models, device, failure: null };
      }
    } catch {
      result = {
        reachable: false,
        baseUrl,
        checkedAt,
        models: null,
        device: null,
        failure: unreachableFailure(baseUrl, options.installPath()),
      };
    }

    cachedProbe = { at: options.now().getTime(), baseUrl, result };
    return result;
  };

  const fetchJson = async (
    url: string,
    init: RequestInit,
  ): Promise<
    | { ok: true; json: unknown }
    | { ok: false; reason: 'unreachable' | 'timeout' | 'http'; status?: number; body?: unknown }
  > => {
    try {
      const response = await options.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        return { ok: false, reason: 'http', status: response.status, body };
      }
      const json = await response.json().catch(() => undefined);
      return { ok: true, json };
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError')
        return { ok: false, reason: 'timeout' };
      return { ok: false, reason: 'unreachable' };
    }
  };

  const buildWorkflow = (
    template: ImageTemplate,
    request: ImageRunRequest,
    checkpoint: string,
    seed: number,
  ): Record<string, unknown> => {
    const workflow = structuredClone(template.workflow);
    const inputs = request.inputs;
    const set = (key: string, value: unknown): void => {
      const spec = template.params[key];
      if (spec === undefined || value === undefined) return;
      applyParam(workflow, spec, value);
    };
    set('positive', inputs.positive);
    set('negative', inputs.negative ?? 'text, watermark, low quality');
    set('checkpoint', checkpoint);
    set('width', inputs.width ?? 512);
    set('height', inputs.height ?? 512);
    set('seed', seed);
    set('steps', inputs.steps ?? 20);
    set('cfg', inputs.cfg ?? 7);
    set('sampler', inputs.sampler ?? 'euler');
    return workflow;
  };

  const provenanceOf = (run: LocalRun, durationMs: number | null): ImageRunProvenance => ({
    templateId: run.template.templateId,
    templateVersion: run.template.templateVersion,
    checkpoint: run.checkpoint,
    loras: [],
    controlnets: run.controlnets.map((controlnet) => ({
      name: controlnet.name,
      strength: controlnet.strength,
    })),
    positive: run.positive,
    negative: run.negative,
    seed: run.seed,
    steps: run.steps,
    cfg: run.cfg,
    sampler: run.sampler,
    width: run.width,
    height: run.height,
    durationMs,
  });

  const baseStatus = (
    runId: string,
    run: LocalRun | undefined,
    state: ImageRunState,
  ): ImageRunStatus => ({
    runId,
    state,
    queuePosition: null,
    progress: null,
    artifacts: [],
    provenance: run === undefined ? null : provenanceOf(run, null),
    failure: null,
  });

  const downloadArtifact = async (
    fileName: string,
    subfolder: string,
    type: string,
  ): Promise<ImageRunArtifact | null> => {
    const baseUrl = options.baseUrl();
    const url = new URL(`${baseUrl}/view`);
    url.searchParams.set('filename', fileName);
    url.searchParams.set('subfolder', subfolder);
    url.searchParams.set('type', type);
    try {
      const response = await options.fetchImpl(url.toString(), {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      const sha = await sha256Hex(bytes);
      const extension = fileName.includes('.')
        ? fileName.slice(fileName.lastIndexOf('.') + 1)
        : 'png';
      const storedFilePath = `${options.assetsDir}/${sha}.${extension}`;
      await ensureDir(options.assetsDir);
      // 内容寻址：同名（哈希）即同一资产，重复写入幂等
      await writeFileAtomic(storedFilePath, bytes, 0o644);
      return {
        fileName,
        mimeType: extension === 'png' ? 'image/png' : `image/${extension}`,
        sizeBytes: bytes.length,
        sha256: sha,
        storedPath: storedFilePath,
      };
    } catch {
      return null;
    }
  };

  const client: ComfyClient = {
    async probe(probeOptions): Promise<ComfyProbeResponse> {
      if (probeOptions?.force === true) {
        cachedProbe = null;
      }
      return probeInternal();
    },

    async templates(): Promise<ImageTemplatesResponse> {
      const templates = await loadTemplates(options.templatesPath);
      return {
        templates: templates.map((template) => ({
          templateId: template.templateId,
          templateVersion: template.templateVersion,
          title: template.title,
        })),
        defaultTemplateId: DEFAULT_TEMPLATE_ID,
      };
    },

    async submit(request: ImageRunRequest): Promise<SubmitResult> {
      const templates = await loadTemplates(options.templatesPath);
      const template = selectTemplate(templates, request.templateId);
      if (template === null) {
        return {
          ok: false,
          failure: {
            code: 'comfy_invalid_template',
            message: `未知模板：${request.templateId ?? '(空)'}`,
            actions: ['pick-template'],
            missing: [],
            available: templates.map((item) => item.templateId),
          },
        };
      }

      // 模板区间校验（模板可自定义更窄的合法区间——契约级区间是兜底，模板级是权威）
      const rangedInputs: [string, number | undefined][] = [
        ['width', request.inputs.width],
        ['height', request.inputs.height],
        ['steps', request.inputs.steps],
        ['cfg', request.inputs.cfg],
      ];
      for (const [key, value] of rangedInputs) {
        if (value === undefined) continue;
        const range = template.params[key]?.range;
        if (range === undefined) continue;
        const [min, max] = range;
        if (value < min || value > max) {
          return {
            ok: false,
            failure: {
              code: 'comfy_invalid_request',
              message: `参数 ${key}=${value} 超出模板区间 [${min}, ${max}]`,
              actions: ['adjust-params'],
              missing: [],
              available: [],
            },
          };
        }
      }

      const probe = await probeInternal();
      if (!probe.reachable) {
        return {
          ok: false,
          failure: probe.failure ?? unreachableFailure(probe.baseUrl, options.installPath()),
        };
      }

      const availableCheckpoints = probe.models?.checkpoints ?? [];
      const requestedCheckpoint =
        request.inputs.checkpoint ??
        template.requiredModels.checkpoints[0] ??
        availableCheckpoints[0] ??
        null;
      if (
        requestedCheckpoint === null ||
        (probe.models !== null && !availableCheckpoints.includes(requestedCheckpoint))
      ) {
        const missing = [requestedCheckpoint ?? '（无可用 checkpoint）'];
        return { ok: false, failure: missingModelFailure(missing, availableCheckpoints) };
      }

      const seed = request.inputs.seed ?? randomInt(0, 2 ** 31 - 1);
      const workflow = buildWorkflow(template, request, requestedCheckpoint, seed);
      const clientId = `dforge-${randomBytes(6).toString('hex')}`;
      const submitResponse = await fetchJson(`${options.baseUrl()}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      });
      if (!submitResponse.ok) {
        if (submitResponse.reason === 'timeout') {
          return { ok: false, failure: timeoutFailure('提交出图任务超时') };
        }
        if (submitResponse.reason === 'unreachable') {
          cachedProbe = null;
          return {
            ok: false,
            failure: unreachableFailure(options.baseUrl(), options.installPath()),
          };
        }
        return {
          ok: false,
          failure: {
            code: 'comfy_invalid_request',
            message: `ComfyUI 拒绝该任务（HTTP ${submitResponse.status ?? 0}）`,
            actions: ['check-template'],
            missing: [],
            available: [],
          },
        };
      }
      const promptId =
        typeof submitResponse.json === 'object' &&
        submitResponse.json !== null &&
        typeof (submitResponse.json as Record<string, unknown>).prompt_id === 'string'
          ? ((submitResponse.json as Record<string, unknown>).prompt_id as string)
          : null;
      if (promptId === null) {
        return {
          ok: false,
          failure: {
            code: 'comfy_invalid_request',
            message: 'ComfyUI 未返回 prompt_id',
            actions: ['retry-later'],
            missing: [],
            available: [],
          },
        };
      }

      runs.set(promptId, {
        template,
        seed,
        positive: request.inputs.positive,
        negative: request.inputs.negative ?? 'text, watermark, low quality',
        checkpoint: requestedCheckpoint,
        width: request.inputs.width ?? 512,
        height: request.inputs.height ?? 512,
        steps: request.inputs.steps ?? 20,
        cfg: request.inputs.cfg ?? 7,
        sampler: request.inputs.sampler ?? 'euler',
        controlnets: (request.inputs.controlnets ?? []).map((controlnet) => ({
          name: controlnet.name,
          strength: controlnet.strength,
        })),
        cancelRequested: false,
      });

      return {
        ok: true,
        handle: { runId: promptId, state: 'queued', queuePosition: null, etaMsHint: null },
        template,
        seed,
      };
    },

    async status(runId: string): Promise<ImageRunStatus | null> {
      const run = runs.get(runId);
      if (run === undefined) return null;
      if (run.cancelRequested) return baseStatus(runId, run, 'canceled');

      // 1) 先查结果：/history/{id}
      const history = await fetchJson(`${options.baseUrl()}/history/${runId}`, { method: 'GET' });
      if (history.ok && typeof history.json === 'object' && history.json !== null) {
        const entry = (history.json as Record<string, unknown>)[runId];
        if (typeof entry === 'object' && entry !== null) {
          const record = entry as Record<string, unknown>;
          const statusRecord =
            typeof record.status === 'object' && record.status !== null
              ? (record.status as Record<string, unknown>)
              : {};
          const statusStr =
            typeof statusRecord.status_str === 'string' ? statusRecord.status_str : 'success';
          if (statusStr === 'success') {
            const outputs =
              typeof record.outputs === 'object' && record.outputs !== null
                ? (record.outputs as Record<string, unknown>)
                : {};
            const artifacts: ImageRunArtifact[] = [];
            for (const nodeOutput of Object.values(outputs)) {
              if (typeof nodeOutput !== 'object' || nodeOutput === null) continue;
              const images = (nodeOutput as Record<string, unknown>).images;
              if (!Array.isArray(images)) continue;
              for (const image of images) {
                if (typeof image !== 'object' || image === null) continue;
                const imageRecord = image as Record<string, unknown>;
                if (typeof imageRecord.filename !== 'string') continue;
                const artifact = await downloadArtifact(
                  imageRecord.filename,
                  typeof imageRecord.subfolder === 'string' ? imageRecord.subfolder : '',
                  typeof imageRecord.type === 'string' ? imageRecord.type : 'output',
                );
                if (artifact !== null) artifacts.push(artifact);
              }
            }
            return {
              runId,
              state: 'succeeded',
              queuePosition: null,
              progress: null,
              artifacts,
              provenance: provenanceOf(run, null),
              failure: null,
            };
          }
          const messageText =
            typeof statusRecord.messages === 'object' ? JSON.stringify(statusRecord.messages) : '';
          const isOom = /out of memory|oom/i.test(messageText);
          const failure: ComfyFailure = isOom
            ? {
                code: 'comfy_oom',
                message: '显存不足（OOM）：建议降一档分辨率/步数后重试',
                actions: ['lower-resolution', 'lower-steps', 'retry-later'],
                missing: [],
                available: [],
              }
            : {
                code: 'comfy_invalid_request',
                message: `任务执行失败：${messageText.slice(0, 200) || statusStr}`,
                actions: ['retry-later'],
                missing: [],
                available: [],
              };
          return {
            runId,
            state: 'failed',
            queuePosition: null,
            progress: null,
            artifacts: [],
            provenance: provenanceOf(run, null),
            failure,
          };
        }
      }

      // 2) 再查队列：/queue（运行中/排队中）
      const queue = await fetchJson(`${options.baseUrl()}/queue`, { method: 'GET' });
      if (queue.ok && typeof queue.json === 'object' && queue.json !== null) {
        const queueRecord = queue.json as Record<string, unknown>;
        const running = Array.isArray(queueRecord.queue_running) ? queueRecord.queue_running : [];
        const pending = Array.isArray(queueRecord.queue_pending) ? queueRecord.queue_pending : [];
        const isEmpty =
          queueRecord.queue_running === undefined && queueRecord.queue_pending === undefined;
        if (isEmpty) {
          // 假上游/极简上游：无队列信息 → 保持 queued（不发散成错误）
          return baseStatus(runId, run, 'queued');
        }
        const isRunning = running.some((item) => Array.isArray(item) && item.includes(runId));
        if (isRunning) return baseStatus(runId, run, 'running');
        const index = pending.findIndex((item) => Array.isArray(item) && item.includes(runId));
        if (index >= 0) {
          const status = baseStatus(runId, run, 'queued');
          status.queuePosition = index + 1;
          return status;
        }
        return baseStatus(runId, run, 'queued');
      }

      return baseStatus(runId, run, 'queued');
    },

    async cancel(runId: string): Promise<ImageRunStatus | null> {
      const run = runs.get(runId);
      if (run === undefined) return null;
      run.cancelRequested = true;
      // 用户取消 = 静默非错误；中断失败也不改变终态（任务已标记取消）
      await fetchJson(`${options.baseUrl()}/interrupt`, { method: 'POST' }).catch(() => null);
      return baseStatus(runId, run, 'canceled');
    },
  };

  return client;
}
