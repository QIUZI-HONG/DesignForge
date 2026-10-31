/**
 * @dforge/daemon · 配置存储（`<dataRoot>/config.json`）。
 *
 * 局部更新语义：PUT /config 只覆盖出现的字段；工作目录变更做**路径规范化**
 * （展开 `~`、resolve 绝对路径）与**可写性校验**（mkdir -p + W_OK），非法值拒绝并保持旧配置。
 * baseUrl 收敛（票 02 · §A2-5c）：ai.baseUrl 仅 DeepSeek 官方域、comfy.baseUrl 仅回环
 * 网段（access-control.ts）——patch 入口越界拒绝且**不改内存/磁盘**；load 入口对磁盘上的
 * 历史脏值回退默认（不静默继承外送通道）。
 */

import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import type { DaemonConfig, DaemonConfigPatch } from '@dforge/contracts';
import { isDaemonConfig, isNonEmptyString } from '@dforge/contracts';

import { baseUrlRejection, isAllowedAiBaseUrl, isAllowedComfyBaseUrl } from '../access-control.ts';
import { ensureDir, isWritable, readJsonFileOrNull, writeFileAtomic } from '../fs-atomic.ts';

/** 配置更新结果（失败时带统一错误码，由路由层透传）。 */
export type ConfigPatchResult =
  | { ok: true; config: DaemonConfig }
  | { ok: false; message: string; details: Record<string, unknown> };

/** 配置存储接口。 */
export interface ConfigStore {
  /** 从磁盘加载（缺失/损坏则落默认值；损坏时保留提示供诊断）。 */
  load(): Promise<void>;
  get(): DaemonConfig;
  /** 局部更新并持久化（校验失败不改内存值）。 */
  patch(patch: unknown): Promise<ConfigPatchResult>;
}

