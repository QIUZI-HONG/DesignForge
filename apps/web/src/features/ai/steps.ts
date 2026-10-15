/**
 * FE-10 · AI 抽屉的**四步状态机**（纯逻辑，零 React / 零 DOM）。
 *
 * 口径（清单 F4）：步骤流 `queued → llm → validate → compile`；失败可重试。
 * 关键纪律：**真响应与降级响应同构**——降级（无 key / 上游失败）同样走完四步、
 * 同样在 `complete` 落位，只在 `degraded` / `degradedReason` / `suggestions` 上区分，
 * UI 与门禁都不需要为降级写分支（角标只是把 `degraded` 渲染出来）。
 *
 * 为什么单独成模块：本状态机是「步骤时序」的**单一真源**——React 抽屉与
 * `scripts/verify-ai-two-state.mjs` 都跑它，门禁断言的时序即用户看到的时序。
 */
import type { AiChatResponse, AiDegradeReason, AiSuggestion } from '@dforge/contracts';

/** 四步（顺序即状态机的推进方向）。 */
export const AI_STEPS = ['queued', 'llm', 'validate', 'compile'] as const;

/** 步骤 id。 */
export type AiStepId = (typeof AI_STEPS)[number];

/** 单步状态。 */
export type AiStepStatus = 'pending' | 'active' | 'done' | 'failed';

/** 运行阶段（idle 未开始 / running 进行中 / done 完成 / failed 失败待重试）。 */
export type AiRunPhase = 'idle' | 'running' | 'done' | 'failed';

/** 一次运行的完整状态。 */
export interface AiRunState {
  phase: AiRunPhase;
  /** 当前步骤（idle / done 为 null）。 */
  activeStep: AiStepId | null;
  /** 失败落点的步骤（phase=failed 时非 null）。 */
  failedStep: AiStepId | null;
  steps: Record<AiStepId, AiStepStatus>;
  /** 第几次尝试（首次 = 1；重试递增——UI 用它显示「第 N 次尝试」）。 */
  attempt: number;
  runId: string | null;
  /** 降级标记（角标「本地模板」的**唯一**依据）。 */
  degraded: boolean;
  degradedReason: AiDegradeReason | null;
  suggestions: AiSuggestion[];
  content: string;
  /** 失败原因（面向人的短句，直接可渲染）。 */
  error: string | null;
}

/** 初始态。 */
export function initialAiRun(): AiRunState {
  return {
    phase: 'idle',
    activeStep: null,
    failedStep: null,
    steps: { queued: 'pending', llm: 'pending', validate: 'pending', compile: 'pending' },
    attempt: 0,
    runId: null,
    degraded: false,
    degradedReason: null,
    suggestions: [],
    content: '',
    error: null,
  };
}

/** 开始一次运行（首次提交或重试后重启）：回到 queued 并清空上一轮结果。 */
export function beginAiRun(state: AiRunState): AiRunState {
  return {
    ...initialAiRun(),
    phase: 'running',
    activeStep: 'queued',
    steps: { queued: 'active', llm: 'pending', validate: 'pending', compile: 'pending' },
    attempt: state.attempt + 1,
  };
}

/**
 * 前进一步：目标步之前的步骤收敛为 done，目标步 active。
 * **回退是 no-op**（时序单调，UI 不会闪回上一步）；重复进同一步也是 no-op。
 */
export function advanceAiRun(state: AiRunState, step: AiStepId): AiRunState {
  if (state.phase !== 'running') return state;
  const targetIndex = AI_STEPS.indexOf(step);
  const currentIndex = state.activeStep === null ? -1 : AI_STEPS.indexOf(state.activeStep);
  if (targetIndex <= currentIndex) return state;

  const steps = { ...state.steps };
  for (const [index, id] of AI_STEPS.entries()) {
    steps[id] = index < targetIndex ? 'done' : index === targetIndex ? 'active' : 'pending';
  }
  return { ...state, activeStep: step, steps };
}

/** 推进到「已完成但尚未取回响应」的 compile 段收尾（供适配层在 done 帧前调用）。 */
export function finishSteps(state: AiRunState): AiRunState {
  return advanceAiRun(state, 'compile');
}

/** 失败：落在当前 active 步上（无 active 步时落在最后一步，保证失败有落点）。 */
export function failAiRun(state: AiRunState, error: string): AiRunState {
  const failedStep = state.activeStep ?? AI_STEPS[AI_STEPS.length - 1] ?? 'compile';
  return {
    ...state,
    phase: 'failed',
    failedStep,
    activeStep: null,
    steps: { ...state.steps, [failedStep]: 'failed' },
    error,
  };
}

/** 完成：四步全 done，落位响应（真/降级同构）。 */
export function completeAiRun(state: AiRunState, response: AiChatResponse): AiRunState {
  return {
    ...state,
    phase: 'done',
    activeStep: null,
    failedStep: null,
    steps: { queued: 'done', llm: 'done', validate: 'done', compile: 'done' },
    runId: response.runId,
    content: response.content,
    degraded: response.degraded,
    degradedReason: response.degradedReason,
    suggestions: response.suggestions,
    error: null,
  };
}

/** 重试（仅失败态可用）：清空错误与上一轮结果，从 queued 重走四步。 */
export function retryAiRun(state: AiRunState): AiRunState {
  if (state.phase !== 'failed') return state;
  return beginAiRun(state);
}

/** 是否正在进行（UI 据此禁用提交与切换输入）。 */
export function isAiRunActive(state: AiRunState): boolean {
  return state.phase === 'running';
}
