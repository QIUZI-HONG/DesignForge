/**
 * 请求封装（规格 §3 采集纪律的落地点）。
 *
 * 纪律要点（每条都可在证据 JSON 复算）：
 *  - **一律 GET**：`gh api -f` 默认变 POST 的坑（研究 #4 §3.7 实测：12 次 404 且照扣配额）
 *    在这里被结构性禁止——`FetchLike` 的 method 类型即为字面量 `'GET'`；
 *  - 条件请求：仅 core 资源可带 `If-None-Match`（search 结果集天然漂移，§3.2）；
 *    304 命中缓存 → **不计预算**；
 *  - 退避：`retryDelayMs`（retry-after > x-ratelimit-reset > 指数退避）；
 *  - 连续限速失败达阈值 → 抛 `ConsecutiveRateLimitAbort` 停整条流水线；
 *  - 每次往返（含重试与失败）记一条 `RawEvent`（URL/状态码/耗时/ETag/配额余量）；
 *  - 单请求超时：`withRequestTimeout` 包裹 fetch 出口（票 12 / 证据 §D3）——生产 fetch 纯透传
 *    无 signal 时，挂起的上游会冻结整条流水线（undici 隐式 300s × 5 次重试 ≈ 25 分钟/URL 起步，
 *    慢滴流端点理论无界）。超时按**既有网络错误语义**走重试/记账/留痕，整轮必然收敛。
 */

import { createHash } from 'node:crypto';

import type { Clock } from './ratelimit.ts';
import {
  type BudgetLedger,
  MAX_ATTEMPTS,
  type RateLimitWatch,
  type RequestGovernor,
  retryDelayMs,
  systemClock,
} from './ratelimit.ts';
import type { RawEvent } from './types.ts';

/**
 * fetch 抛出的**不可重试**错误（如离线样本缺失）：`requestText` 直接上抛，
 * 不当作网络抖动退避重试。
 */
export class NonRetryableFetchError extends Error {}

/** 摘要（确定性；ODS 幂等键与证据哈希的基础）。 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 响应最小面（全局 `fetch` 的 `Response` 天然兼容）。 */
export interface HttpResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/**
 * fetch 形态。method 恒为 `GET`——类型层面关闭「误发 POST」的可能。
 * `init.signal` 为可选中止信号（单请求超时经此传给真网 fetch；重放/测试假 fetch 可忽略）。
 */
export type FetchLike = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<HttpResponseLike>;

/**
 * 单请求超时默认值（票 12 / 证据 §D3，30s 量级）：
 * undici 隐式 300s × MAX_ATTEMPTS 5 次重试 ≈ 25 分钟/URL 起步，采集轮不可接受；
 * 30s 内正常响应的 GitHub REST 端点（元数据/树/正文）远够用。
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * 单请求超时（可重试）：**不**继承 `NonRetryableFetchError`——超时按既有网络错误语义
 * 退避重试（`requestText` 的 status 0 路径），重试耗尽如实上报。
 */
export class RequestTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`请求超时（${timeoutMs}ms 无响应）：${url}`);
    this.name = 'RequestTimeoutError';
  }
}

/**
 * 单请求超时包裹（票 12 / 证据 §D3）：给 fetch 出口注入 `AbortSignal.timeout(timeoutMs)`。
 *
 * 双保险设计：
 *  1. **signal 注入 init**——真网 fetch（undici）据此中止请求、真正释放 socket，
 *     超时后不留 300s 隐式尾巴；调用方已有 signal 时经 `AbortSignal.any` 合并；
 *  2. **真实墙钟 race**——假 fetch / 不理会 signal 的实现也能被超时打断（测试注入的
 *     「永不 settle」假 fetch 抓的就是这个），整轮采集必然收敛。
 *
 * 响应头与正文读取共用同一超时预算（慢滴流端点：headers 已到但正文滴流不止 → 同样收敛），
 * 正文在预算内预读，返回的响应 `text()` 直接复用已读内容。
 *
 * 为什么用真实时间而非注入 `Clock`：离线重放走冻结时钟（`sleep` 立即返回），
 * 超时若骑在注入时钟上会把重放全判成超时；超时是网络请求的真实墙钟属性，不属 pacing。
 */