/** 默认配置（依据架构 v1.1 §4.5.1 DeepSeek 与 §4.5.6 ComfyUI 缺省值）。 */
export function defaultConfig(workspaceDir: string): DaemonConfig {
  return {
    workspaceDir,
    ai: { provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
    comfy: { baseUrl: 'http://127.0.0.1:8188', installPath: null },
    telemetry: { enabled: true },
  };
}

/** 展开 `~` 前缀并 resolve 为绝对路径（唯一的路径规范化入口）。 */
export function normalizePath(input: string): string {
  const expanded =
    input === '~' ? homedir() : input.startsWith('~/') ? join(homedir(), input.slice(2)) : input;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(process.cwd(), expanded);
}

/** 磁盘载入时的 baseUrl 收敛：越界（含旧版本写入的宽口径值）回退默认，不静默继承。 */
function sanitizeLoadedConfig(candidate: DaemonConfig): DaemonConfig {
  const defaults = defaultConfig(candidate.workspaceDir);
  return {
    ...candidate,
    ai: isAllowedAiBaseUrl(candidate.ai.baseUrl)
      ? candidate.ai
      : { ...candidate.ai, baseUrl: defaults.ai.baseUrl },
    comfy: isAllowedComfyBaseUrl(candidate.comfy.baseUrl)
      ? candidate.comfy
      : { ...candidate.comfy, baseUrl: defaults.comfy.baseUrl },
  };
}

/** 创建配置存储（configJsonPath 为 `<dataRoot>/config.json`；defaultWorkspaceDir 为测试注入点）。 */
export function createConfigStore(options: {
  configJsonPath: string;
  defaultWorkspaceDir: string;
}): ConfigStore {
  let current = defaultConfig(options.defaultWorkspaceDir);

  const readMerged = (raw: unknown): DaemonConfig | null => {
    // 磁盘配置与默认值深合并（缺字段回退默认值，避免旧文件升级后崩）
    if (typeof raw !== 'object' || raw === null) return null;
    const record = raw as Record<string, unknown>;
    const candidate = {
      workspaceDir:
        typeof record.workspaceDir === 'string' ? record.workspaceDir : current.workspaceDir,
      ai:
        typeof record.ai === 'object' && record.ai !== null
          ? { ...current.ai, ...(record.ai as Record<string, unknown>) }
          : current.ai,
      comfy:
        typeof record.comfy === 'object' && record.comfy !== null
          ? { ...current.comfy, ...(record.comfy as Record<string, unknown>) }
          : current.comfy,
      telemetry:
        typeof record.telemetry === 'object' && record.telemetry !== null
          ? { ...current.telemetry, ...(record.telemetry as Record<string, unknown>) }
          : current.telemetry,
    };
    return isDaemonConfig(candidate) ? candidate : null;
  };

  const persist = async (): Promise<void> => {
    await writeFileAtomic(options.configJsonPath, `${JSON.stringify(current, null, 2)}\n`, 0o600);
  };

  return {
    async load(): Promise<void> {
      const result = await readJsonFileOrNull(options.configJsonPath);
      if (!result.ok) {
        // 缺失 = 首启（落默认值）；损坏 = 保留默认值并等待用户重写（不崩溃）
        if (result.reason === 'missing') {
          await ensureDir(current.workspaceDir);
          await persist();
        }
        return;
      }
      const merged = readMerged(result.value);
      if (merged !== null) {
        current = sanitizeLoadedConfig(merged);
      }
    },

    get(): DaemonConfig {
      return structuredClone(current);
    },

    async patch(patch: unknown): Promise<ConfigPatchResult> {
      if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
        return { ok: false, message: '请求体必须是 JSON 对象', details: { field: 'body' } };
      }
      const input = patch as Record<string, unknown>;
      const next: DaemonConfig = structuredClone(current);

      if (input.workspaceDir !== undefined) {
        if (typeof input.workspaceDir !== 'string' || input.workspaceDir.trim().length === 0) {
          return {
            ok: false,
            message: 'workspaceDir 必须是非空字符串',
            details: { field: 'workspaceDir' },
          };
        }
        const normalized = normalizePath(input.workspaceDir);
        try {
          await ensureDir(normalized);
        } catch (error) {
          return {
            ok: false,
            message: `工作目录不可创建：${normalized}`,
            details: { field: 'workspaceDir', reason: String(error) },
          };
        }
        if (!(await isWritable(normalized))) {
          return {
            ok: false,
            message: `工作目录不可写：${normalized}`,
            details: { field: 'workspaceDir', reason: 'not-writable', normalized },
          };
        }
        next.workspaceDir = normalized;
      }

      if (input.ai !== undefined) {
        if (typeof input.ai !== 'object' || input.ai === null || Array.isArray(input.ai)) {
          return { ok: false, message: 'ai 必须是对象', details: { field: 'ai' } };
        }
        const ai = input.ai as Record<string, unknown>;
        if (ai.provider !== undefined && ai.provider !== 'deepseek') {
          return {
            ok: false,
            message: 'provider 仅支持 deepseek',
            details: { field: 'ai.provider' },
          };
        }
        if (ai.model !== undefined) {
          if (!isNonEmptyString(ai.model)) {
            return {
              ok: false,
              message: 'ai.model 必须是非空字符串',
              details: { field: 'ai.model' },
            };
          }
          next.ai.model = ai.model;
        }
        if (ai.baseUrl !== undefined) {
          // 收敛 allowlist（§A2-5c）：仅 DeepSeek 官方域（https）——key 以 Bearer 头发送，
          // 允许任意地址等于「改一行配置即外送凭据」；越界拒绝且不改内存
          if (!isNonEmptyString(ai.baseUrl) || !isAllowedAiBaseUrl(ai.baseUrl)) {
            const rejection = baseUrlRejection('ai.baseUrl');
            return { ok: false, message: rejection.message, details: rejection.details };
          }
          next.ai.baseUrl = ai.baseUrl;
        }
      }

      if (input.comfy !== undefined) {
        if (typeof input.comfy !== 'object' || input.comfy === null || Array.isArray(input.comfy)) {
          return { ok: false, message: 'comfy 必须是对象', details: { field: 'comfy' } };
        }
        const comfy = input.comfy as Record<string, unknown>;
        if (comfy.baseUrl !== undefined) {
          // 收敛回环网段（§A2-5c）：ComfyUI 是本机服务，非回环地址封死 SSRF 面
          if (!isNonEmptyString(comfy.baseUrl) || !isAllowedComfyBaseUrl(comfy.baseUrl)) {
            const rejection = baseUrlRejection('comfy.baseUrl');
            return { ok: false, message: rejection.message, details: rejection.details };
          }
          next.comfy.baseUrl = comfy.baseUrl;
        }
        if (comfy.installPath !== undefined) {
          if (comfy.installPath !== null && typeof comfy.installPath !== 'string') {
            return {
              ok: false,
              message: 'comfy.installPath 必须是字符串或 null',
              details: { field: 'comfy.installPath' },
            };
          }
          next.comfy.installPath =
            comfy.installPath === null ? null : normalizePath(comfy.installPath as string);
        }
      }

      if (input.telemetry !== undefined) {
        if (
          typeof input.telemetry !== 'object' ||
          input.telemetry === null ||
          Array.isArray(input.telemetry)
        ) {
          return { ok: false, message: 'telemetry 必须是对象', details: { field: 'telemetry' } };
        }
        const telemetry = input.telemetry as Record<string, unknown>;
        if (telemetry.enabled !== undefined) {
          if (typeof telemetry.enabled !== 'boolean') {
            return {
              ok: false,
              message: 'telemetry.enabled 必须是布尔值',
              details: { field: 'telemetry.enabled' },
            };
          }
          next.telemetry.enabled = telemetry.enabled;
        }
      }

      current = next;
      await persist();
      return { ok: true, config: structuredClone(current) };
    },
  };
}

/** 供类型收窄的辅助（把 unknown patch 声明为契约类型）。 */
export type ConfigStorePatch = DaemonConfigPatch;
