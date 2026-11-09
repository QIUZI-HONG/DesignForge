/**
 * daemon 传输 module 测试（arch-v1 · 票① · 候选 1）。
 *
 * seam：`request` / `openStream` 两个公开入口，注入假 fetch（不连真 daemon、不读写
 * 真实数据根）。断言的是**对外可观察行为**：请求落点与鉴权头、信封拆包、失败归一码、
 * 超时边界与 openStream 的「只界响应头」语义。
 */
import { describe, expect, it, vi } from 'vitest';

import { openStream, request } from './daemon-transport';

const BASE = 'http://127.0.0.1:4318';

/** 造一个 JSON 响应。 */
function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('request · 信封与传输失败归一', () => {
  it('成功信封 → { ok:true, value }，请求落点取路由表并带鉴权头', async () => {
    vi.stubEnv('NEXT_PUBLIC_DF_DAEMON_TOKEN', 'tok-test');
    try {
      const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, result: { hello: '世界' } }));
      const result = await request<{ hello: string }>(
        { method: 'GET', path: '/health' },
        { baseUrl: BASE, fetchImpl },
      );

      expect(result).toEqual({ ok: true, value: { hello: '世界' } });
      const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(call[0]).toBe(`${BASE}/health`);
      expect(call[1].method).toBe('GET');
      expect(call[1].headers).toMatchObject({ 'x-df-token': 'tok-test' });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('失败信封 → 透传 daemon 错误码 / 文案 / details / HTTP 状态', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          ok: false,
          error: {
            code: 'doc_not_found',
            message: '文档不存在',
            details: { documentId: 'x' },
          },
        },
        404,
      ),
    );
    const result = await request(
      { method: 'GET', path: '/documents/x' },
      { baseUrl: BASE, fetchImpl },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('doc_not_found');
    expect(result.message).toBe('文档不存在');
    expect(result.details).toEqual({ documentId: 'x' });
    expect(result.status).toBe(404);
  });

  it('非 JSON 响应 → daemon_bad_response（带状态与 invalid-json 理由）', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 }));
    const result = await request({ method: 'GET', path: '/health' }, { baseUrl: BASE, fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('daemon_bad_response');
    expect(result.status).toBe(502);
    expect(result.details).toEqual({ reason: 'invalid-json' });
  });

  it('网络异常 → daemon_unreachable（保留原始技术信息，不伪装成 HTTP 码）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const result = await request({ method: 'GET', path: '/health' }, { baseUrl: BASE, fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('daemon_unreachable');
    expect(result.message).toContain('fetch failed');
  });

  it('请求悬挂 → 到 timeoutMs 有界失败为 daemon_timeout，并 abort 在飞请求', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const fetchImpl = ((_: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined);
      return new Promise<Response>(() => undefined);
    }) as typeof fetch;

    const result = await request(
      { method: 'GET', path: '/health' },
      { baseUrl: BASE, fetchImpl, timeoutMs: 20 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('daemon_timeout');
    expect(result.message).toContain('请求超时');
    expect(signals[0]?.aborted).toBe(true);
  });

  it('validate 判定形状不符 → daemon_bad_response（不让脏 result 过关）', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, result: { nope: true } }));
    const result = await request<{ n: number }>(
      { method: 'GET', path: '/x' },
      {
        baseUrl: BASE,
        fetchImpl,
        validate: (value): value is { n: number } =>
          typeof value === 'object' &&
          value !== null &&
          typeof (value as { n?: unknown }).n === 'number',
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('daemon_bad_response');
    expect(result.details).toEqual({ reason: 'invalid-shape' });
  });
});

describe('openStream · 只界响应头的流式语义', () => {
  /** 造一个 SSE 响应（分两块吐字节）。 */
  function sseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  it('成功 → 返回原始字节流与 Response（SSE 解析不在这里做）', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse(['event: start\ndata: {}\n\n', 'event: done\ndata: {}\n\n']),
    );
    const result = await openStream(
      { method: 'POST', path: '/ai/chat' },
      { baseUrl: BASE, fetchImpl, body: { messages: [{ role: 'user', content: 'hi' }] } },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reader = result.stream.getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toContain('event: start');
    expect(result.response.status).toBe(200);
  });

  it('建连悬挂 → 到 timeoutMs 失败为 daemon_timeout，并 abort 在飞请求（不留下悬挂 socket）', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const fetchImpl = ((_: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined);
      return new Promise<Response>(() => undefined);
    }) as typeof fetch;

    const result = await openStream(
      { method: 'POST', path: '/ai/chat' },
      { baseUrl: BASE, fetchImpl, timeoutMs: 20 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('daemon_timeout');
    expect(signals[0]?.aborted).toBe(true);
  });

  it('响应头到达后不再 abort body（body 慢速滴流仍可读完）', async () => {
    // 分两块：第二块延迟到达；总计超过 timeoutMs——若实现把计时器留到 body 读完，会被 abort
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('first'));
        setTimeout(() => {
          controller.enqueue(encoder.encode('second'));
          controller.close();
        }, 60);
      },
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );

    const result = await openStream(
      { method: 'POST', path: '/ai/chat' },
      { baseUrl: BASE, fetchImpl, timeoutMs: 10 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reader = result.stream.getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toBe('firstsecond');
  });

  it('非 2xx + 失败信封 → 透传 daemon 错误码与状态（与既有 AI 客户端同序）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { ok: false, error: { code: 'ai_invalid_request', message: 'messages 必须是非空数组' } },
        400,
      ),
    );
    const result = await openStream(
      { method: 'POST', path: '/ai/chat' },
      { baseUrl: BASE, fetchImpl, body: {} },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ai_invalid_request');
    expect(result.message).toBe('messages 必须是非空数组');
    expect(result.status).toBe(400);
  });

  it('2xx 但无响应体 → daemon_bad_response（不假装流已建立）', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 204, headers: { 'content-type': 'text/event-stream' } }),
    );
    const result = await openStream(
      { method: 'POST', path: '/ai/chat' },
      { baseUrl: BASE, fetchImpl },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('daemon_bad_response');
    expect(result.details).toEqual({ reason: 'no-body' });
  });
});
