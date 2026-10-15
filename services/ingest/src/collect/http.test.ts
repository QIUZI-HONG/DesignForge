/**
 * 请求封装测试：请求纪律的可断言行为（规格 §3.2–§3.4）。
 *
 * 关注外部行为：GET-only、条件请求、304 不计预算、退避重试、连续限速熔断、
 * 每次往返记事件（URL/状态码/耗时/ETag）。
 */

import { describe, expect, it } from 'vitest';

import { FakeClock } from './__fixtures__/fake-clock.ts';
import type { HttpDeps, HttpResponseLike } from './http.ts';
import { requestText, sha256Hex } from './http.ts';
import {
  BudgetLedger,
  ConsecutiveRateLimitAbort,
  RateLimitWatch,
  RequestGovernor,
} from './ratelimit.ts';
import type { RawEvent } from './types.ts';

/** 剧本化 fetch：按调用顺序返回预设响应，并记录每次调用的入参。 */
function scriptedFetch(
  script: Array<{
    status: number;
    headers?: Record<string, string>;
    body?: string;
  }>,
): {
  fetchImpl: (
    url: string,
    init: { method: 'GET'; headers: Record<string, string> },
  ) => Promise<HttpResponseLike>;
  calls: Array<{ url: string; init: { method: string; headers: Record<string, string> } }>;
} {
  const calls: Array<{ url: string; init: { method: string; headers: Record<string, string> } }> =
    [];
  let i = 0;
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const step = script[i];
      i += 1;
      if (!step) throw new Error(`scriptedFetch：第 ${i} 次调用无剧本`);
      const headers = new Map(Object.entries(step.headers ?? {}));
      return {
        status: step.status,
        headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
        text: async () => step.body ?? '',
      };
    },
  };
}

function makeDeps(fetchImpl: HttpDeps['fetchImpl'], clock: FakeClock, events: RawEvent[]) {
  return {
    fetchImpl,
    clock,
    governor: new RequestGovernor({ clock }),
    ledger: new BudgetLedger({ clock }),
    rateLimitWatch: new RateLimitWatch({ threshold: 3 }),
    runId: 'test-run',
    onEvent: (e: RawEvent) => events.push(e),
    rand: () => 0.5,
  } satisfies HttpDeps;
}

