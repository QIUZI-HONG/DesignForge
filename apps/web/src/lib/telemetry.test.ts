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
});

/** 取 fetch 桩首次调用的 (url, init)（类型收窄，断言用）。 */
function fetchMockArgs(
  fetchImpl: ReturnType<typeof vi.fn>,
): [string, { method: string; body: string }] {
  const first = fetchImpl.mock.calls[0] as unknown as [string, { method: string; body: string }];
  return first;
}
