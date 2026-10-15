/**
 * 限速与请求纪律模块测试（规格 §3.2–§3.5）。
 *
 * 断言外部行为：令牌桶节奏、串行队列、条件请求、退避参数、Link 分页、预算账本——
 * 不触碰内部实现细节。
 */

import { describe, expect, it } from 'vitest';

import { FakeClock } from './__fixtures__/fake-clock.ts';
import {
  BudgetLedger,
  parseLinkNext,
  RequestGovernor,
  retryDelayMs,
  SerialQueue,
  TokenBucket,
} from './ratelimit.ts';

describe('TokenBucket 令牌桶（规格 §3.4：core 容量 4、1 req/s）', () => {
  it('容量内可即时取走，超出后按补充间隔等待', async () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket({ capacity: 2, refillMs: 1000, clock });

    await bucket.take();
    await bucket.take();
    expect(clock.now()).toBe(0);

    let taken = false;
    const wait = bucket.take().then(() => {
      taken = true;
    });
    await clock.advance(999);
    expect(taken).toBe(false);

    await clock.advance(1);
    await wait;
    expect(taken).toBe(true);
    expect(clock.now()).toBe(1000);
  });

  it('可用令牌按时间连续补充，且不超过容量上限', async () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket({ capacity: 2, refillMs: 1000, clock });
    expect(bucket.available()).toBe(2);
    await clock.advance(10_000);
    expect(bucket.available()).toBe(2);
    await bucket.take();
    await clock.advance(600);
    expect(bucket.available()).toBeCloseTo(1.6, 5);
  });
});

