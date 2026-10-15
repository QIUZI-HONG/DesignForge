/**
 * @dforge/contracts · image 命名空间（**df.image-run/v1**，架构 v1.1 §5.5）。
 *
 * 出图调度（ComfyUI 本地 GPU，零出机、零成本、可复现）。
 * 核心口径：**未启动 / 缺模型是一等状态**——失败态按架构 §5.5 表给结构化错误码与
 * 可执行动作（actions），前端分别给可操作提示，而非统一报错。
 * 消费方：FE-10（出图面板）。
 */

import type { DfErrorCode } from '../ipc/errors.ts';

/** 出图任务契约标识。 */
export const IMAGE_RUN_SCHEMA = 'df.image-run/v1' as const;

/** 出图链路错误码（§5.5 失败态表；`comfy_interrupted` 为用户取消——静默非错误）。 */
export type ComfyErrorCode = Extract<DfErrorCode, `comfy_${string}`>;

/** 出图失败态的结构化描述（含可执行动作，前端逐项渲染）。 */
export interface ComfyFailure {
  code: ComfyErrorCode;
  message: string;
  /** 可执行动作（如 retry-probe / set-base-url / launch / lower-resolution）。 */
  actions: string[];
  /** `comfy_model_missing`：模板引用的缺失模型名。 */
  missing: string[];
  /** `comfy_model_missing`：本地当前可用清单（前端原样展示）。 */
  available: string[];
}

/** ControlNet 输入（每挂一个都吃显存：建议同时最多 1–2 个）。 */
export interface ComfyControlNetInput {
  name: string;
  assetSha256: string;
  strength: number;
}

/** 出图参数（对模板参数占位表注值；范围口径见架构 §4.5.6）。 */
export interface ImageRunInputs {
  positive: string;
  negative?: string;
  checkpoint?: string;
  /** 8GB 显存档：默认 512–768；≥1024 走两段式（P4b）。 */
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  seed?: number | null;
  controlnets?: ComfyControlNetInput[];
}

/** `POST /image/runs` 请求。 */
export interface ImageRunRequest {
  /** 缺省使用 daemon 内置默认模板（default-txt2img）。 */
  templateId?: string;
  templateVersion?: number;
  inputs: ImageRunInputs;
  /** 产出插到哪个容器（回写画布属 P4b；本段仅记录溯源）。 */
  targetNodeId?: string | null;
  documentId?: string | null;
}

/** 出图任务状态机（`comfy_interrupted` 以 canceled 终态表达）。 */
export type ImageRunState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

/** 任务句柄（提交即返回，进度走轮询/事件）。 */
export interface ImageRunHandle {
  runId: string;
  state: 'queued' | 'running';
  queuePosition: number | null;
  etaMsHint: number | null;
}

/** 溯源记录（与 provenance/image-runs.jsonl 一条对齐；同种子重跑的依据）。 */
export interface ImageRunProvenance {
  templateId: string;
  templateVersion: number;
  checkpoint: string;
  loras: string[];
  controlnets: { name: string; strength: number }[];
  positive: string;
  negative: string;
  seed: number;
  steps: number;
  cfg: number;
  sampler: string;
  width: number;
  height: number;
  durationMs: number | null;
}

/** 产出资产（按内容哈希落盘，天然去重）。 */
export interface ImageRunArtifact {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storedPath: string | null;
}

/** 任务状态（`GET /image/runs/:runId`）。 */
export interface ImageRunStatus {
  runId: string;
  state: ImageRunState;
  queuePosition: number | null;
  progress: { value: number; max: number } | null;
  artifacts: ImageRunArtifact[];
  provenance: ImageRunProvenance | null;
  failure: ComfyFailure | null;
}

/** 探测结果（`GET /image/probe`；未启动 = reachable:false + failure，不抛异常）。 */
export interface ComfyProbeResponse {
  reachable: boolean;
  baseUrl: string;
  checkedAt: string;
  models: { checkpoints: string[]; loras: string[]; controlnets: string[] } | null;
  device: { name: string | null; vramTotalBytes: number | null } | null;
  failure: ComfyFailure | null;
}

/** 模板参数类型（§4.5.6 参数占位表）。 */
export type ImageTemplateParamType = 'string' | 'int' | 'float' | 'enum' | 'asset';

/** 模板参数占位（path 指向 API workflow 内的字段）。 */
export interface ImageTemplateParamSpec {
  path: string;
  type: ImageTemplateParamType;
  from?: string;
  range?: [number, number];
  optional?: boolean;
}

/** workflow 模板（API 格式 + 参数占位表；模板即资产、进版本管理）。 */
export interface ImageTemplate {
  templateId: string;
  templateVersion: number;
  title: string;
  workflow: Record<string, unknown>;
  params: Record<string, ImageTemplateParamSpec>;
  requiredModels: { checkpoints: string[]; loras: string[]; controlnets: string[] };
}

/** `GET /image/templates` 响应。 */
export interface ImageTemplatesResponse {
  templates: { templateId: string; templateVersion: number; title: string }[];
  defaultTemplateId: string;
}

/** 参数范围（契约级口径，daemon 与前端共用；§4.5.6 硬件约束）。 */
export const IMAGE_PARAM_RANGES = {
  width: [256, 2048],
  height: [256, 2048],
  steps: [1, 60],
  cfg: [1, 12],
} as const;

