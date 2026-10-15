/**
 * AI 端口测试（seam：注入 fetch 后，端口的对外可观察行为）。
 *
 * 断言口径：请求打到的路径/方法/请求体（daemon 契约面）与返回值的解包语义；
 * 失败信封 → 抛出带错误码的异常（步骤机据此落到 failed 步）。
 */
import { describe, expect, it, vi } from 'vitest';

import { createAiPort, DaemonRequestError, resolveDaemonBaseUrl } from './client';

/** 构造成功信封响应。 */
function jsonResponse(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 构造失败信封响应。 */
function failureResponse(code: string, message: string, status = 500): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message, details: null } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 构造 SSE 响应（分两块吐字节，模拟真实流式）。 */
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

describe('AI 端口', () => {
  it('status()：GET /ai/status 并解包 result（未配置态也是正常响应）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
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
        degradedHint: '未配置 DeepSeek key：AI 功能为降级态',
      }),
    );
    const port = createAiPort({ baseUrl: 'http://127.0.0.1:4318', fetchImpl });
    const status = await port.status();
    expect(status.configured).toBe(false);
    expect(status.degradedHint).toContain('降级态');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:4318/ai/status');
    expect(init.method).toBe('GET');
  });

  it('chatStream()：POST /ai/chat（stream:true）逐块产出 SSE 文本', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        sseResponse(['event: start\ndata: {"type":"start"}\n\n', 'event: done\ndata: {}\n\n']),
      );
    const port = createAiPort({ baseUrl: 'http://127.0.0.1:4318', fetchImpl });
    const chunks: string[] = [];
    for await (const chunk of port.chatStream({
      messages: [{ role: 'user', content: '画一个按钮' }],
    })) {
      chunks.push(chunk);
    }
    expect(chunks.join('')).toContain('event: start');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:4318/ai/chat');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      messages: [{ role: 'user', content: '画一个按钮' }],
      stream: true,
    });
  });

  it('失败信封 → 抛 DaemonRequestError（带错误码，供失败步落点）', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(failureResponse('ai_invalid_request', 'messages 必须是非空数组', 400));
    const port = createAiPort({ baseUrl: 'http://127.0.0.1:4318', fetchImpl });
    const error = await port.status().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DaemonRequestError);
    expect((error as DaemonRequestError).code).toBe('ai_invalid_request');
    expect((error as DaemonRequestError).message).toBe('messages 必须是非空数组');
  });

  it('解析基础地址：显式参数 > NEXT_PUBLIC_DF_DAEMON_URL > 缺省 4318', () => {
    expect(resolveDaemonBaseUrl('http://127.0.0.1:9999')).toBe('http://127.0.0.1:9999');
    expect(resolveDaemonBaseUrl()).toBe('http://127.0.0.1:4318');
  });
});
