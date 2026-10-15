/**
 * AI 四步状态机测试（seam：纯状态转移——外部只观察状态对象）。
 *
 * 断言口径：每步只验「对外可见的状态形状」（步骤状态 / 阶段 / 降级字段 / 尝试次数），
 * 不碰内部实现；时序由 `stream.test.ts` 在适配层验证。
 */
import type { AiChatResponse } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';

import {
  AI_STEPS,
  advanceAiRun,
  beginAiRun,
  completeAiRun,
  failAiRun,
  initialAiRun,
  retryAiRun,
} from './steps';

/** 真响应样本（未降级）。 */
const okResponse: AiChatResponse = {
  runId: 'ai_abc',
  provider: 'deepseek',
  model: 'deepseek-chat',
  content: '已为你生成标题',
  finishReason: 'stop',
  usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
  degraded: false,
  degradedReason: null,
  suggestions: [],
};

/** 降级响应样本（无 key / 上游失败与真响应同构）。 */
const degraded: AiChatResponse = {
  runId: 'ai_def',
  provider: 'deepseek',
  model: 'deepseek-chat',
  content: '',
  finishReason: 'degraded',
  usage: null,
  degraded: true,
  degradedReason: 'no-credentials',
  suggestions: [
    { kind: 'configure-credentials', title: '未配置 DeepSeek API key', detail: '去设置页填入 key' },
  ],
};

describe('AI 四步状态机', () => {
  it('初始态：四步全 pending、阶段 idle、无尝试', () => {
    const state = initialAiRun();
    expect(AI_STEPS.map((step) => state.steps[step])).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(state.phase).toBe('idle');
    expect(state.activeStep).toBeNull();
    expect(state.attempt).toBe(0);
    expect(state.degraded).toBe(false);
  });

  it('开始一次运行：queued 进入 active、计数 1；重试再计数（失败可重试的语义）', () => {
    const first = beginAiRun(initialAiRun());
    expect(first.phase).toBe('running');
    expect(first.activeStep).toBe('queued');
    expect(first.steps.queued).toBe('active');
    expect(first.attempt).toBe(1);

    const retried = retryAiRun(failAiRun(first, '网络错误'));
    expect(retried.attempt).toBe(2);
    expect(retried.phase).toBe('running');
    expect(retried.activeStep).toBe('queued');
    expect(retried.error).toBeNull();
    expect(retried.steps.queued).toBe('active');
  });

  it('前进：抵达步之前的步骤收敛为 done，目标步 active，其余回落 pending', () => {
    let state = beginAiRun(initialAiRun());
    state = advanceAiRun(state, 'llm');
    expect(state.steps).toEqual({
      queued: 'done',
      llm: 'active',
      validate: 'pending',
      compile: 'pending',
    });

    state = advanceAiRun(state, 'validate');
    expect(state.steps).toEqual({
      queued: 'done',
      llm: 'done',
      validate: 'active',
      compile: 'pending',
    });
    expect(state.activeStep).toBe('validate');

    // 回退不进：非法（向后）转移是 no-op，不破坏已完成的时序
    const back = advanceAiRun(state, 'llm');
    expect(back).toBe(state);
  });

  it('失败：落在当前 active 步上、阶段 failed、失败原因可测', () => {
    const running = advanceAiRun(beginAiRun(initialAiRun()), 'llm');
    const failed = failAiRun(running, '上游连接中断');
    expect(failed.phase).toBe('failed');
    expect(failed.failedStep).toBe('llm');
    expect(failed.steps.llm).toBe('failed');
    expect(failed.steps.queued).toBe('done');
    expect(failed.error).toBe('上游连接中断');
  });

  it('完成：四步全 done、真响应落位（内容/用量语义不丢）', () => {
    const state = completeAiRun(advanceAiRun(beginAiRun(initialAiRun()), 'llm'), okResponse);
    expect(state.phase).toBe('done');
    expect(AI_STEPS.map((step) => state.steps[step])).toEqual(['done', 'done', 'done', 'done']);
    expect(state.activeStep).toBeNull();
    expect(state.content).toBe('已为你生成标题');
    expect(state.runId).toBe('ai_abc');
    expect(state.degraded).toBe(false);
  });

  it('降级完成：与真响应同构落位——degraded + 原因 + 建议清单（UI 不分支）', () => {
    const state = completeAiRun(beginAiRun(initialAiRun()), degraded);
    expect(state.phase).toBe('done');
    expect(state.degraded).toBe(true);
    expect(state.degradedReason).toBe('no-credentials');
    expect(state.suggestions).toEqual(degraded.suggestions);
    // 降级同样走完四步（本地模板在 validate/compile 段生成）
    expect(AI_STEPS.map((step) => state.steps[step])).toEqual(['done', 'done', 'done', 'done']);
  });
});
