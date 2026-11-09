// @vitest-environment jsdom
/**
 * 首页市场结果线取数（arch-v1 · 票① · 候选 5：收回 market 公开面）。
 *
 * seam：`searchMarketHits`（纯取数，假 fetch）与 `useMarketSearchHits`（hook 状态机）。
 * 口径与旧 `features/home/api/market.ts` 一致——索引缺失/无匹配是空态、daemon 不可达
 * 降级为 `available:false`、3s deadline 给可读出口，**不抛给页面**。
 */
import { MARKETPLACE_INDEX_SCHEMA, type MarketAsset } from '@dforge/contracts';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MARKET_RESULT_LIMIT, searchMarketHits, useMarketSearchHits } from './use-market-search';

const BASE = 'http://127.0.0.1:4318';

/** 造一个市场资产（只填检索结果线关心的字段）。 */
function asset(id: string, name: string): MarketAsset {
  return {
    id,
    kind: 'skill',
    name,
    displayName: { 'zh-CN': `${name}（中文名）` },
    summary: {},
    source: {
      repo: 'owner/repo',
      repoId: 1,
      path: 'skills/x',
      ref: 'a'.repeat(40),
      fetchedAt: '2026-10-15T00:00:00.000Z',
      license: {
        spdx: 'MIT',
        gate: 'loadable',
        evidence: { path: 'LICENSE', sha256: 'f'.repeat(64) },
      },
      stars: 1,
      pushedAt: '2026-10-14T00:00:00.000Z',
      archived: false,
      homepage: null,
      upstream: 'owner/repo',
      brandDerived: false,
    },
    capabilities: [],
    facets: { category: '其他', lane: 'create', mode: 'other', tags: [], scenes: [] },
    quality: { score: 0.5, dims: { spec: 1, maintenance: 1, docs: 1, security: 1, ecosystem: 1 } },
    installGate: {
      mode: 'loadable',
      licenseGate: 'loadable',
      security: 'pass',
      reasons: [],
      ackRequired: [],
    },
    digest: '0'.repeat(64),
    embeddingRef: null,
    yanked: null,
  };
}

function fakeFetch(response: { status?: number; body?: unknown; reject?: boolean }) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    if (response.reject === true) throw new TypeError('ECONNREFUSED');
    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      json: async () => response.body,
    } as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function okBody(items: MarketAsset[], warnings: unknown[] = []) {
  return {
    ok: true,
    result: {
      schema: MARKETPLACE_INDEX_SCHEMA,
      state: items.length > 0 ? 'ok' : 'empty',
      generatedAt: null,
      total: items.length,
      counts: null,
      items,
      warnings: items.length === 0 ? [{ code: 'index-missing', message: '未找到索引' }] : warnings,
    },
  };
}

