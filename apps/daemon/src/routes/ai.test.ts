import { describe, expect, it } from 'vitest';

import type { TestDaemon, TestDaemonOptions } from '../testing/harness.ts';
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
  it('无 key：直接降级（200 + degraded + 建议清单），content 为本地建议非空串，且不触发任何上游调用', async () => {
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
      // 票 03：content 为真实可读的本地建议（非空串，含分步建议与注意事项）
      expect(response.content.length).toBeGreaterThan(0);
      expect(response.content).toContain('按钮');
      expect(response.content).toContain('注意事项');
      expect(upstreamCalls(daemon.fetchCalls)).toHaveLength(0);
      expect(raw).not.toContain(FAKE_KEY);
    } finally {
      await daemon.cleanup();
    }
  });

  it('无 key 信封（票 03 / spec P0-2）：content 为关键词族本地建议且确定，suggestions 结构契约合法', async () => {
    const daemon = await createTestDaemon();
    try {
      const payload = {
        messages: [{ role: 'user', content: '给首屏加一个主按钮，并把圆角统一为 8' }],
      };
      const first = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload,
      });
      const second = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload,
      });
      const firstResult = (
        first.payload as {
          result: {
            content: string;
            suggestions: { kind: string; title: string; detail: string | null }[];
          };
        }
      ).result;
      // content：真实建议文本（识别到按钮 + 圆角两族，含分步与注意事项）
      expect(firstResult.content).toContain('「按钮」');
      expect(firstResult.content).toContain('「圆角」');
      expect(firstResult.content).toContain('注意事项');
      // suggestions：配置凭据条目在前，其后为逐族的 manual-edit 条目（结构合法）
      expect(firstResult.suggestions[0]?.kind).toBe('configure-credentials');
      const manual = firstResult.suggestions.filter(
        (suggestion) => suggestion.kind === 'manual-edit',
      );
      expect(manual).toHaveLength(2);
      for (const suggestion of manual) {
        expect(suggestion.title.length).toBeGreaterThan(0);
        expect(suggestion.detail === null || typeof suggestion.detail === 'string').toBe(true);
      }
      // 确定性（信封级）：同输入两次请求 → content 完全一致
      const secondResult = (second.payload as { result: { content: string } }).result;
      expect(secondResult.content).toBe(firstResult.content);
      // 不触上游
      expect(upstreamCalls(daemon.fetchCalls)).toHaveLength(0);
    } finally {
      await daemon.cleanup();
    }
  });

  it('无 key 且提示词无关键词：content 走兜底文案（非空），suggestions 仍契约合法', async () => {
    const daemon = await createTestDaemon();
    try {
      const { payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload: { messages: [{ role: 'user', content: '让页面更有呼吸感' }] },
      });
      const response = (payload as { result: { content: string; suggestions: { kind: string }[] } })
        .result;
      expect(response.content.length).toBeGreaterThan(0);
      expect(response.content).toContain('注意事项');
      expect(response.suggestions[0]?.kind).toBe('configure-credentials');
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

  it('白名单 Origin：流式响应同样带 allow-origin 回显 + vary（与普通响应同一 CORS 策略）', async () => {
    const daemon = await createTestDaemon();
    try {
      const response = await daemon.app.inject({
        method: 'POST',
        url: '/ai/chat',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        payload: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], stream: true }),
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(String(response.headers.vary).toLowerCase()).toContain('origin');
    } finally {
      await daemon.cleanup();
    }
  });

  it('非白名单 Origin：流式响应不带放行头（API 语义不变）；`Origin: null` 带放行头', async () => {
    const daemon = await createTestDaemon();
    try {
      const evil = await daemon.app.inject({
        method: 'POST',
        url: '/ai/chat',
        headers: { 'content-type': 'application/json', origin: 'http://evil.example.com' },
        payload: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], stream: true }),
      });
      expect(evil.statusCode).toBe(200);
      expect(evil.headers['content-type']).toContain('text/event-stream');
      expect(evil.headers['access-control-allow-origin']).toBeUndefined();

      const nullOrigin = await daemon.app.inject({
        method: 'POST',
        url: '/ai/chat',
        headers: { 'content-type': 'application/json', origin: 'null' },
        payload: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], stream: true }),
      });
      expect(nullOrigin.headers['access-control-allow-origin']).toBe('null');
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