describe('SerialQueue 串行队列（规格 §3.4：并发 = 1）', () => {
  it('任务按提交顺序执行，任意时刻并发度为 1', async () => {
    const clock = new FakeClock();
    const queue = new SerialQueue();
    let inFlight = 0;
    let maxInFlight = 0;
    const order: number[] = [];

    const tasks = [1, 2, 3].map((n) =>
      queue.run(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await clock.sleep(n * 10);
        order.push(n);
        inFlight -= 1;
      }),
    );

    await clock.advance(1000);
    await Promise.all(tasks);

    expect(maxInFlight).toBe(1);
    expect(order).toEqual([1, 2, 3]);
  });

  it('任务抛错不阻塞后续任务，且不吞掉错误', async () => {
    const queue = new SerialQueue();
    const failed = queue.run(async () => {
      throw new Error('boom');
    });
    await expect(failed).rejects.toThrow('boom');
    await expect(queue.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('parseLinkNext Link 分页（规格 §3.5：只按 Link 走）', () => {
  it('取 rel="next" 的 URL', () => {
    const link =
      '<https://api.github.com/search/repositories?q=topic%3Aagent-skill&page=2>; rel="next", ' +
      '<https://api.github.com/search/repositories?q=topic%3Aagent-skill&page=34>; rel="last"';
    expect(parseLinkNext(link)).toBe(
      'https://api.github.com/search/repositories?q=topic%3Aagent-skill&page=2',
    );
  });

  it('无 next（仅 prev/last）时返回 null', () => {
    expect(parseLinkNext('<https://api.github.com/x?page=1>; rel="last"')).toBeNull();
    expect(parseLinkNext(null)).toBeNull();
    expect(parseLinkNext(undefined)).toBeNull();
    expect(parseLinkNext('')).toBeNull();
  });
});

describe('retryDelayMs 退避参数（规格 §3.4 响应处置表）', () => {
  const noHeaders: Record<string, string | undefined> = {};
  const nowMs = 1_000_000_000;

  it('401/404 不重试；2xx 不重试', () => {
    expect(retryDelayMs({ status: 404, headers: noHeaders, attempt: 1, nowMs })).toBeNull();
    expect(retryDelayMs({ status: 401, headers: noHeaders, attempt: 1, nowMs })).toBeNull();
    expect(retryDelayMs({ status: 200, headers: noHeaders, attempt: 1, nowMs })).toBeNull();
    expect(retryDelayMs({ status: 304, headers: noHeaders, attempt: 1, nowMs })).toBeNull();
  });

  it('retry-after 最高优先（秒）', () => {
    expect(retryDelayMs({ status: 403, headers: { 'retry-after': '30' }, attempt: 1, nowMs })).toBe(
      30_000,
    );
    expect(retryDelayMs({ status: 429, headers: { 'retry-after': '7' }, attempt: 2, nowMs })).toBe(
      7_000,
    );
  });

  it('配额耗尽 → 睡到 reset + 5s', () => {
    const resetSec = Math.floor(nowMs / 1000) + 100;
    expect(
      retryDelayMs({
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetSec) },
        attempt: 1,
        nowMs,
      }),
    ).toBe(100 * 1000 + 5_000);
  });

  it('403/429 无 retry-after → 至少 60s 起步', () => {
    expect(
      retryDelayMs({ status: 403, headers: noHeaders, attempt: 1, nowMs, rand: () => 0.5 }),
    ).toBe(60_000);
  });

  it('5xx → 指数退避（1s→2s→4s…，±20% 抖动）', () => {
    expect(
      retryDelayMs({ status: 500, headers: noHeaders, attempt: 1, nowMs, rand: () => 0.5 }),
    ).toBe(1_000);
    expect(
      retryDelayMs({ status: 502, headers: noHeaders, attempt: 2, nowMs, rand: () => 0.5 }),
    ).toBe(2_000);
    expect(
      retryDelayMs({ status: 500, headers: noHeaders, attempt: 3, nowMs, rand: () => 0 }), // -20%
    ).toBe(3_200);
    expect(
      retryDelayMs({ status: 500, headers: noHeaders, attempt: 3, nowMs, rand: () => 1 }), // +20%
    ).toBe(4_800);
  });

  it('超过重试上限（5 次）不再重试', () => {
    expect(
      retryDelayMs({ status: 500, headers: noHeaders, attempt: 5, nowMs, rand: () => 0.5 }),
    ).toBeNull();
  });
});

describe('BudgetLedger 预算账本（规格 §3.1：core ≤4000/时、search ≤24/分）', () => {
  it('按滚动窗口统计，304 不计入（规格 §3.2）', () => {
    const clock = new FakeClock();
    const ledger = new BudgetLedger({ clock });

    ledger.record('core', { counted: true, atMs: clock.now() });
    ledger.record('core', { counted: false, atMs: clock.now() }); // 304 缓存命中
    ledger.record('search', { counted: true, atMs: clock.now() });
    expect(ledger.count('core')).toBe(1);
    expect(ledger.count('search')).toBe(1);
    expect(ledger.total('core')).toBe(2);
  });

  it('窗口外的事件滑出计数', async () => {
    const clock = new FakeClock();
    const ledger = new BudgetLedger({ clock });
    ledger.record('search', { counted: true, atMs: clock.now() });
    await clock.advance(61_000);
    expect(ledger.count('search')).toBe(0);
    expect(ledger.total('search')).toBe(1);
  });

  it('越预算可判定（core ≤4000/时、search ≤24/分）', () => {
    const clock = new FakeClock();
    const ledger = new BudgetLedger({ clock });
    for (let i = 0; i < 24; i += 1) ledger.record('search', { counted: true, atMs: 0 });
    expect(ledger.overBudget()).toEqual([]);
    ledger.record('search', { counted: true, atMs: 0 });
    expect(ledger.overBudget()).toEqual([
      { kind: 'search', used: 25, limit: 24, window: 'minute' },
    ]);

    for (let i = 0; i < 4001; i += 1) ledger.record('core', { counted: true, atMs: 0 });
    expect(ledger.overBudget()).toEqual([
      { kind: 'core', used: 4001, limit: 4000, window: 'hour' },
      { kind: 'search', used: 25, limit: 24, window: 'minute' },
    ]);
  });

  it('快照含起始余量口径（证据 JSON metrics 用）', () => {
    const clock = new FakeClock(5_000);
    const ledger = new BudgetLedger({ clock });
    ledger.record('core', { counted: true, atMs: 5_000 });
    ledger.record('core', { counted: false, atMs: 5_000 });
    expect(ledger.snapshot()).toMatchObject({
      coreCalls: 1,
      coreTotal: 2,
      searchCalls: 0,
      cacheHits304: 1,
      coreLimit: 4000,
      searchLimit: 24,
    });
  });
});

describe('RequestGovernor 串行 + 桶（出口唯一化）', () => {
  it('core 桶参数（容量 4、1 req/s）下第 5 次请求按节奏等待', async () => {
    const clock = new FakeClock();
    const governor = new RequestGovernor({ clock });
    const stamps: number[] = [];
    const tasks = Array.from({ length: 5 }, () =>
      governor.acquire('core').then(() => {
        stamps.push(clock.now());
      }),
    );
    await clock.advance(10_000);
    await Promise.all(tasks);
    expect(stamps).toEqual([0, 0, 0, 0, 1000]);
  });

  it('search 桶参数（容量 2、1 req/2.5s = 24/分）', async () => {
    const clock = new FakeClock();
    const governor = new RequestGovernor({ clock });
    const stamps: number[] = [];
    const tasks = Array.from({ length: 3 }, () =>
      governor.acquire('search').then(() => {
        stamps.push(clock.now());
      }),
    );
    await clock.advance(10_000);
    await Promise.all(tasks);
    expect(stamps).toEqual([0, 0, 2500]);
  });
});
