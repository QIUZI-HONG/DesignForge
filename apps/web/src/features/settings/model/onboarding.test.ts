/**
 * 四步引导步骤机测试（FE-09 · 清单 E4：当前步高亮 / 已完成勾选 / 可跳过）。
 *
 * 纯函数状态机：前进（记「完成」或「跳过」）、回退（不丢已记结果）、末步完成判定、
 * 进度计数。组件只消费这些状态（高亮/勾选由 UI 层映射），逻辑不掺进 React。
 */
import { describe, expect, it } from 'vitest';

import {
  advanceOnboarding,
  backOnboarding,
  createOnboardingState,
  ONBOARDING_STEP_IDS,
  onboardingProgress,
  stepStatus,
} from './onboarding';
import { SETTINGS_SECTION_IDS } from './sections';

describe('四步引导步骤机', () => {
  it('步骤与设置分区同源（注册表定序，不另起一份清单）', () => {
    expect(ONBOARDING_STEP_IDS).toEqual(SETTINGS_SECTION_IDS);
  });

  it('初始态：第一步为当前步，其余待办，未完成', () => {
    const state = createOnboardingState();
    expect(state.index).toBe(0);
    expect(state.finished).toBe(false);
    expect(stepStatus(state, 'workspace')).toBe('current');
    expect(stepStatus(state, 'ai')).toBe('pending');
    expect(stepStatus(state, 'comfy')).toBe('pending');
    expect(stepStatus(state, 'telemetry')).toBe('pending');
    expect(onboardingProgress(state)).toEqual({ completed: 0, total: 4 });
  });

  it('前进（完成）：上一步记 done，当前步下移', () => {
    const state = advanceOnboarding(createOnboardingState(), 'done');
    expect(state.index).toBe(1);
    expect(stepStatus(state, 'workspace')).toBe('done');
    expect(stepStatus(state, 'ai')).toBe('current');
    expect(onboardingProgress(state).completed).toBe(1);
  });

  it('可跳过：跳过步记 skipped（区别于 done，界面勾选与跳过要分形）', () => {
    const state = advanceOnboarding(createOnboardingState(), 'skipped');
    expect(stepStatus(state, 'workspace')).toBe('skipped');
    expect(stepStatus(state, 'ai')).toBe('current');
  });

  it('回退：index 回退且已记结果保留（回看再前进可覆盖）', () => {
    const first = advanceOnboarding(createOnboardingState(), 'done');
    const back = backOnboarding(first);
    expect(back.index).toBe(0);
    expect(stepStatus(back, 'workspace')).toBe('current');
    // 再前进并改判为跳过 → 覆盖旧结果
    const again = advanceOnboarding(back, 'skipped');
    expect(stepStatus(again, 'workspace')).toBe('skipped');
  });

  it('首步回退是空操作（不越界）', () => {
    const state = createOnboardingState();
    expect(backOnboarding(state)).toEqual(state);
  });

  it('末步完成：finished=true，四步结果齐备（完成态落库的判定依据）', () => {
    let state = createOnboardingState();
    state = advanceOnboarding(state, 'done');
    state = advanceOnboarding(state, 'skipped');
    state = advanceOnboarding(state, 'done');
    state = advanceOnboarding(state, 'done');
    expect(state.finished).toBe(true);
    expect(onboardingProgress(state)).toEqual({ completed: 4, total: 4 });
    expect(stepStatus(state, 'telemetry')).toBe('done');
  });

  it('完成后回退：退出 finished 并停在末步（可再次完成）', () => {
    let state = createOnboardingState();
    state = advanceOnboarding(state, 'done');
    state = advanceOnboarding(state, 'done');
    state = advanceOnboarding(state, 'done');
    state = advanceOnboarding(state, 'done');
    const back = backOnboarding(state);
    expect(back.finished).toBe(false);
    expect(back.index).toBe(3);
    expect(stepStatus(back, 'telemetry')).toBe('current');
  });

  it('非当前步的旧结果不影响当前高亮（current 优先）', () => {
    const state = advanceOnboarding(createOnboardingState(), 'done');
    expect(stepStatus(state, 'ai')).toBe('current');
    expect(stepStatus(state, 'workspace')).toBe('done');
  });
});