export function withRequestTimeout(inner: FetchLike, timeoutMs: number): FetchLike {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`withRequestTimeout：timeoutMs 必须为正有限数（收到 ${timeoutMs}）`);
  }
  return async (url, init) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal =
      init.signal === undefined ? timeoutSignal : AbortSignal.any([init.signal, timeoutSignal]);
    const initNext: typeof init & { signal: AbortSignal } = { ...init, signal };

    // signal 中止 → race 以 RequestTimeoutError 落败；inner 先 settle → 摘掉监听避免悬挂。
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new RequestTimeoutError(url, timeoutMs));
      if (timeoutSignal.aborted) onAbort();
      else timeoutSignal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const res = await Promise.race([inner(url, initNext), aborted]);
      const bodyText = await Promise.race([res.text(), aborted]);
      return { status: res.status, headers: res.headers, text: async () => bodyText };
    } finally {
      if (onAbort !== undefined) timeoutSignal.removeEventListener('abort', onAbort);
    }
  };
}

export interface HttpDeps {
  fetchImpl: FetchLike;
  governor: RequestGovernor;
  ledger: BudgetLedger;
  rateLimitWatch: RateLimitWatch;
  runId: string;
  clock?: Clock;
  onEvent?: (event: RawEvent) => void;
  /** 抖动源（测试注入固定值）。 */
  rand?: () => number;
  maxAttempts?: number;
}

export interface HttpRequestSpec {
  url: string;
  kind: 'core' | 'search';
  /** 额外请求头（如 Authorization）；不得覆盖 method 语义。 */
  headers?: Record<string, string>;
  /** 上次响应的 ETag（core 资源才发条件请求）。 */
  ifNoneMatch?: string | null;
  /** 显式关闭条件请求（默认 core 开启、search 关闭）。 */
  useEtag?: boolean;
}

export interface HttpOutcome {
  url: string;
  status: number;
  /** 2xx/304 为 true。 */
  ok: boolean;
  /** 2xx 的正文；304 与网络错误为 null。 */
  bodyText: string | null;
  etag: string | null;
  linkNext: string | null;
  /** true = 304 命中本地 ETag 缓存（调用方应使用缓存内容）。 */
  cacheHit: boolean;
  attempts: number;
  durationMs: number;
  /** 网络层错误信息（fetch 抛错且重试耗尽）；正常响应为 null。 */
  errorMessage: string | null;
}

function headerValue(res: HttpResponseLike, name: string): string | null {
  return res.headers.get(name) ?? null;
}