/** 出图请求解析结果。 */
export type ImageParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function readRangedNumber(
  value: unknown,
  label: string,
  [min, max]: readonly [number, number],
  integer: boolean,
): ImageParseResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, message: `${label} 必须是数值` };
  }
  if (integer && !Number.isInteger(value)) {
    return { ok: false, message: `${label} 必须是整数` };
  }
  if (value < min || value > max) {
    return { ok: false, message: `${label} 超出合法区间 [${min}, ${max}]` };
  }
  return { ok: true, value };
}

/** 解析并校验 `POST /image/runs` 请求体（范围按 IMAGE_PARAM_RANGES）。 */
export function parseImageRunRequest(value: unknown): ImageParseResult<ImageRunRequest> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: '请求体必须是 JSON 对象' };
  }
  const record = value as Record<string, unknown>;
  const inputs = record.inputs;
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) {
    return { ok: false, message: 'inputs 必须是对象' };
  }
  const rawInputs = inputs as Record<string, unknown>;
  if (typeof rawInputs.positive !== 'string' || rawInputs.positive.trim().length === 0) {
    return { ok: false, message: 'inputs.positive 必须是非空字符串' };
  }
  const parsedInputs: ImageRunInputs = { positive: rawInputs.positive };
  if (rawInputs.negative !== undefined) {
    if (typeof rawInputs.negative !== 'string')
      return { ok: false, message: 'inputs.negative 必须是字符串' };
    parsedInputs.negative = rawInputs.negative;
  }
  if (rawInputs.checkpoint !== undefined) {
    if (typeof rawInputs.checkpoint !== 'string' || rawInputs.checkpoint.length === 0) {
      return { ok: false, message: 'inputs.checkpoint 必须是非空字符串' };
    }
    parsedInputs.checkpoint = rawInputs.checkpoint;
  }
  for (const key of ['width', 'height'] as const) {
    const raw = rawInputs[key];
    if (raw === undefined) continue;
    const result = readRangedNumber(raw, `inputs.${key}`, IMAGE_PARAM_RANGES[key], true);
    if (!result.ok) return result;
    parsedInputs[key] = result.value;
  }
  if (rawInputs.steps !== undefined) {
    const result = readRangedNumber(
      rawInputs.steps,
      'inputs.steps',
      IMAGE_PARAM_RANGES.steps,
      true,
    );
    if (!result.ok) return result;
    parsedInputs.steps = result.value;
  }
  if (rawInputs.cfg !== undefined) {
    const result = readRangedNumber(rawInputs.cfg, 'inputs.cfg', IMAGE_PARAM_RANGES.cfg, false);
    if (!result.ok) return result;
    parsedInputs.cfg = result.value;
  }
  if (rawInputs.sampler !== undefined) {
    if (typeof rawInputs.sampler !== 'string' || rawInputs.sampler.length === 0) {
      return { ok: false, message: 'inputs.sampler 必须是非空字符串' };
    }
    parsedInputs.sampler = rawInputs.sampler;
  }
  if (rawInputs.seed !== undefined) {
    if (rawInputs.seed === null) {
      parsedInputs.seed = null;
    } else if (
      typeof rawInputs.seed === 'number' &&
      Number.isInteger(rawInputs.seed) &&
      rawInputs.seed >= 0
    ) {
      parsedInputs.seed = rawInputs.seed;
    } else {
      return { ok: false, message: 'inputs.seed 必须是非负整数或 null' };
    }
  }
  if (rawInputs.controlnets !== undefined) {
    if (!Array.isArray(rawInputs.controlnets)) {
      return { ok: false, message: 'inputs.controlnets 必须是数组' };
    }
    const controlnets: ComfyControlNetInput[] = [];
    for (const [index, raw] of rawInputs.controlnets.entries()) {
      if (typeof raw !== 'object' || raw === null) {
        return { ok: false, message: `inputs.controlnets[${index}] 必须是对象` };
      }
      const item = raw as Record<string, unknown>;
      const strength = item.strength;
      if (typeof item.name !== 'string' || item.name.length === 0) {
        return { ok: false, message: `inputs.controlnets[${index}].name 必须是非空字符串` };
      }
      if (typeof item.assetSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.assetSha256)) {
        return { ok: false, message: `inputs.controlnets[${index}].assetSha256 必须是 sha256` };
      }
      if (
        typeof strength !== 'number' ||
        !Number.isFinite(strength) ||
        strength < 0 ||
        strength > 2
      ) {
        return { ok: false, message: `inputs.controlnets[${index}].strength 必须在 0–2 之间` };
      }
      controlnets.push({ name: item.name, assetSha256: item.assetSha256, strength });
    }
    parsedInputs.controlnets = controlnets;
  }

  const request: ImageRunRequest = { inputs: parsedInputs };
  if (record.templateId !== undefined) {
    if (typeof record.templateId !== 'string' || record.templateId.length === 0) {
      return { ok: false, message: 'templateId 必须是非空字符串' };
    }
    request.templateId = record.templateId;
  }
  if (record.templateVersion !== undefined) {
    if (typeof record.templateVersion !== 'number' || !Number.isInteger(record.templateVersion)) {
      return { ok: false, message: 'templateVersion 必须是整数' };
    }
    request.templateVersion = record.templateVersion;
  }
  if (record.targetNodeId !== undefined) {
    if (record.targetNodeId !== null && typeof record.targetNodeId !== 'string') {
      return { ok: false, message: 'targetNodeId 必须是字符串或 null' };
    }
    request.targetNodeId = record.targetNodeId as string | null;
  }
  if (record.documentId !== undefined) {
    if (record.documentId !== null && typeof record.documentId !== 'string') {
      return { ok: false, message: 'documentId 必须是字符串或 null' };
    }
    request.documentId = record.documentId as string | null;
  }
  return { ok: true, value: request };
}
