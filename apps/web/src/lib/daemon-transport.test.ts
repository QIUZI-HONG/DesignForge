/**
 * daemon 传输 module 测试（arch-v1 · 票① · 候选 1）。
 *
 * seam：`request` / `openStream` 两个公开入口，注入假 fetch（不连真 daemon、不读写
 * 真实数据根）。断言的是**对外可观察行为**：请求落点与鉴权头、信封拆包、失败归一码、
 * 超时边界与 openStream 的「只界响应头」语义。
 */
import { describe, expect, it, vi } from 'vitest';

import { t } from '@/i18n';
import en from '../../messages/en.json';

import { openStream, request } from './daemon-transport';

const BASE = 'http://127.0.0.1:4318';

/** 造一个 JSON 响应。 */
function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 等流被 reader 锁定（= 传输层已开始读正文；1ms 轮询，上限约 200ms）。 */
async function waitForLocked(stream: ReadableStream<unknown>): Promise<boolean> {
  for (let i = 0; i < 200 && !stream.locked; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return stream.locked;
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

  it('非 JSON 响应 → daemon_bad_response（带状态与 invalid-json 理由，文案来自 i18n）', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 }));
    const result = await request({ method: 'GET', path: '/health' }, { baseUrl: BASE, fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('daemon_bad_response');
    expect(result.status).toBe(502);
    expect(result.details).toEqual({ reason: 'invalid-json' });
    expect(result.message).toBe(t('daemon.transport.badResponse'));
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

  it('响应头到达但正文永不落定 → 总超时 daemon_timeout，且底层流被 cancel（旧实现锁流后 cancel 无效）', async () => {
    // 真实故障形态：daemon 送了响应头，正文滴流挂死。30s 是**总**上限，不是只界响应头；
    // 到点必须真正取消上游流（`response.json()` 锁流后 `body.cancel()` 是无效操作，
    // 连接会永远悬着——本断言就是钉这一点）。
    let cancelled = false;
    const never = new ReadableStream<Uint8Array>({
      start() {
        // 永不 close/enqueue：read() 永远 pending
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(async () => new Response(never, { status: 200 }));
    const startedAt = Date.now();
    const result = await request(
      { method: 'GET', path: '/health' },
      { baseUrl: BASE, fetchImpl, timeoutMs: 30 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('daemon_timeout');
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(cancelled).toBe(true);
  });

  it('宿主替身只有 text() 且正文永不落定 → 总超时 daemon_timeout（回退分支同样必然落定，评审 R2-N2）', async () => {
    // 回退分支（无 body 流、只有 text()）没有 reader 可 cancel：旧实现直接 await 会永久
    // 挂住；正文读取现与 deadline.timeout race，到点照样落定（不能只在有 reader 时有界）。
    const stub = {
      ok: true,
      status: 200,
      body: null,
      text: () => new Promise<string>(() => undefined),
    } as unknown as Response;
    const fetchImpl = vi.fn(async () => stub);
    const startedAt = Date.now();
    const result = await request(
      { method: 'GET', path: '/health' },
      { baseUrl: BASE, fetchImpl, timeoutMs: 30 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('daemon_timeout');
    expect(Date.now() - startedAt).toBeLessThan(1_000);
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
    expect(result.message).toBe(t('daemon.transport.invalidShape'));
  });

  it('可识别 JSON 但不是信封 → daemon_bad_response（malformed-envelope，文案来自 i18n）', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }));
    const result = await request({ method: 'GET', path: '/health' }, { baseUrl: BASE, fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('daemon_bad_response');
    expect(result.details).toEqual({ reason: 'malformed-envelope' });
    expect(result.message).toBe(t('daemon.transport.malformedEnvelope'));
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

  it('响应头到达后调用方 abort → 上游流被 cancel，消费端收到终止（旧码：监听已摘，流悬挂）', async () => {
    // 故障形态：headers 已达，调用方（抽屉卸载 / 切换会话）abort；旧实现此时已摘掉
    // 调用方监听，上游流既不结束也不取消——消费方永久挂起、连接不释放。
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first'));
        // 之后永不 close：直到调用方 abort
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    const abort = new AbortController();
    const result = await openStream(
      { method: 'POST', path: '/ai/chat' },
      { baseUrl: BASE, fetchImpl, signal: abort.signal },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reader = result.stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    const pending = reader.read(); // 上游不再吐字节：这次 read 会挂住，直到 abort 传导
    abort.abort();
    const end = await pending;
    expect(end.done).toBe(true);
    expect(cancelled).toBe(true);
  });

  it('消费方 cancel → 上游流同样被 cancel（不泄漏连接）', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start() {
        // 永不吐字节：等消费方取消
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    const result = await openStream(
      { method: 'POST', path: '/ai/chat' },
      { baseUrl: BASE, fetchImpl },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.stream.cancel();
    expect(cancelled).toBe(true);
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

  it('非 2xx + 非 JSON 正文 → http_<status>（文案来自 i18n，带状态参数）', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    );
    const result = await openStream(
      { method: 'POST', path: '/ai/chat' },
      { baseUrl: BASE, fetchImpl, body: {} },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('http_502');
    expect(result.status).toBe(502);
    expect(result.message).toBe(t('daemon.transport.httpFailure', { status: 502 }));
  });

  it('非 2xx + 错误正文永不完成 + 调用方 abort → 有限时间返回 http_502 并取消上游（旧码永挂，评审 F6）', async () => {
    // 故障形态：反代/daemon 回了 502 响应头，错误正文的流永不 close；调用方（抽屉卸载）
    // abort。旧实现 `readJson` → `text()` 既不计时、headers 后也不再听调用方 signal，
    // openStream 永不落定，AI `chatStream` 卡在 await。修复后错误正文读取并入总预算。
    let cancelled = false;
    const never = new ReadableStream<Uint8Array>({
      start() {
        // 永不 close/enqueue：错误正文滴流挂死
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(async () => new Response(never, { status: 502 }));
    const abort = new AbortController();
    const startedAt = Date.now();
    const pending = openStream(
      { method: 'POST', path: '/ai/chat' },
      { baseUrl: BASE, fetchImpl, body: {}, signal: abort.signal },
    );
    // 等正文读取真正开始（body 被 reader 锁定）再 abort：钉的是 headers 之后的正文阶段
    expect(await waitForLocked(never)).toBe(true);
    abort.abort();

    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('http_502'); // 保留 HTTP 状态码，文案走既有 i18n 键
    expect(result.status).toBe(502);
    expect(result.message).toBe(t('daemon.transport.httpFailure', { status: 502 }));
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(cancelled).toBe(true);
  });

  it('非 2xx + 错误正文永不完成 → 到 timeoutMs 有界返回 http_502 并取消上游（评审 F6 超时分支）', async () => {
    let cancelled = false;
    const never = new ReadableStream<Uint8Array>({
      start() {
        // 永不 close/enqueue
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(async () => new Response(never, { status: 502 }));
    const startedAt = Date.now();
    const result = await openStream(
      { method: 'POST', path: '/ai/chat' },
      { baseUrl: BASE, fetchImpl, body: {}, timeoutMs: 30 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('http_502');
    expect(result.status).toBe(502);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(cancelled).toBe(true);
  });

  it('2xx 但无响应体 → daemon_bad_response（不假装流已建立，文案来自 i18n）', async () => {
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
    expect(result.message).toBe(t('daemon.transport.noBody'));
  });
});

describe('transport 文案 · i18n 目录（评审 F5）', () => {
  it('关键失败文案在 zh-CN / en 两目录同键（en 缺键会裸键直出）', () => {
    const keys = [
      'daemon.transport.badResponse',
      'daemon.transport.invalidShape',
      'daemon.transport.malformedEnvelope',
      'daemon.transport.httpFailure',
      'daemon.transport.noBody',
    ] as const;
    for (const key of keys) {
      const rendered = key === 'daemon.transport.httpFailure' ? t(key, { status: 500 }) : t(key);
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered).not.toBe(key); // 两目录皆缺键时原样回键
      expect((en as Record<string, string>)[key]?.length).toBeGreaterThan(0);
    }
    expect(t('daemon.transport.httpFailure', { status: 503 })).toContain('503');
  });
});
