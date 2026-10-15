import { describe, expect, it } from 'vitest';

import { createTestDaemon, injectJson } from '../testing/harness.ts';

const FAKE_KEY = 'sk-fake-abcdefghijklmn';

function openAiOk(content: string, usage?: Record<string, number>): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
      ...(usage === undefined ? {} : { usage }),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function upstreamCalls(calls: { url: string }[]): { url: string }[] {
  return calls.filter((call) => call.url.includes('/chat/completions'));
}

describe('ai · 降级两态（无 key / 上游失败）', () => {
  it('无 key：直接降级（200 + degraded + 建议清单），且不触发任何上游调用', async () => {
    const daemon = await createTestDaemon();
    try {
      const { statusCode, payload, raw } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload: { messages: [{ role: 'user', content: '帮我画一个按钮' }] },
      });
      expect(statusCode).toBe(200);
      const response = (
        payload as {
          result: {
            degraded: boolean;
            degradedReason: string;
            finishReason: string;
            suggestions: { kind: string; title: string }[];
            content: string;
          };
        }
      ).result;
      expect(response.degraded).toBe(true);
      expect(response.degradedReason).toBe('no-credentials');
      expect(response.finishReason).toBe('degraded');
      expect(response.suggestions[0]?.kind).toBe('configure-credentials');
      expect(response.content).toBe('');
      expect(upstreamCalls(daemon.fetchCalls)).toHaveLength(0);
      expect(raw).not.toContain(FAKE_KEY);
    } finally {
      await daemon.cleanup();
    }
  });

  it('上游 5xx 连续失败：重试 2 次后降级（upstream-error），响应同构', async () => {
    let attempts = 0;
    const daemon = await createTestDaemon({
      envApiKey: FAKE_KEY,
      aiRetryDelaysMs: [0, 0],
      fetchImpl: async () => {
        attempts += 1;
        return new Response('boom', { status: 500 });
      },
    });
    try {
      const { payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload: { messages: [{ role: 'user', content: 'x' }] },
      });
      const response = (
        payload as {
          result: { degraded: boolean; degradedReason: string; suggestions: { kind: string }[] };
        }
      ).result;
      expect(response.degraded).toBe(true);
      expect(response.degradedReason).toBe('upstream-error');
      expect(response.suggestions.map((suggestion) => suggestion.kind)).toContain('retry-later');
      expect(attempts).toBe(3); // 首次 + 重试 2 次（架构 §4.5.1：失败重试 ≤2）
    } finally {
      await daemon.cleanup();
    }
  });

  it('429 限流：退避重试后以 rate-limited 降级', async () => {
    let attempts = 0;
    const daemon = await createTestDaemon({
      envApiKey: FAKE_KEY,
      aiRetryDelaysMs: [0, 0],
      fetchImpl: async () => {
        attempts += 1;
        return new Response('slow down', { status: 429 });
      },
    });
    try {
      const { payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload: { messages: [{ role: 'user', content: 'x' }] },
      });
      expect((payload as { result: { degradedReason: string } }).result.degradedReason).toBe(
        'rate-limited',
      );
      expect(attempts).toBe(3);
    } finally {
      await daemon.cleanup();
    }
  });

  it('上游响应不可解析：invalid-response 降级', async () => {
    const daemon = await createTestDaemon({
      envApiKey: FAKE_KEY,
      aiRetryDelaysMs: [0, 0],
      fetchImpl: async () => new Response('not json', { status: 200 }),
    });
    try {
      const { payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload: { messages: [{ role: 'user', content: 'x' }] },
      });
      const response = (payload as { result: { degraded: boolean; degradedReason: string } })
        .result;
      expect(response.degraded).toBe(true);
      expect(response.degradedReason).toBe('invalid-response');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('ai · 真响应（有 key）', () => {
  it('透传内容与用量；请求头只在 daemon→上游方向带 key；响应不含 key', async () => {
    const daemon = await createTestDaemon({
      envApiKey: FAKE_KEY,
      fetchImpl: async () =>
        openAiOk('这是生成的设计说明', {
          prompt_tokens: 11,
          completion_tokens: 22,
          total_tokens: 33,
        }),
    });
    try {
      const { statusCode, payload, raw } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload: {
          messages: [{ role: 'user', content: '一句话说明' }],
          temperature: 0.5,
          maxTokens: 128,
        },
      });
      expect(statusCode).toBe(200);
      const response = (
        payload as {
          result: {
            content: string;
            degraded: boolean;
            usage: { totalTokens: number };
            finishReason: string;
          };
        }
      ).result;
      expect(response.content).toBe('这是生成的设计说明');
      expect(response.degraded).toBe(false);
      expect(response.usage.totalTokens).toBe(33);
      expect(response.finishReason).toBe('stop');
      expect(raw).not.toContain(FAKE_KEY);

      const call = upstreamCalls(daemon.fetchCalls)[0];
      expect(call).toBeDefined();
      const fullCall = daemon.fetchCalls.find((item) => item.url.includes('/chat/completions'));
      expect(fullCall?.headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
      expect(fullCall?.url).toBe('https://api.deepseek.com/chat/completions');
      expect(fullCall?.body).toContain('"max_tokens":128');
    } finally {
      await daemon.cleanup();
    }
  });

  it('重试后成功：前 2 次 500、第 3 次 200 → 返回真响应', async () => {
    let attempts = 0;
    const daemon = await createTestDaemon({
      envApiKey: FAKE_KEY,
      aiRetryDelaysMs: [0, 0],
      fetchImpl: async () => {
        attempts += 1;
        return attempts < 3 ? new Response('boom', { status: 503 }) : openAiOk('终于成功');
      },
    });
    try {
      const { payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload: { messages: [{ role: 'user', content: 'x' }] },
      });
      expect((payload as { result: { content: string; degraded: boolean } }).result.content).toBe(
        '终于成功',
      );
      expect((payload as { result: { degraded: boolean } }).result.degraded).toBe(false);
      expect(attempts).toBe(3);
    } finally {
      await daemon.cleanup();
    }
  });

  it('GET /ai/status：未配置给 degradedHint；配置后 configured=true 且只有掩码', async () => {
    const unconfigured = await createTestDaemon();
    try {
      const { payload } = await injectJson(unconfigured.app, { method: 'GET', url: '/ai/status' });
      const status = (
        payload as {
          result: { configured: boolean; degradedHint: string; credential: { hasKey: boolean } };
        }
      ).result;
      expect(status.configured).toBe(false);
      expect(status.degradedHint).toContain('未配置');
      expect(status.credential.hasKey).toBe(false);
    } finally {
      await unconfigured.cleanup();
    }

    const configured = await createTestDaemon({ envApiKey: FAKE_KEY });
    try {
      const { payload, raw } = await injectJson(configured.app, {
        method: 'GET',
        url: '/ai/status',
      });
      const status = (
        payload as {
          result: {
            configured: boolean;
            degradedHint: string | null;
            credential: { maskedKey: string };
          };
        }
      ).result;
      expect(status.configured).toBe(true);
      expect(status.degradedHint).toBeNull();
      expect(status.credential.maskedKey).toBe('sk-…klmn');
      expect(raw).not.toContain(FAKE_KEY);
    } finally {
      await configured.cleanup();
    }
  });
});

