/**
 * 本地埋点发射客户端测试（票②）。
 *
 * 断言外部行为：POST `/telemetry/events`（信封体）、基址可注入、**fire-and-forget**——
 * 网络失败不抛异常也不产生 unhandled rejection（埋点永远不打扰用户）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emitTelemetryEvent } from './telemetry';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('emitTelemetryEvent（票② · 本地埋点发射）', () => {
  it('POST <base>/telemetry/events，体为 {name, payload} 信封', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, result: { stored: true, id: 'evt_1', reason: null } }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    );
    emitTelemetryEvent(
      'market.search',
      { query: 'pdf', hits: 2 },
      {
        baseUrl: 'http://daemon.test',
        fetchImpl,
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMockArgs(fetchImpl);
    expect(url).toBe('http://daemon.test/telemetry/events');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as { name: string; payload: unknown };
    expect(body.name).toBe('market.search');
    expect(body.payload).toEqual({ query: 'pdf', hits: 2 });
  });

  it('请求被拒：不抛异常、不产生 unhandled rejection（fire-and-forget）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('daemon down');
    });
    expect(() =>
      emitTelemetryEvent('market.view', undefined, { baseUrl: 'http://daemon.test', fetchImpl }),
    ).not.toThrow();
    // 等待微任务队列排空（拒绝已被客户端吞掉）
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('连接卫生：请求带 30s 超时信号（B5）——signal 注入 fetch，超时拒绝同样就地吞', async () => {
    let receivedSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      receivedSignal = init?.signal;
      // 模拟 daemon 挂死：永不结算，直到 signal abort 传导
      return new Promise<Response>((_resolve, reject) => {
        receivedSignal?.addEventListener('abort', () => reject(receivedSignal?.reason), {
          once: true,
        });
      });
    });
    expect(() =>
      emitTelemetryEvent('market.view', undefined, { baseUrl: 'http://daemon.test', fetchImpl }),
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // signal 已注入（AbortSignal.timeout 的平台原语；超时拒绝走同一 .catch 吞掉）
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);
    // 驱动到超时点（30s 太长不真等）：直接 abort 该信号模拟到点，拒绝仍被吞、无 unhandled rejection
    receivedSignal?.dispatchEvent(new Event('abort'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

/** 取 fetch 桩首次调用的 (url, init)（类型收窄，断言用）。 */
function fetchMockArgs(
  fetchImpl: ReturnType<typeof vi.fn>,
): [string, { method: string; body: string }] {
  const first = fetchImpl.mock.calls[0] as unknown as [string, { method: string; body: string }];
  return first;
}
