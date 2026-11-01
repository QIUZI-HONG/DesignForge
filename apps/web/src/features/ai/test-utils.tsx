/**
 * AI 抽屉测试装配（本票自管）。
 *
 * - RTL 自动清理：vitest 未开 `globals`，此处显式 afterEach 卸载；
 * - `frame()`：与 daemon（apps/daemon/src/routes/ai.ts）同格式的 SSE 帧构造；
 * - 假端口：把契约事件序列变成「真 SSE 文本块」喂给适配层（不真调云端）；
 * - 可控端口：chatStream 由测试显式放行，用来观察运行中（loading/disabled）态。
 */
import type {
  AiChatResponse,
  AiDegradeReason,
  AiStatusResponse,
  AiStreamEvent,
  AiSuggestion,
} from '@dforge/contracts';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import type { AiPort } from './client';

afterEach(() => {
  cleanup();
});

/** 构造 SSE 帧文本（event + data 双行）。 */
export function frame(event: AiStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** 未配置态状态响应（无 key）。 */
export function statusUnconfigured(): AiStatusResponse {
  return {
    provider: 'deepseek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
    configured: false,
    credential: {
      provider: 'deepseek',
      hasKey: false,
      maskedKey: null,
      source: null,
      updatedAt: null,
    },
    degradedHint: '未配置 DeepSeek key：AI 功能为降级态（建议清单），不影响编辑与出图',
  };
}

/** 已配置态状态响应。 */
export function statusConfigured(): AiStatusResponse {
  return {
    ...statusUnconfigured(),
    configured: true,
    credential: {
      provider: 'deepseek',
      hasKey: true,
      maskedKey: 'sk-…abcd',
      source: 'stored',
      updatedAt: '2026-10-15T00:00:00.000Z',
    },
    degradedHint: null,
  };
}

/**
 * 各降级原因的建议清单样本（期望值取自契约语义的独立誊写，不 import daemon 实现——
 * daemon 面见 apps/daemon/src/ai/client.ts `suggestionsFor`，两侧同源核对见票 03）。
 */
const SUGGESTIONS_BY_REASON: Record<AiDegradeReason, AiSuggestion[]> = {
  'no-credentials': [
    {
      kind: 'configure-credentials',
      title: '未配置 DeepSeek API key',
      detail: '在设置页填入 key（sk-…）后即可使用 AI 功能',
    },
  ],
  'rate-limited': [
    {
      kind: 'retry-later',
      title: '触发上游限流（429）',
      detail: '已按指数退避重试 2 次仍失败；稍后再试或降低频率',
    },
    { kind: 'manual-edit', title: '可先手动完成本次修改', detail: null },
  ],
  timeout: [
    { kind: 'retry-later', title: '请求超时', detail: '网络较慢或上游拥堵，可稍后重试' },
    { kind: 'manual-edit', title: '可先手动完成本次修改', detail: null },
  ],
  'invalid-response': [
    { kind: 'retry-later', title: '上游响应不可解析', detail: '已降级，可重试一次' },
    { kind: 'manual-edit', title: '可先手动完成本次修改', detail: null },
  ],
  'upstream-error': [
    {
      kind: 'retry-later',
      title: '上游服务暂不可用',
      detail: '已自动降级为建议清单，不中断编辑',
    },
    { kind: 'manual-edit', title: '可先手动完成本次修改', detail: null },
  ],
};

/** 降级完成响应（与真响应同构；content 空 + 建议清单承接可操作性）。 */
export function degradedResponse(reason: AiDegradeReason = 'no-credentials'): AiChatResponse {
  return {
    runId: 'ai_degraded',
    provider: 'deepseek',
    model: 'deepseek-chat',
    content: '',
    finishReason: 'degraded',
    usage: null,
    degraded: true,
    degradedReason: reason,
    suggestions: SUGGESTIONS_BY_REASON[reason],
  };
}

/** 真态完成响应。 */
export function okResponse(content = '已生成按钮组'): AiChatResponse {
  return {
    runId: 'ai_ok',
    provider: 'deepseek',
    model: 'deepseek-chat',
    content,
    finishReason: 'stop',
    usage: { promptTokens: 8, completionTokens: 6, totalTokens: 14 },
    degraded: false,
    degradedReason: null,
    suggestions: [],
  };
}

/** 假端口的可观察面。 */
export interface FakeAiPort extends AiPort {
  readonly streamCalls: number;
  readonly statusCalls: number;
}

/**
 * 假端口：每次 `chatStream` 按 `runs` 队列吐一帧序列（文本块），
 * 队列耗尽后重复最后一组（重试场景第二次仍可完整跑完）。
 */
export function fakeAiPort(options: {
  runs: AiStreamEvent[][];
  status?: AiStatusResponse;
}): FakeAiPort {
  let streamCalls = 0;
  let statusCalls = 0;
  const port: FakeAiPort = {
    get streamCalls() {
      return streamCalls;
    },
    get statusCalls() {
      return statusCalls;
    },
    async status() {
      statusCalls += 1;
      return options.status ?? statusUnconfigured();
    },
    async *chatStream() {
      const index = Math.min(streamCalls, options.runs.length - 1);
      streamCalls += 1;
      const events = options.runs[index] ?? [];
      for (const event of events) yield frame(event);
    },
  };
  return port;
}

/** 可控端口：`chatStream` 阻塞直到 `release()` 被调用（观察运行中态）。 */
export function controllableAiPort(): FakeAiPort & { release: () => void } {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let streamCalls = 0;
  const port = {
    get streamCalls() {
      return streamCalls;
    },
    get statusCalls() {
      return 0;
    },
    async status() {
      return statusConfigured();
    },
    async *chatStream() {
      streamCalls += 1;
      await gate;
      yield frame({
        type: 'start',
        runId: 'ai_ctl',
        provider: 'deepseek',
        model: 'deepseek-chat',
        degraded: false,
      });
      yield frame({ type: 'done', response: okResponse() });
    },
    release: () => release(),
  } satisfies FakeAiPort & { release: () => void };
  return port;
}