describe('searchMarketHits · 取数口径', () => {
  it('GET /market/query?q=…&limit=…，返回显示名与类型', async () => {
    const { fetchImpl, calls } = fakeFetch({ body: okBody([asset('a/b', 'Skill A')]) });
    const result = await searchMarketHits('设计', { baseUrl: BASE, fetchImpl });

    expect(result.available).toBe(true);
    expect(result.items).toEqual([{ id: 'a/b', name: 'Skill A（中文名）', kind: 'skill' }]);
    expect(result.searchDegraded).toBe(false);
    const url = new URL(calls[0] ?? '');
    expect(url.pathname).toBe('/market/query');
    expect(url.searchParams.get('q')).toBe('设计');
    expect(url.searchParams.get('limit')).toBe(String(MARKET_RESULT_LIMIT));
  });

  it('索引缺失（state=empty）→ 空结果但 available=true（空态而非错误）', async () => {
    const { fetchImpl } = fakeFetch({ body: okBody([]) });
    await expect(searchMarketHits('任意', { baseUrl: BASE, fetchImpl })).resolves.toEqual({
      available: true,
      items: [],
      searchDegraded: false,
    });
  });

  it('daemon 不可达 → available=false（首页搜索整体不报错）', async () => {
    const { fetchImpl } = fakeFetch({ reject: true });
    await expect(searchMarketHits('任意', { baseUrl: BASE, fetchImpl })).resolves.toEqual({
      available: false,
      items: [],
      searchDegraded: false,
    });
  });

  it('daemon 不响应 → 到注入上限降级为 available=false（有界出口，不永久挂起）', async () => {
    const never = (async () => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const outcome = await Promise.race([
      searchMarketHits('设计', { baseUrl: BASE, fetchImpl: never, timeoutMs: 20 }),
      new Promise<'pending'>((resolve) => {
        setTimeout(() => resolve('pending'), 300);
      }),
    ]);
    expect(outcome).toEqual({ available: false, items: [], searchDegraded: false });
  });

  it('失败信封 → available=false', async () => {
    const { fetchImpl } = fakeFetch({
      status: 500,
      body: { ok: false, error: { code: 'internal', message: 'x' } },
    });
    await expect(searchMarketHits('任意', { baseUrl: BASE, fetchImpl })).resolves.toEqual({
      available: false,
      items: [],
      searchDegraded: false,
    });
  });

  it('检索索引降级（search-index-*）→ searchDegraded=true（首页「暂按字面匹配」提示依据）', async () => {
    const { fetchImpl } = fakeFetch({
      body: okBody(
        [asset('a/b', 'Skill A')],
        [{ code: 'search-index-missing', message: '未找到 BM25 检索索引：当前按字面匹配' }],
      ),
    });
    const result = await searchMarketHits('幻灯片', { baseUrl: BASE, fetchImpl });

    expect(result.available).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.searchDegraded).toBe(true);
  });

  it('空查询直接返回空结果，不发请求', async () => {
    const { fetchImpl, calls } = fakeFetch({ body: okBody([asset('a', 'A')]) });
    await expect(searchMarketHits('   ', { baseUrl: BASE, fetchImpl })).resolves.toEqual({
      available: true,
      items: [],
      searchDegraded: false,
    });
    expect(calls).toEqual([]);
  });
});

describe('useMarketSearchHits · hook 状态机', () => {
  it('查询落定 → 返回命中；空查询复位为空态', async () => {
    const search = vi.fn(async () => ({
      available: true,
      items: [{ id: 'a/b', name: '图标技能', kind: 'skill' as const }],
      searchDegraded: false,
    }));
    const { result } = renderHook(() =>
      useMarketSearchHits('图标', { search, debounceMs: 0, deadlineMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.items).toEqual([{ id: 'a/b', name: '图标技能', kind: 'skill' }]);
    });
    expect(result.current.available).toBe(true);
    expect(search).toHaveBeenCalledWith('图标');
  });

  it('检索被拒 → 降级为 available=false（不留 unhandled rejection、不停在加载）', async () => {
    const search = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const { result } = renderHook(() =>
      useMarketSearchHits('图标', { search, debounceMs: 0, deadlineMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.available).toBe(false);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it('到 deadline 仍未落定 → 先落降级态（可读出口，不永久 loading）', async () => {
    const search = vi.fn(() => new Promise<never>(() => undefined));
    const { result } = renderHook(() =>
      useMarketSearchHits('图标', { search, debounceMs: 0, deadlineMs: 20 }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.available).toBe(false);
    });
  });

  it('结果迟到 → 覆盖降级态（自愈，不把已到的结果丢掉）', async () => {
    let release: ((value: Awaited<ReturnType<typeof searchMarketHits>>) => void) | undefined;
    const search = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<typeof searchMarketHits>>>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useMarketSearchHits('图标', { search, debounceMs: 0, deadlineMs: 20 }),
    );

    await waitFor(() => expect(result.current.available).toBe(false));
    release?.({
      available: true,
      items: [{ id: 'late', name: '迟到结果', kind: 'skill' }],
      searchDegraded: false,
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
  });

  it('空查询：不发请求并复位为「可用空态」', async () => {
    const search = vi.fn(async () => ({
      available: true,
      items: [{ id: 'x', name: 'X', kind: 'skill' as const }],
      searchDegraded: false,
    }));
    const { result } = renderHook(() =>
      useMarketSearchHits('  ', { search, debounceMs: 0, deadlineMs: 200 }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(search).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
    expect(result.current.available).toBe(true);
  });
});
