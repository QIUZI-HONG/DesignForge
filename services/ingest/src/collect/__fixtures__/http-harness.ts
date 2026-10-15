/**
 * HTTP 测试夹具：剧本化 fetch 与依赖装配（多个测试文件共用）。
 *
 * 设计：按调用顺序返回预设响应；记录每次请求的 URL 与入参，供断言
 * 「一律 GET」「条件请求头」「Authorization 等」。
 */

import type { HttpDeps, HttpResponseLike } from '../http.ts';
import { BudgetLedger, RateLimitWatch, RequestGovernor } from '../ratelimit.ts';
import type { RawEvent } from '../types.ts';
import { FakeClock } from './fake-clock.ts';

export interface ScriptedStep {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface ScriptedFetch {
  fetchImpl: (
    url: string,
    init: { method: 'GET'; headers: Record<string, string> },
  ) => Promise<HttpResponseLike>;
  calls: { url: string; init: { method: string; headers: Record<string, string> } }[];
  /** 剩余剧本数（0 = 下次调用会抛错）。 */
  remaining(): number;
}

export function scriptedFetch(script: ScriptedStep[]): ScriptedFetch {
  const calls: ScriptedFetch['calls'] = [];
  let i = 0;
  return {
    calls,
    remaining: () => script.length - i,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const step = script[i];
      i += 1;
      if (!step) throw new Error(`scriptedFetch：第 ${i} 次调用无剧本（url=${url}）`);
      const headers = new Map(Object.entries(step.headers ?? {}));
      return {
        status: step.status,
        headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
        text: async () => step.body ?? '',
      };
    },
  };
}

/** 剧本化 JSON 响应（自动序列化 body）。 */
export function jsonStep(
  json: unknown,
  opts?: { status?: number; etag?: string; link?: string; extraHeaders?: Record<string, string> },
): ScriptedStep {
  const headers: Record<string, string> = { ...(opts?.extraHeaders ?? {}) };
  if (opts?.etag !== undefined) headers.etag = opts.etag;
  if (opts?.link !== undefined) headers.link = opts.link;
  return { status: opts?.status ?? 200, headers, body: JSON.stringify(json) };
}

export interface HttpHarness {
  deps: HttpDeps;
  events: RawEvent[];
  clock: FakeClock;
  script: ScriptedFetch;
}

export function makeHttpHarness(script: ScriptedStep[], opts?: { startMs?: number }): HttpHarness {
  const clock = new FakeClock(opts?.startMs ?? 1_700_000_000_000);
  const scripted = scriptedFetch(script);
  const events: RawEvent[] = [];
  const deps: HttpDeps = {
    fetchImpl: scripted.fetchImpl,
    governor: new RequestGovernor({ clock }),
    ledger: new BudgetLedger({ clock }),
    rateLimitWatch: new RateLimitWatch({ threshold: 3 }),
    runId: 'test-run',
    clock,
    onEvent: (e: RawEvent) => events.push(e),
    rand: () => 0.5,
  };
  return { deps, events, clock, script: scripted };
}