describe('requestText 请求纪律', () => {
  it('200：返回正文与 ETag；事件记录 URL/状态码/耗时；计入预算', async () => {
    const clock = new FakeClock(1000);
    const events: RawEvent[] = [];
    const { fetchImpl, calls } = scriptedFetch([
      {
        status: 200,
        headers: { etag: 'W/"abc"', 'x-ratelimit-remaining': '4999', 'x-ratelimit-limit': '5000' },
        body: '{"ok":true}',
      },
    ]);
    const deps = makeDeps(fetchImpl, clock, events);

    const outcome = await requestText(deps, {
      url: 'https://api.github.com/repos/a/b',
      kind: 'core',
      headers: { authorization: 'token x' },
    });

    // 坑：`gh api -f` 会默认变 POST——封装必须显式 GET。
    expect(calls[0]?.init.method).toBe('GET');
    expect(outcome.status).toBe(200);
    expect(outcome.bodyText).toBe('{"ok":true}');
    expect(outcome.etag).toBe('W/"abc"');
    expect(outcome.cacheHit).toBe(false);
    expect(outcome.attempts).toBe(1);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      runId: 'test-run',
      request: {
        method: 'GET',
        url: 'https://api.github.com/repos/a/b',
        kind: 'core',
        attempt: 1,
        conditional: false,
      },
      response: {
        status: 200,
        etag: 'W/"abc"',
        countedAgainstBudget: true,
        quota: { limit: 5000, remaining: 4999 },
      },
    });
    expect(events[0]?.response.bodyDigest).toBe(`sha256:${sha256Hex('{"ok":true}')}`);
    expect(deps.ledger.count('core')).toBe(1);
  });

  it('条件请求：带 If-None-Match；304 命中缓存且不计预算（规格 §3.2）', async () => {
    const clock = new FakeClock();
    const events: RawEvent[] = [];
    const { fetchImpl, calls } = scriptedFetch([{ status: 304, headers: { etag: 'W/"abc"' } }]);
    const deps = makeDeps(fetchImpl, clock, events);

    const outcome = await requestText(deps, {
      url: 'https://api.github.com/repos/a/b',
      kind: 'core',
      ifNoneMatch: 'W/"abc"',
    });

    expect(calls[0]?.init.headers['if-none-match']).toBe('W/"abc"');
    expect(outcome.status).toBe(304);
    expect(outcome.cacheHit).toBe(true);
    expect(outcome.bodyText).toBeNull();
    expect(deps.ledger.count('core')).toBe(0);
    expect(deps.ledger.total('core')).toBe(1);
    expect(events[0]?.response.countedAgainstBudget).toBe(false);
  });

  it('5xx：指数退避后重试成功；两次往返各记一条事件', async () => {
    const clock = new FakeClock();
    const events: RawEvent[] = [];
    const { fetchImpl } = scriptedFetch([
      { status: 500, body: 'oops' },
      { status: 200, body: '{"ok":true}' },
    ]);
    const deps = makeDeps(fetchImpl, clock, events);

    const pending = requestText(deps, { url: 'https://api.github.com/x', kind: 'core' });
    await clock.advance(1000);
    const outcome = await pending;

    expect(outcome.ok).toBe(true);
    expect(outcome.status).toBe(200);
    expect(outcome.attempts).toBe(2);
    expect(events.map((e) => e.response.status)).toEqual([500, 200]);
    expect(events.map((e) => e.request.attempt)).toEqual([1, 2]);
  });

  it('403 + retry-after：按 retry-after 等待（最高优先）', async () => {
    const clock = new FakeClock();
    const events: RawEvent[] = [];
    const { fetchImpl } = scriptedFetch([
      { status: 403, headers: { 'retry-after': '30' } },
      { status: 200, body: '{}' },
    ]);
    const deps = makeDeps(fetchImpl, clock, events);

    const pending = requestText(deps, { url: 'https://api.github.com/x', kind: 'core' });
    await clock.advance(29_999);
    expect(events).toHaveLength(1);
    await clock.advance(1);
    const outcome = await pending;
    expect(outcome.attempts).toBe(2);
  });

  it('404/401 不重试（配置/权限问题），如实返回状态', async () => {
    const clock = new FakeClock();
    const events: RawEvent[] = [];
    const { fetchImpl } = scriptedFetch([{ status: 404, body: '{"message":"Not Found"}' }]);
    const deps = makeDeps(fetchImpl, clock, events);

    const outcome = await requestText(deps, { url: 'https://api.github.com/x', kind: 'core' });
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(404);
    expect(outcome.attempts).toBe(1);
    expect(events).toHaveLength(1);
  });

  it('连续限速失败达阈值 → 抛熔断错误（规格 §3.4：停整条流水线）', async () => {
    const clock = new FakeClock();
    const events: RawEvent[] = [];
    // 每次请求内部 5 次尝试全 403（无 retry-after）→ 每次请求本身即造成连续失败。
    const script = Array.from({ length: 8 }, () => ({ status: 403 }));
    const { fetchImpl } = scriptedFetch(script);
    const deps = makeDeps(fetchImpl, clock, events);
    deps.rateLimitWatch = new RateLimitWatch({ threshold: 3 });

    const first = requestText(deps, { url: 'https://api.github.com/a', kind: 'core' });
    await clock.advance(10 * 60_000);
    await expect(first).rejects.toBeInstanceOf(ConsecutiveRateLimitAbort);
  });

  it('search 端点默认不携带 If-None-Match（结果集天然漂移，规格 §3.2）', async () => {
    const clock = new FakeClock();
    const events: RawEvent[] = [];
    const { fetchImpl, calls } = scriptedFetch([{ status: 200, body: '{}' }]);
    const deps = makeDeps(fetchImpl, clock, events);

    await requestText(deps, {
      url: 'https://api.github.com/search/repositories?q=x',
      kind: 'search',
      // 即使调用方误传 etag，search 也不该发条件请求
      ifNoneMatch: 'W/"dead"',
      useEtag: false,
    });
    expect(calls[0]?.init.headers['if-none-match']).toBeUndefined();
  });
});

describe('sha256Hex', () => {
  it('确定性摘要（规格 §4.3 幂等键基础）', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abd')).not.toBe(sha256Hex('abc'));
  });
});
