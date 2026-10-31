/**
 * FE-10 · AI 抽屉的**步骤状态机**（纯逻辑，零 React / 零 DOM）。
 *
 * 口径（清单 F4 + 票 02 / spec P0-3）：用户可见流收敛为三段「排队 → 模型生成 → 完成」
 * （`AI_VISIBLE_STEPS`）；「校验/编译」并未真实发生，UI 不再渲染——但机器时序
 * （`AI_STEPS`）保留 validate/compile 作为 **P5 网关扩展位**，接入时恢复渲染与推进。
 * 失败可重试，失败始终落在**可见**步上。
 *
 * 关键纪律：**真响应与降级响应同构**——降级（无 key / 上游失败）同样走完三段、
 * 同样在 `complete` 落位，只在 `degraded` / `degradedReason` / `suggestions` 上区分，
 * UI 与门禁都不需要为降级写分支（角标只是把 `degraded` 渲染出来）。
 *
 * 为什么单独成模块：本状态机是「步骤时序」的**单一真源**——React 抽屉与
 * `scripts/verify-ai-two-state.mjs` 都跑它，门禁断言的时序即用户看到的时序。
 */
import type { AiChatResponse, AiDegradeReason, AiSuggestion } from '@dforge/contracts';

/** 机器时序步（顺序即状态机推进方向；validate/compile 是 P5 扩展位——UI 暂不渲染）。 */
export const AI_STEPS = ['queued', 'llm', 'validate', 'compile'] as const;

/**
 * 用户可见的三段流：排队 → 模型生成 → 完成。
 * 「完成」段不是机器步——它由运行阶段派生（见 `visibleAiStepStatus`），
 * 机器真正收口在 `completeAiRun`。
 */
export const AI_VISIBLE_STEPS = ['queued', 'llm', 'done'] as const;

/** 步骤 id（机器时序；含 P5 扩展位）。 */
export type AiStepId = (typeof AI_STEPS)[number];

/** 可见步骤 id（「done」为派生段，不在机器时序里）。 */
export type AiVisibleStepId = (typeof AI_VISIBLE_STEPS)[number];

/** 单步状态全集（i18n 动态键 `ai.step.status.${status}` 的取值钉点与类型同源）。 */
export const AI_STEP_STATUSES = ['pending', 'active', 'done', 'failed'] as const;

/** 单步状态。 */
export type AiStepStatus = (typeof AI_STEP_STATUSES)[number];

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
  /** 降级标记（角标「本地建议」的**唯一**依据）。 */
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
 * 扩展位（validate/compile）仍可推进——P5 接入时同一路径恢复渲染。
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

/**
 * 可见段的状态：机器步读 steps 记录；「完成」段由运行阶段派生——
 * 完成才打勾，运行/失败不落在它上（失败落点始终在真实发生事情的步上）。
 */
export function visibleAiStepStatus(state: AiRunState, id: AiVisibleStepId): AiStepStatus {
  if (id === 'done') return state.phase === 'done' ? 'done' : 'pending';
  return state.steps[id];
}

/** 推进到「已完成但尚未取回响应」的收尾段（P5 扩展位接缝：接入时在 done 帧前调用）。 */
export function finishSteps(state: AiRunState): AiRunState {
  return advanceAiRun(state, 'compile');
}

/** 失败：落在当前 active 步上（无 active 步时兜底落在可见的「模型生成」段——失败有可见落点）。 */
export function failAiRun(state: AiRunState, error: string): AiRunState {
  const failedStep = state.activeStep ?? 'llm';
  return {
    ...state,
    phase: 'failed',
    failedStep,
    activeStep: null,
    steps: { ...state.steps, [failedStep]: 'failed' },
    error,
  };
}

/** 完成：机器四步全 done（扩展位一并收口），落位响应（真/降级同构）。 */
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

/** 重试（仅失败态可用）：清空错误与上一轮结果，从 queued 重走三段。 */
export function retryAiRun(state: AiRunState): AiRunState {
  if (state.phase !== 'failed') return state;
  return beginAiRun(state);
}

/** 是否正在进行（UI 据此禁用提交与切换输入）。 */
export function isAiRunActive(state: AiRunState): boolean {
  return state.phase === 'running';
}
