/**
 * 限速与请求纪律（规格《技能市场规格 v1》§3）。
 *
 * 职责：
 *  - 令牌桶（core 容量 4 / 1 req/s；search 容量 2 / 1 req/2.5s = 24/分，§3.4）；
 *  - 串行队列（并发 = 1，官方建议串行请求）；
 *  - Link 头分页解析（§3.5：只按 Link 走，禁手拼 page）；
 *  - 退避参数（§3.4 响应处置表：retry-after > x-ratelimit-reset > 指数退避）；
 *  - 预算账本（§3.1：core ≤4000/时、search ≤24/分；304 不计，§3.2）。
 *
 * 全部时间经注入的 `Clock`——生产用系统时钟，测试用虚拟时钟（确定性）。
 */

/** 注入时钟（时间即依赖：测试可完全控制）。 */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** 系统时钟（生产路径）。 */
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * 令牌桶：容量 `capacity`，每 `refillMs` 秒补充 1 个令牌（连续补充模型）。
 * 只保证节奏，不做请求本身；并发取令牌由串行队列兜底。
 */
export class TokenBucket {
  private readonly capacity: number;
  private readonly refillMs: number;
  private readonly clock: Clock;
  private tokens: number;
  private lastRefillMs: number;

  constructor(opts: { capacity: number; refillMs: number; clock?: Clock }) {
    if (opts.capacity <= 0) throw new Error('TokenBucket：capacity 必须为正');
    if (opts.refillMs <= 0) throw new Error('TokenBucket：refillMs 必须为正');
    this.capacity = opts.capacity;
    this.refillMs = opts.refillMs;
    this.clock = opts.clock ?? systemClock;
    this.tokens = opts.capacity;
    this.lastRefillMs = this.clock.now();
  }

  /** 当前可用令牌（按时间推进，不消耗）。 */
  available(): number {
    return this.advance(this.clock.now());
  }

  /** 取 1 个令牌；不足则睡到可用为止。 */
  async take(): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      const tokens = this.advance(now);
      if (tokens >= 1) {
        this.tokens = tokens - 1;
        return;
      }
      // 睡满缺口（连续补充模型下必然可用）；循环仅为防御性兜底。
      await this.clock.sleep((1 - tokens) * this.refillMs);
    }
  }

  private advance(nowMs: number): number {
    const elapsed = Math.max(0, nowMs - this.lastRefillMs);
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed / this.refillMs);
      this.lastRefillMs = nowMs;
    }
    return this.tokens;
  }
}

/** 串行队列：并发度恒为 1（规格 §3.4「并发 = 1」）。 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private inFlightCount = 0;

  get inFlight(): number {
    return this.inFlightCount;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      this.inFlightCount += 1;
      try {
        return await fn();
      } finally {
        this.inFlightCount -= 1;
      }
    });
    // 队列尾部吞掉错误，避免一次失败中断整条链（错误仍由返回的 Promise 抛出）。
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

/** 解析 Link 头 `rel="next"`；无 next 返回 null（规格 §3.5）。 */
export function parseLinkNext(link: string | null | undefined): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** 重试上限（规格 §3.4：指数退避上限 5 次后落 dead_letter）。 */
export const MAX_ATTEMPTS = 5;

/** 单次重试的最短等待（403/429 无 retry-after 时「先睡 ≥60s」）。 */
export const RETRY_FLOOR_MS = 60_000;

export interface RetryInput {
  status: number;
  headers: Record<string, string | undefined>;
  /** 已失败的尝试次数（从 1 起）。 */
  attempt: number;
  nowMs: number;
  /** 抖动源（0..1），测试注入固定值。 */
  rand?: () => number;
}

/**
 * 计算重试等待毫秒；`null` = 不重试（2xx/3xx、401/404、或已达次数上限）。
 * 优先级（规格 §3.4）：`retry-after` > `x-ratelimit-remaining: 0`（睡到 reset+5s）
 * > 403/429 至少 60s > 5xx 指数退避 1s→2s→4s…（±20% 抖动）。
 */
export function retryDelayMs(input: RetryInput): number | null {
  const { status, headers, attempt, nowMs } = input;
  const rand = input.rand ?? Math.random;

  const retryable = status === 403 || status === 429 || (status >= 500 && status <= 599);
  if (!retryable) return null;
  if (attempt >= MAX_ATTEMPTS) return null;

  const retryAfter = headers['retry-after'];
  if (retryAfter !== undefined && retryAfter !== '') {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  }

  if (headers['x-ratelimit-remaining'] === '0') {
    const resetSec = Number(headers['x-ratelimit-reset']);
    if (Number.isFinite(resetSec) && resetSec > 0) {
      return Math.max(0, resetSec * 1000 - nowMs) + 5_000;
    }
  }

  // 指数退避 1s→2s→4s→8s（第 1 次尝试为 1s），±20% 抖动。
  const base = 1_000 * 2 ** (attempt - 1);
  const jittered = Math.round(base * (0.8 + 0.4 * Math.min(1, Math.max(0, rand()))));
  if (status === 403 || status === 429) return Math.max(RETRY_FLOOR_MS, jittered);
  return jittered;
}

