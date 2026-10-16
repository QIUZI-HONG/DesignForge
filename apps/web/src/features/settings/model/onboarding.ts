/**
 * 四步引导步骤机（FE-09 · 清单 E4：当前步高亮 / 已完成勾选 / 可跳过）。
 *
 * 纯函数状态机（不掺 React）：步骤 = 设置分区（同源注册表），每步前进时记下结果
 * （完成 / 跳过），末步「完成」把整机置为 finished——「完成态落库」的落库动作
 * 由调用方按每步结果执行（见 `draft.ts` 的分区载荷映射）。
 */
import { SETTINGS_SECTION_IDS, type SettingsSectionId } from './sections';

/** 单步结果。 */
export type OnboardingOutcome = 'done' | 'skipped';

/** 单步展示态（组件据此上色/打勾）。 */
export type OnboardingStepStatus = 'pending' | 'current' | 'done' | 'skipped';

/** 引导机状态。 */
export interface OnboardingState {
  /** 当前步下标（0 起）。 */
  index: number;
  /** 各步已记结果（null = 尚未处理）。 */
  outcomes: Record<SettingsSectionId, OnboardingOutcome | null>;
  /** 末步完成后为 true（此时无 current 步，全部呈结果态）。 */
  finished: boolean;
}

/** 引导步骤 id（与设置分区同源、同序）。 */
export const ONBOARDING_STEP_IDS: readonly SettingsSectionId[] = SETTINGS_SECTION_IDS;

/** 初始状态：第一步为当前步。 */
export function createOnboardingState(): OnboardingState {
  return {
    index: 0,
    outcomes: { workspace: null, ai: null, comfy: null, telemetry: null },
    finished: false,
  };
}

/** 取某步的展示态。 */
export function stepStatus(state: OnboardingState, id: SettingsSectionId): OnboardingStepStatus {
  if (!state.finished && ONBOARDING_STEP_IDS[state.index] === id) return 'current';
  return state.outcomes[id] ?? 'pending';
}

/** 前进：记下当前步结果；末步则整机完成。 */
export function advanceOnboarding(
  state: OnboardingState,
  result: OnboardingOutcome,
): OnboardingState {
  if (state.finished) return state;
  const id = ONBOARDING_STEP_IDS[state.index];
  if (id === undefined) return state;
  const outcomes = { ...state.outcomes };
  outcomes[id] = result;
  if (state.index === ONBOARDING_STEP_IDS.length - 1) {
    return { index: state.index, outcomes, finished: true };
  }
  return { index: state.index + 1, outcomes, finished: false };
}

/** 回退：不丢已记结果（再前进可改判）；完成后回退 = 退回末步。 */
export function backOnboarding(state: OnboardingState): OnboardingState {
  if (state.finished) return { ...state, finished: false };
  if (state.index === 0) return state;
  return { ...state, index: state.index - 1 };
}

/** 进度（已完成或已跳过的步数 / 总步数）。 */
export function onboardingProgress(state: OnboardingState): { completed: number; total: number } {
  const completed = ONBOARDING_STEP_IDS.filter((id) => state.outcomes[id] !== null).length;
  return { completed, total: ONBOARDING_STEP_IDS.length };
}
