/**
 * AI 流式适配测试（seam：`createAiRunReader` 的输入文本 → 状态更新序列）。
 *
 * 断言口径（票 02 / spec P0-3）：喂**真实 daemon 帧格式**的 SSE 文本（含跨块切断、噪声帧），
 * 断言三段可见时序（排队 → 模型生成 → 完成；done 帧直接收口，不再推进 validate/compile）、
 * 声明式内容累积、降级同构与失败落点。
 * 本模块是步骤时序的单一真源——`scripts/verify-ai-two-state.mjs` 用同一模块对真 daemon 取证。
 */
import { describe, expect, it, vi } from 'vitest';

import { AI_VISIBLE_STEPS, visibleAiStepStatus } from './steps';
import { createAiRunReader } from './stream';

/** daemon 的 SSE 帧（`event:` + `data:` 双行；与 apps/daemon/src/routes/ai.ts 同格式）。 */
function frame(event: unknown): string {
  const type = (event as { type: string }).type;
  return `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
}

const degradedDone = {
  type: 'done',
  response: {
    runId: 'ai_1',
    provider: 'deepseek',
    model: 'deepseek-chat',
    content: '',
    finishReason: 'degraded',
    usage: null,
    degraded: true,
    degradedReason: 'no-credentials',
    suggestions: [{ kind: 'configure-credentials', title: '未配置 key', detail: null }],
  },
};

const okDone = {
  type: 'done',
  response: {
    runId: 'ai_2',
    provider: 'deepseek',
    model: 'deepseek-chat',
    content: '按钮组已生成',
    finishReason: 'stop',
    usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    degraded: false,
    degradedReason: null,
    suggestions: [],
  },
};

describe('AI 流式适配（可见三段：queued → llm → 完成收口）', () => {
  it('无 key 降级流：三段同构走完，落位降级标记与建议清单（UI 不分叉）', () => {
    const reader = createAiRunReader();
    reader.begin();
    const updates = reader.pushText(
      frame({
        type: 'start',
        runId: 'ai_1',
        provider: 'deepseek',
        model: 'deepseek-chat',
        degraded: true,
      }) + frame(degradedDone),
    );
    const transitions = updates.flatMap((update) =>
      update.transition === null ? [] : [update.transition.step],
    );
    expect(transitions).toEqual(['llm']);

    const state = reader.snapshot();
    expect(state.steps).toEqual({ queued: 'done', llm: 'done', validate: 'done', compile: 'done' });
    expect(state.phase).toBe('done');
    expect(state.degraded).toBe(true);
    expect(state.degradedReason).toBe('no-credentials');
    expect(state.suggestions).toHaveLength(1);
    // 时序：排队 → 模型生成（含 begin 的 queued），时间戳单调不减；
    // 「校验/编译」不发生——不进时间线（P5 扩展位接入时恢复）
    const timeline = reader.timeline();
    expect(timeline.map((entry) => entry.step)).toEqual(['queued', 'llm']);
    expect(timeline.map((entry) => entry.step)).not.toContain('validate');
    expect(timeline.map((entry) => entry.step)).not.toContain('compile');
    expect(
      timeline.every(
        (entry, index) => index === 0 || entry.atMs >= (timeline[index - 1]?.atMs ?? 0),
      ),
    ).toBe(true);
  });

  it('真态流：delta 实时累积（先显示增量，done 帧以完整响应收口）', () => {
    const reader = createAiRunReader();
    reader.begin();
    const updates = reader.pushText(
      frame({
        type: 'start',
        runId: 'ai_2',
        provider: 'deepseek',
        model: 'deepseek-chat',
        degraded: false,
      }) +
        frame({ type: 'delta', delta: '按钮' }) +
        frame({ type: 'delta', delta: '组' }) +
        frame(okDone),
    );
    // 中途快照：delta 已累积、steps 停在 llm
    const mid = updates.find((update) => update.state.content === '按钮');
    expect(mid?.state.steps.llm).toBe('active');
    const state = reader.snapshot();
    expect(state.content).toBe('按钮组已生成');
    expect(state.degraded).toBe(false);
    expect(state.phase).toBe('done');
  });

  it('跨块切断的帧不影响解析（字节流边界与帧边界无关）', () => {
    const reader = createAiRunReader();
    reader.begin();
    const text =
      frame({
        type: 'start',
        runId: 'ai_2',
        provider: 'deepseek',
        model: 'deepseek-chat',
        degraded: false,
      }) + frame(okDone);
    const head = text.slice(0, 40);
    const rest = text.slice(40);
    expect(reader.pushText(head)).toHaveLength(0);
    const updates = reader.pushText(rest);
    expect(updates.length).toBeGreaterThan(0);
    expect(reader.snapshot().phase).toBe('done');
  });

  it('error 帧：失败落在当时的活动步上，重试后回到 queued 且尝试次数递增', () => {
    const reader = createAiRunReader();
    reader.begin();
    reader.pushText(
      frame({
        type: 'start',
        runId: 'ai_3',
        provider: 'deepseek',
        model: 'deepseek-chat',
        degraded: false,
      }),
    );
    const failed = reader.pushText(
      frame({
        type: 'error',
        error: { code: 'ai_upstream_error', message: '上游连接中断', details: null },
      }),
    );
    const last = failed.at(-1)?.state;
    expect(last?.phase).toBe('failed');
    expect(last?.steps.llm).toBe('failed');
    expect(last?.error).toBe('上游连接中断');

    // 重试：新的一次运行从 queued 重新起算
    const retry = reader.retry();
    expect(retry.state.phase).toBe('running');
    expect(retry.state.steps.queued).toBe('active');
    expect(retry.state.attempt).toBe(2);
    expect(retry.state.error).toBeNull();
  });

  it('无法识别的噪声帧被忽略（不推进步骤、不抛错）', () => {
    const reader = createAiRunReader();
    reader.begin();
    const updates = reader.pushText(': keep-alive\n\nnot-sse\n\n');
    expect(updates).toHaveLength(0);
    expect(reader.snapshot().steps.queued).toBe('active');
  });

  it('时间戳来自注入的时钟（门禁可用它做步骤耗时断言）', () => {
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(250).mockReturnValue(400);
    const reader = createAiRunReader({ now });
    reader.begin();
    reader.pushText(
      frame({
        type: 'start',
        runId: 'ai_4',
        provider: 'deepseek',
        model: 'deepseek-chat',
        degraded: false,
      }),
    );
    // done 帧直接收口（无 validate/compile 转移）：时间线停在两段
    reader.pushText(frame(okDone));
    const timeline = reader.timeline();
    expect(timeline.map((entry) => entry.step)).toEqual(['queued', 'llm']);
    expect(timeline[0]?.atMs).toBe(100);
    expect(timeline[1]?.atMs).toBe(250);
  });
});

describe('TC-AI-04 守护回归：done 后不再推进假步骤（票 02 / spec P0-3）', () => {
  it('真实 done 帧：可见时序恰为 queued → llm → done 三段，done 拍无步骤转移、时间线停两拍', () => {
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(250).mockReturnValue(400);
    const reader = createAiRunReader({ now });
    reader.begin();
    const updates = reader.pushText(
      frame({
        type: 'start',
        runId: 'ai_2',
        provider: 'deepseek',
        model: 'deepseek-chat',
        degraded: false,
      }) +
        frame({ type: 'delta', delta: '加一个主按钮' }) +
        frame(okDone),
    );

    // done 拍只收口数据（transition=null）：审计 3.2 的缺陷形态在此同拍推进 validate→compile 假步
    const doneUpdate = updates.at(-1);
    expect(doneUpdate?.transition).toBeNull();
    expect(doneUpdate?.state.phase).toBe('done');

    // 机器时间线恰两拍（queued/llm），「完成」段由 phase=done 派生——不做第三次转移、不耗时钟
    const timeline = reader.timeline();
    expect(timeline.map((entry) => entry.step)).toEqual(['queued', 'llm']);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]?.atMs).toBe(100);
    expect(timeline[1]?.atMs).toBe(250);
    expect(now).toHaveBeenCalledTimes(2);
    expect(timeline.some((entry) => entry.step === 'validate' || entry.step === 'compile')).toBe(
      false,
    );

    // 可见三段全勾：queued/llm 读机器步，done 由 phase 派生（AI_VISIBLE_STEPS 是口径钉点）
    expect([...AI_VISIBLE_STEPS]).toEqual(['queued', 'llm', 'done']);
    const snapshot = reader.snapshot();
    for (const id of AI_VISIBLE_STEPS) {
      expect(visibleAiStepStatus(snapshot, id)).toBe('done');
    }
  });

  it('done 后再喂迟到帧（start/delta/重复 done）：不推进任何步骤、时间线不变', () => {
    const reader = createAiRunReader();
    reader.begin();
    reader.pushText(
      frame({
        type: 'start',
        runId: 'ai_2',
        provider: 'deepseek',
        model: 'deepseek-chat',
        degraded: false,
      }) + frame(okDone),
    );
    const timelineAtDone = reader.timeline();

    const late = reader.pushText(
      frame({
        type: 'start',
        runId: 'ai_2',
        provider: 'deepseek',
        model: 'deepseek-chat',
        degraded: false,
      }) +
        frame({ type: 'delta', delta: ' 迟到帧' }) +
        frame(okDone),
    );

    // done 后任何帧都不产生步骤转移（尤其 validate/compile 假步）
    expect(
      late.flatMap((update) => (update.transition === null ? [] : [update.transition.step])),
    ).toEqual([]);
    expect(reader.timeline()).toEqual(timelineAtDone);
    const snapshot = reader.snapshot();
    expect(snapshot.phase).toBe('done');
    // 四步收口全部 done 来自 completeAiRun 的落位，而非假步推进（无对应时间线转移）
    expect(snapshot.steps.validate).toBe('done');
    expect(snapshot.steps.compile).toBe('done');
  });
});
