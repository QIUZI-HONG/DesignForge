/**
 * FE-10 · 出图失败态与 OOM 降档（纯逻辑）。
 *
 * 口径（架构 v1.1 §5.5 + 契约 df.image-run/v1）：**未启动 / 缺模型是一等状态**——
 * daemon 给出结构化失败态（code + actions + missing/available），前端逐项渲染可执行动作，
 * 而不是统一「出错了」。OOM 的出路是「降档重试」，降档规则在此集中定义（UI 与门禁同源）。
 */
import type { ImageRunInputs } from '@dforge/contracts';

/** UI 侧的失败视图（失败信封 → 可渲染字段）。 */
export interface ComfyFailureView {
  code: string;
  message: string;
  /** 可执行动作（daemon 口径，逐项渲染）。 */
  actions: string[];
  /** 缺失模型名（comfy_model_missing）。 */
  missing: string[];
  /** 本地可用模型清单（原样展示）。 */
  available: string[];
  /** 是否 OOM（UI 据此给「降档重试」）。 */
  isOom: boolean;
}

/** 判断错误码是否为 OOM。 */
export function isOom(code: string): boolean {
  return code === 'comfy_oom';
}

/** 从错误信封（或已知失败态）构造 UI 视图；details 缺失时容错为空清单。 */
export function failureFromError(error: {
  code: string;
  message: string;
  details?: { actions?: unknown; missing?: unknown; available?: unknown } | null;
}): ComfyFailureView {
  const readList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  const details = error.details ?? null;
  return {
    code: error.code,
    message: error.message,
    actions: readList(details?.actions),
    missing: readList(details?.missing),
    available: readList(details?.available),
    isOom: isOom(error.code),
  };
}

/** 分辨率降一档：×0.75 后向下取到 64 的倍数，下限 256（契约 IMAGE_PARAM_RANGES 下限）。 */
function lowerSide(value: number): number {
  const lowered = Math.floor((value * 3) / 4);
  return Math.max(256, Math.floor(lowered / 64) * 64);
}

/** 步数降一档：×0.75 向下取整，下限 1（契约 steps 下限）。 */
function lowerSteps(value: number): number {
  return Math.max(1, Math.floor((value * 3) / 4));
}

/** 降档：分辨率与步数各降一档（尺寸缺省按 daemon 缺省 512/20 起算），其余参数原样带过。 */
export function downgradeInputs(inputs: ImageRunInputs): ImageRunInputs {
  return {
    ...inputs,
    width: lowerSide(inputs.width ?? 512),
    height: lowerSide(inputs.height ?? 512),
    steps: lowerSteps(inputs.steps ?? 20),
  };
}

/** 还能不能降（已在最低档时 UI 应禁用「降档重试」并说明原因）。 */
export function canDowngrade(inputs: ImageRunInputs): boolean {
  const lowered = downgradeInputs(inputs);
  return (
    lowered.width !== (inputs.width ?? 512) ||
    lowered.height !== (inputs.height ?? 512) ||
    lowered.steps !== (inputs.steps ?? 20)
  );
}

/**
 * 任意异常 → UI 失败视图。
 * daemon 失败信封（DaemonRequestError）带 code/details；其余（网络断、解析失败）归内部错误。
 */
export function failureOf(error: unknown): ComfyFailureView {
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    const candidate = error as {
      code: string;
      message: string;
      details?: Record<string, unknown> | null;
    };
    return failureFromError(candidate);
  }
  return failureFromError({
    code: 'internal',
    message: error instanceof Error ? error.message : '出图请求失败',
  });
}

/**
 * 任务终态里的失败（`ImageRunStatus.failure`，契约 ComfyFailure：actions/missing/available 平铺）
 * → UI 视图。轮询到 failed 时走这条；提交被拒（异常）走 `failureOf`。
 */
export function failureFromStatus(failure: {
  code: string;
  message: string;
  actions?: unknown;
  missing?: unknown;
  available?: unknown;
}): ComfyFailureView {
  return failureFromError({
    code: failure.code,
    message: failure.message,
    details: { actions: failure.actions, missing: failure.missing, available: failure.available },
  });
}