function quotaOf(res: HttpResponseLike): RawEvent['response']['quota'] {
  const limit = headerValue(res, 'x-ratelimit-limit');
  const remaining = headerValue(res, 'x-ratelimit-remaining');
  const reset = headerValue(res, 'x-ratelimit-reset');
  if (limit === null && remaining === null && reset === null) return null;
  const asNumber = (v: string | null): number | null => {
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const resetSec = asNumber(reset);
  return {
    limit: asNumber(limit),
    remaining: asNumber(remaining),
    resetAtMs: resetSec === null ? null : resetSec * 1000,
  };
}

/**
 * 发一次（可重试的）GET 请求。返回时保证：预算已入账、事件已记录、退避已按纪律执行。
 */
export async function requestText(deps: HttpDeps, spec: HttpRequestSpec): Promise<HttpOutcome> {
  const clock = deps.clock ?? systemClock;
  const maxAttempts = deps.maxAttempts ?? MAX_ATTEMPTS;
  // 条件请求仅用于 core 资源（规格 §3.2：列表类端点不用 ETag）。
  const conditional =
    spec.kind === 'core' && spec.useEtag !== false && Boolean(spec.ifNoneMatch ?? null);

  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(spec.headers ?? {}),
  };
  if (conditional && spec.ifNoneMatch) headers['if-none-match'] = spec.ifNoneMatch;

  let attempts = 0;
  for (;;) {
    attempts += 1;
    await deps.governor.acquire(spec.kind);

    const startedAtMs = clock.now();
    let res: HttpResponseLike | null = null;
    let errorMessage: string | null = null;
    try {
      res = await deps.fetchImpl(spec.url, { method: 'GET', headers });
    } catch (error) {
      // 不可重试错误（如 ReplayMissError）直接上抛：重放样本缺失是配置问题，不是网络抖动。
      if (error instanceof NonRetryableFetchError) throw error;
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    const endedAtMs = clock.now();
    const durationMs = endedAtMs - startedAtMs;

    if (res) {
      const status = res.status;
      const etag = headerValue(res, 'etag');
      const linkNext = headerValue(res, 'link');
      const is304 = status === 304;
      const bodyText = is304 || (status >= 300 && status !== 304) ? null : await res.text();
      const counted = !is304; // 304 不计主限额（规格 §3.2）
      deps.ledger.record(spec.kind, { counted, atMs: endedAtMs });

      emitEvent(deps, {
        runId: deps.runId,
        url: spec.url,
        kind: spec.kind,
        attempt: attempts,
        conditional,
        status,
        etag,
        linkNext: linkNext ? extractLinkNext(linkNext) : null,
        bodyDigest: bodyText === null ? null : `sha256:${sha256Hex(bodyText)}`,
        counted,
        quota: quotaOf(res),
        startedAtMs,
        endedAtMs,
        durationMs,
      });

      const ok = (status >= 200 && status < 300) || is304;
      if (status === 403 || status === 429) deps.rateLimitWatch.noteRateLimited();
      else deps.rateLimitWatch.noteResolved();

      const delay = ok
        ? null
        : retryDelayMs({
            status,
            headers: headerMap(res),
            attempt: attempts,
            nowMs: endedAtMs,
            ...(deps.rand ? { rand: deps.rand } : {}),
          });

      if (ok || delay === null || attempts >= maxAttempts) {
        return {
          url: spec.url,
          status,
          ok,
          bodyText,
          etag,
          linkNext: linkNext ? extractLinkNext(linkNext) : null,
          cacheHit: is304,
          attempts,
          durationMs,
          errorMessage: null,
        };
      }
      await clock.sleep(delay);
      continue;
    }

    // 网络层错误：按 5xx 同族指数退避重试（规格 §3.4），重试耗尽如实上报（调用方按 exit 2 阻塞）。
    deps.ledger.record(spec.kind, { counted: true, atMs: endedAtMs });
    emitEvent(deps, {
      runId: deps.runId,
      url: spec.url,
      kind: spec.kind,
      attempt: attempts,
      conditional,
      status: 0,
      etag: null,
      linkNext: null,
      bodyDigest: null,
      counted: true,
      quota: null,
      startedAtMs,
      endedAtMs,
      durationMs,
    });
    const delay = retryDelayMs({
      status: 500,
      headers: {},
      attempt: attempts,
      nowMs: endedAtMs,
      ...(deps.rand ? { rand: deps.rand } : {}),
    });
    if (delay === null || attempts >= maxAttempts) {
      return {
        url: spec.url,
        status: 0,
        ok: false,
        bodyText: null,
        etag: null,
        linkNext: null,
        cacheHit: false,
        attempts,
        durationMs,
        errorMessage,
      };
    }
    await clock.sleep(delay);
  }
}

function headerMap(res: HttpResponseLike): Record<string, string | undefined> {
  const names = ['retry-after', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-limit'];
  const out: Record<string, string | undefined> = {};
  for (const name of names) {
    const value = res.headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

/** 从 Link 头抽出 rel="next"（仅为事件留痕，翻页决策在 candidates 层）。 */
function extractLinkNext(link: string): string | null {
  for (const part of link.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (match?.[1]) return match[1];
  }
  return null;
}

function emitEvent(
  deps: HttpDeps,
  input: {
    runId: string;
    url: string;
    kind: 'core' | 'search';
    attempt: number;
    conditional: boolean;
    status: number;
    etag: string | null;
    linkNext: string | null;
    bodyDigest: string | null;
    counted: boolean;
    quota: RawEvent['response']['quota'];
    startedAtMs: number;
    endedAtMs: number;
    durationMs: number;
  },
): void {
  deps.onEvent?.({
    ts: new Date(input.endedAtMs).toISOString(),
    runId: input.runId,
    request: {
      method: 'GET',
      url: input.url,
      kind: input.kind,
      attempt: input.attempt,
      conditional: input.conditional,
    },
    response: {
      status: input.status,
      etag: input.etag,
      linkNext: input.linkNext,
      bodyDigest: input.bodyDigest,
      countedAgainstBudget: input.counted,
      quota: input.quota,
    },
    startedAtMs: input.startedAtMs,
    endedAtMs: input.endedAtMs,
    durationMs: input.durationMs,
  });
}