describe('ai · 流式（SSE）', () => {
  it('无 key 流式：start(degraded) + done(降级响应)，同构收尾', async () => {
    const daemon = await createTestDaemon();
    try {
      const response = await daemon.app.inject({
        method: 'POST',
        url: '/ai/chat',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], stream: true }),
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      const text = response.payload;
      expect(text).toContain('event: start');
      expect(text).toContain('"degraded":true');
      expect(text).toContain('event: done');
      expect(text).toContain('"degradedReason":"no-credentials"');
    } finally {
      await daemon.cleanup();
    }
  });

  it('有 key 流式：delta 增量 + done 汇总完整内容；帧内不含 key', async () => {
    const daemon = await createTestDaemon({
      envApiKey: FAKE_KEY,
      fetchImpl: async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"，设界"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
    });
    try {
      const response = await daemon.app.inject({
        method: 'POST',
        url: '/ai/chat',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], stream: true }),
      });
      expect(response.statusCode).toBe(200);
      const text = response.payload;
      expect(text).toContain('event: delta');
      expect(text).toContain('"delta":"你好"');
      expect(text).toContain('"delta":"，设界"');
      expect(text).toContain('event: done');
      expect(text).toContain('"content":"你好，设界"');
      expect(text).toContain('"finishReason":"stop"');
      expect(text).not.toContain(FAKE_KEY);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('ai · 请求校验', () => {
  it('空 messages → 400 ai_invalid_request（统一错误形状）', async () => {
    const daemon = await createTestDaemon();
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload: { messages: [] },
      });
      expect(statusCode).toBe(400);
      expect((payload as { error: { code: string } }).error.code).toBe('ai_invalid_request');
    } finally {
      await daemon.cleanup();
    }
  });
});