/** 预算快照（证据 JSON metrics 口径）。 */
export interface BudgetSnapshot {
  coreCalls: number;
  coreTotal: number;
  coreLimit: number;
  searchCalls: number;
  searchTotal: number;
  searchLimit: number;
  cacheHits304: number;
}

export interface BudgetViolation {
  kind: 'core' | 'search';
  used: number;
  limit: number;
  window: 'hour' | 'minute';
}

/**
 * 预算账本：滚动窗口计数 + 越限判定（规格 §3.1）。
 * `counted=false`（304）不计入窗口计数，但仍记 `total`（请求次数照记，供证据核对）。
 */
export class BudgetLedger {
  private readonly clock: Clock;
  private readonly coreLimit: number;
  private readonly searchLimit: number;
  private readonly coreEvents: number[] = [];
  private readonly searchEvents: number[] = [];
  private coreTotalCount = 0;
  private searchTotalCount = 0;
  private cacheHits = 0;

  constructor(opts?: { clock?: Clock; corePerHour?: number; searchPerMinute?: number }) {
    this.clock = opts?.clock ?? systemClock;
    this.coreLimit = opts?.corePerHour ?? 4_000;
    this.searchLimit = opts?.searchPerMinute ?? 24;
  }

  record(kind: 'core' | 'search', input: { counted: boolean; atMs: number }): void {
    if (kind === 'core') this.coreTotalCount += 1;
    else this.searchTotalCount += 1;
    if (input.counted) {
      if (kind === 'core') this.coreEvents.push(input.atMs);
      else this.searchEvents.push(input.atMs);
    } else if (kind === 'core') {
      this.cacheHits += 1;
    }
  }

  /** 记录一次 304 缓存命中（不计预算）。 */
  recordCacheHit(kind: 'core' | 'search'): void {
    if (kind === 'core') this.coreTotalCount += 1;
    else this.searchTotalCount += 1;
    if (kind === 'core') this.cacheHits += 1;
  }

  private windowCount(events: number[], windowMs: number): number {
    const since = this.clock.now() - windowMs;
    return events.filter((t) => t > since).length;
  }

  count(kind: 'core' | 'search'): number {
    return kind === 'core'
      ? this.windowCount(this.coreEvents, 3_600_000)
      : this.windowCount(this.searchEvents, 60_000);
  }

  /** 累计（不滑窗）请求数，含 304。 */
  total(kind: 'core' | 'search'): number {
    return kind === 'core' ? this.coreTotalCount : this.searchTotalCount;
  }

  overBudget(): BudgetViolation[] {
    const violations: BudgetViolation[] = [];
    const coreUsed = this.count('core');
    if (coreUsed > this.coreLimit) {
      violations.push({ kind: 'core', used: coreUsed, limit: this.coreLimit, window: 'hour' });
    }
    const searchUsed = this.count('search');
    if (searchUsed > this.searchLimit) {
      violations.push({
        kind: 'search',
        used: searchUsed,
        limit: this.searchLimit,
        window: 'minute',
      });
    }
    return violations;
  }

  snapshot(): BudgetSnapshot {
    return {
      coreCalls: this.count('core'),
      coreTotal: this.coreTotalCount,
      coreLimit: this.coreLimit,
      searchCalls: this.count('search'),
      searchTotal: this.searchTotalCount,
      searchLimit: this.searchLimit,
      cacheHits304: this.cacheHits,
    };
  }
}

/** 生产桶参数（规格 §3.4 原样落地）。 */
export const CORE_BUCKET = { capacity: 4, refillMs: 1_000 } as const;
export const SEARCH_BUCKET = { capacity: 2, refillMs: 2_500 } as const;

/**
 * 请求治理器：采集器**唯一出口**需先经 `acquire()` 取令牌。
 * 串行（并发 = 1）+ 按资源分桶。
 */
export class RequestGovernor {
  private readonly queue = new SerialQueue();
  private readonly buckets: Record<'core' | 'search', TokenBucket>;

  constructor(opts?: {
    clock?: Clock;
    core?: { capacity: number; refillMs: number };
    search?: { capacity: number; refillMs: number };
  }) {
    const clock = opts?.clock ?? systemClock;
    this.buckets = {
      core: new TokenBucket({ ...(opts?.core ?? CORE_BUCKET), clock }),
      search: new TokenBucket({ ...(opts?.search ?? SEARCH_BUCKET), clock }),
    };
  }

  /** 串行 + 桶：返回时即取得该资源的发送许可。 */
  acquire(kind: 'core' | 'search'): Promise<void> {
    return this.queue.run(() => this.buckets[kind].take());
  }

  get inFlight(): number {
    return this.queue.inFlight;
  }
}

/** 连续限速失败 → 停整条流水线（规格 §3.4 末行：持续越限可能被封禁）。 */
export class ConsecutiveRateLimitAbort extends Error {
  constructor(consecutive: number) {
    super(`连续 ${consecutive} 次限速失败，按纪律停止整条流水线（防封禁）`);
    this.name = 'ConsecutiveRateLimitAbort';
  }
}