describe('ai · 流式 CORS 守护回归（TC-AI-03 · 真 listen + fetch）', () => {
  // daemon 集成档：真 listen（端口 0 → OS 空闲端口，远离 3000/4318）+ 真 fetch 走真实
  // socket。缺陷形态是 writeStream 直写 reply.raw.writeHead 落 socket、绕过 cors.ts 的
  // onRequest 钩子（spec P0-1 断点一）——真实落头路径必须用真实 socket 验，inject 的
  // 模拟响应面（上面「流式（SSE）」块）不能完全替代。非流式对照由 cors.test.ts 盖（引用
  // 不重复）；上游一律 mock（sseResponse 先例），不出机；数据根由 harness 注入临时目录。

  /** 起真实例真 listen，带 Origin 发流式 POST /ai/chat，返回真实 HTTP 响应。 */
  async function streamChatOverSocket(daemon: TestDaemon, origin: string): Promise<Response> {
    const baseUrl = await daemon.app.listen({ port: 0, host: '127.0.0.1' });
    return fetch(`${baseUrl}/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], stream: true }),
    });
  }

  /** 有 key + SSE mock 上游：走真生成流（start → delta* → done），非降级壳。 */
  function mockUpstreamOptions(): TestDaemonOptions {
    return {
      envApiKey: FAKE_KEY,
      fetchImpl: async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
    };
  }

  it('白名单 Origin（http://localhost:3000）：真实 socket 响应带 allow-origin 回显 + vary: Origin + text/event-stream', async () => {
    const daemon = await createTestDaemon(mockUpstreamOptions());
    try {
      const response = await streamChatOverSocket(daemon, 'http://localhost:3000');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
      expect((response.headers.get('vary') ?? '').toLowerCase()).toContain('origin');
      // 通道是真生成流（mock 上游被消费），不是空壳响应
      const text = await response.text();
      expect(text).toContain('event: start');
      expect(text).toContain('event: delta');
      expect(text).toContain('event: done');
      expect(upstreamCalls(daemon.fetchCalls)).toHaveLength(1);
    } finally {
      await daemon.cleanup();
    }
  });

  it('打包壳 Origin: null（file:// 口径）：真实 socket 响应同样带 allow-origin=null 放行 + SSE 通道', async () => {
    const daemon = await createTestDaemon(mockUpstreamOptions());
    try {
      const response = await streamChatOverSocket(daemon, 'null');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(response.headers.get('access-control-allow-origin')).toBe('null');
      expect((response.headers.get('vary') ?? '').toLowerCase()).toContain('origin');
      expect(await response.text()).toContain('event: done');
    } finally {
      await daemon.cleanup();
    }
  });

  it('非白名单 Origin（http://evil.example）：无放行头，但 API 语义不变（200 + SSE + vary）', async () => {
    const daemon = await createTestDaemon(mockUpstreamOptions());
    try {
      const response = await streamChatOverSocket(daemon, 'http://evil.example');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      // vary 仍落：响应内容随 Origin 变化，缓存必须区分（cors.ts 策略），与是否放行无关
      expect((response.headers.get('vary') ?? '').toLowerCase()).toContain('origin');
      // 服务端不引入 403 伪安全：流照常产出（拦截是浏览器同源策略的职责）
      expect(await response.text()).toContain('event: done');
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

  it('stream:true 且参数非法：建立 SSE 通道并以契约 error 帧返回（不是 JSON 400）', async () => {
    const daemon = await createTestDaemon();
    try {
      const response = await daemon.app.inject({
        method: 'POST',
        url: '/ai/chat',
        headers: { 'content-type': 'application/json' },
        // maxTokens=0 非法（须正整数）——但客户端已声明 stream:true，通道形状不换
        payload: JSON.stringify({
          messages: [{ role: 'user', content: 'x' }],
          stream: true,
          maxTokens: 0,
        }),
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.payload).toContain('event: error');
      expect(response.payload).toContain('"code":"ai_invalid_request"');
      expect(daemon.fetchCalls).toHaveLength(0);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('ai · 流式健壮性（上游非 SSE / 客户端断开）', () => {
  it('上游 200 但体非 SSE：不假成功——done 携带 degraded invalid-response', async () => {
    const daemon = await createTestDaemon({
      envApiKey: FAKE_KEY,
      fetchImpl: async () => openAiOk('你好'),
    });
    try {
      const response = await daemon.app.inject({
        method: 'POST',
        url: '/ai/chat',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], stream: true }),
      });
      expect(response.statusCode).toBe(200);
      expect(response.payload).toContain('event: done');
      // 逐帧断言：done 必须是降级帧（不能是 degraded:false 的假成功）
      const doneLine = response.payload
        .split('\n')
        .find((line) => line.startsWith('data: {"type":"done"'));
      expect(doneLine).toBeDefined();
      const done = JSON.parse((doneLine ?? '').slice('data: '.length)) as {
        response: { degraded: boolean; degradedReason: string; content: string };
      };
      expect(done.response.degraded).toBe(true);
      expect(done.response.degradedReason).toBe('invalid-response');
      expect(done.response.content).toBe('');
    } finally {
      await daemon.cleanup();
    }
  });

  it('上游 200 + event-stream 但零 data 帧：同样归 invalid-response（不假成功）', async () => {
    const daemon = await createTestDaemon({
      envApiKey: FAKE_KEY,
      fetchImpl: async () => sseResponse([': keep-alive\n\n', '\n']),
    });
    try {
      const response = await daemon.app.inject({
        method: 'POST',
        url: '/ai/chat',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], stream: true }),
      });
      expect(response.payload).toContain('"degradedReason":"invalid-response"');
    } finally {
      await daemon.cleanup();
    }
  });

  it('客户端断开：立即中止上游并停止推流（abort 传播）', async () => {
    const encoder = new TextEncoder();
    let upstreamAborted = false;
    let upstreamCancelled = false;
    const daemon = await createTestDaemon({
      envApiKey: FAKE_KEY,
      fetchImpl: async (_url, init) => {
        const upstreamSignal = init?.signal ?? null;
        upstreamSignal?.addEventListener('abort', () => {
          upstreamAborted = true;
        });
        const timer = setInterval(() => undefined, 1_000);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            // 持续推帧：客户端不断开就会一直推下去（上游占用）
            setInterval(() => {
              try {
                controller.enqueue(
                  encoder.encode('data: {"choices":[{"delta":{"content":"x"}}]}\n\n'),
                );
              } catch {
                // 已关闭
              }
            }, 10);
          },
          cancel() {
            upstreamCancelled = true;
            clearInterval(timer);
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });
    try {
      const baseUrl = await daemon.app.listen({ port: 0, host: '127.0.0.1' });
      const controller = new AbortController();
      const response = await fetch(`${baseUrl}/ai/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], stream: true }),
        signal: controller.signal,
      });
      const reader = response.body?.getReader();
      const first = await reader?.read();
      expect(first?.done).toBe(false); // 已进入流
      controller.abort(); // 客户端断开
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(upstreamAborted || upstreamCancelled).toBe(true);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('ai · 流式通道守护回归（TC-AI-02 · 半行拆帧/中途断流/残行 EOF）', () => {
  // 真源缺口两档 + 残行 EOF 档：mock 上游把 SSE 按真实 TCP 形态拆 chunk——
  // 半行拆帧钉「缓冲按换行切分、残行保留回填」；中途 error 钉「断流以
  // done(degraded, upstream-error, partialContent=已累积) 收尾」；残行 EOF 钉
  // 「残行静默丢弃、done 按已累积内容收尾」。均走 inject（缓冲逻辑在 client 层，
  // 与落头/CORS 无关——那是 TC-AI-03 真实 socket 档的职责）。

  /** 分块推送的 SSE mock 上游（逐 chunk enqueue + 间隔，确保 reader 逐块读到）。 */
  function chunkedSseResponse(chunks: string[], options?: { errorAtEnd?: boolean }): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        if (options?.errorAtEnd === true) {
          // socket.destroy() 形态：流中途出错（reader.read() 拒绝）
          controller.error(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
          return;
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  /** 解析 SSE 文本为 (event, data) 帧序列（`event: X\ndata: {...}\n\n`）。 */
  function sseFrames(text: string): { event: string; data: unknown }[] {
    const frames: { event: string; data: unknown }[] = [];
    let currentEvent = '';
    for (const line of text.split('\n')) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice('event: '.length);
      } else if (line.startsWith('data: ')) {
        let data: unknown = null;
        try {
          data = JSON.parse(line.slice('data: '.length)) as unknown;
        } catch {
          data = null;
        }
        frames.push({ event: currentEvent, data });
      }
    }
    return frames;
  }

  function deltasOf(frames: { event: string; data: unknown }[]): string[] {
    return frames
      .filter((frame) => frame.event === 'delta')
      .map((frame) => (frame.data as { delta: string }).delta);
  }

  /** done 帧载荷形状（守伤断言只消费契约字段）。 */
  interface DonePayload {
    degraded: boolean;
    degradedReason: string | null;
    content: string;
    finishReason: string | null;
  }

  function donePayloadOf(frames: { event: string; data: unknown }[]): DonePayload {
    const done = frames.find((frame) => frame.event === 'done');
    // tp1-04 偏差④评审修复：biome noUnsafeOptionalChaining 禁不安全可选链 → 显式判空，
    // 原 `done?.data as …` 语义等价（done 为 undefined 时上方已抛错，不悬挂）。
    if (done === undefined) throw new Error('done 帧必须存在（不悬挂）');
    return (done.data as { response: DonePayload }).response;
  }

  it('半行拆帧：一条 data:{...} 拆两个 TCP chunk 再补全 → delta 完整解析（缓冲按换行切分残行保留回填）', async () => {
    const daemon = await createTestDaemon({
      envApiKey: FAKE_KEY,
      fetchImpl: async () =>
        chunkedSseResponse([
          'data: {"choices":[{"delta":{"content":"你', // 半行：无换行
          '好"}}]}\n\n', // 补全
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
      const frames = sseFrames(response.payload);
      // 残行回填后恰解析出一条完整 delta（不是 '你'/'好' 两截，也不是零帧）
      expect(deltasOf(frames)).toEqual(['你好']);
      const done = donePayloadOf(frames);
      expect(done.degraded).toBe(false);
      expect(done.content).toBe('你好');
      expect(done.finishReason).toBe('stop');
    } finally {
      await daemon.cleanup();
    }
  });

  it('中途断流（socket.destroy 形态）：done(degraded upstream-error) 且 partialContent=断流前已累积', async () => {
    const daemon = await createTestDaemon({
      envApiKey: FAKE_KEY,
      fetchImpl: async () =>
        chunkedSseResponse(['data: {"choices":[{"delta":{"content":"你好"}}]}\n\n'], {
          errorAtEnd: true,
        }),
    });
    try {
      const response = await daemon.app.inject({
        method: 'POST',
        url: '/ai/chat',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], stream: true }),
      });
      expect(response.statusCode).toBe(200);
      const frames = sseFrames(response.payload);
      expect(frames.some((frame) => frame.event === 'start')).toBe(true);
      expect(deltasOf(frames)).toEqual(['你好']); // 断流前已累积内容照常产出
      const done = donePayloadOf(frames);
      expect(done.degraded).toBe(true);
      expect(done.degradedReason).toBe('upstream-error');
      expect(done.content).toBe('你好'); // partialContent=断流前已累积，不假装完整
    } finally {
      await daemon.cleanup();
    }
  });

  it('残行 EOF：流以无换行半行结束 → 残行静默丢弃，done 按已累积内容收尾（不悬挂不假成功）', async () => {
    const daemon = await createTestDaemon({
      envApiKey: FAKE_KEY,
      fetchImpl: async () =>
        chunkedSseResponse([
          'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"，设界', // 半行 + EOF：静默丢弃
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
      const frames = sseFrames(response.payload);
      // 残行绝不以任何形态出现在 delta 流里
      expect(deltasOf(frames)).toEqual(['你好']);
      const done = donePayloadOf(frames);
      expect(done.degraded).toBe(false);
      expect(done.content).toBe('你好'); // 恰为已累积内容，无 fabricated 尾巴
    } finally {
      await daemon.cleanup();
    }
  });
});
