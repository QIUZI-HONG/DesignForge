/**
 * AI 步骤状态机测试（seam：纯状态转移——外部只观察状态对象）。
 *
 * 断言口径（票 02 · spec P0-3）：用户可见流收敛为「排队 → 模型生成 → 完成」三段；
 * 机器时序保留 validate/compile 作为 P5 网关扩展位（UI 暂不渲染，接入时恢复）。
 * 每步只验「对外可见的状态形状」，不碰内部实现；时序由 `stream.test.ts` 在适配层验证。
 */
import type { AiChatResponse } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';

import {
  AI_STEPS,
  AI_VISIBLE_STEPS,
  advanceAiRun,
  beginAiRun,
  completeAiRun,
  failAiRun,
  initialAiRun,
  retryAiRun,
  visibleAiStepStatus,
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

describe('AI 步骤状态机（可见三段：排队 → 模型生成 → 完成）', () => {
  it('机器保留 validate/compile 扩展位（P5 接入时恢复渲染），可见流只有三段', () => {
    expect(AI_STEPS).toEqual(['queued', 'llm', 'validate', 'compile']);
    expect(AI_VISIBLE_STEPS).toEqual(['queued', 'llm', 'done']);
  });

  it('初始态：机器步全 pending、可见「完成」段 pending（phase=idle）、无尝试', () => {
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
    expect(AI_VISIBLE_STEPS.map((id) => visibleAiStepStatus(state, id))).toEqual([
      'pending',
      'pending',
      'pending',
    ]);
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

  it('前进：抵达步之前的步骤收敛为 done，回退是 no-op（时序单调）；扩展位仍可推进（P5 路径）', () => {
    let state = beginAiRun(initialAiRun());
    state = advanceAiRun(state, 'llm');
    expect(state.steps).toEqual({
      queued: 'done',
      llm: 'active',
      validate: 'pending',
      compile: 'pending',
    });

    // 扩展位仍可推进（P5 接入路径），但不属于当前可见流
    state = advanceAiRun(state, 'validate');
    expect(state.steps.validate).toBe('active');
    expect(state.activeStep).toBe('validate');

    // 回退不进：非法（向后）转移是 no-op，不破坏已完成的时序
    const back = advanceAiRun(state, 'llm');
    expect(back).toBe(state);
  });

  it('可见段状态：完成段由 phase 派生——完成才打勾，运行/失败不落在它上', () => {
    const running = advanceAiRun(beginAiRun(initialAiRun()), 'llm');
    expect(AI_VISIBLE_STEPS.map((id) => visibleAiStepStatus(running, id))).toEqual([
      'done',
      'active',
      'pending',
    ]);

    const done = completeAiRun(running, okResponse);
    expect(AI_VISIBLE_STEPS.map((id) => visibleAiStepStatus(done, id))).toEqual([
      'done',
      'done',
      'done',
    ]);

    const failed = failAiRun(running, '上游连接中断');
    expect(AI_VISIBLE_STEPS.map((id) => visibleAiStepStatus(failed, id))).toEqual([
      'done',
      'failed',
      'pending',
    ]);
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

  it('失败兜底：无活动步时落在可见的「模型生成」段——失败始终有可见落点（不落隐藏扩展位）', () => {
    const fallback = failAiRun({ ...beginAiRun(initialAiRun()), activeStep: null }, '传输中断');
    expect(fallback.failedStep).toBe('llm');
    expect(fallback.steps.llm).toBe('failed');
  });

  it('完成：机器四步全 done（扩展位一并收口）、可见三段全 done、真响应落位', () => {
    const state = completeAiRun(advanceAiRun(beginAiRun(initialAiRun()), 'llm'), okResponse);
    expect(state.phase).toBe('done');
    expect(AI_STEPS.map((step) => state.steps[step])).toEqual(['done', 'done', 'done', 'done']);
    expect(AI_VISIBLE_STEPS.map((id) => visibleAiStepStatus(state, id))).toEqual([
      'done',
      'done',
      'done',
    ]);
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
    // 降级同样走完可见三段（完成段由 phase 派生——同构，不需要为降级单写时序）
    expect(AI_VISIBLE_STEPS.map((id) => visibleAiStepStatus(state, id))).toEqual([
      'done',
      'done',
      'done',
    ]);
  });
});
