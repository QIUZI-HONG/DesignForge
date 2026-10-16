/**
 * 市场检索（B9 搜索结果第二条线）测试（FE-02）。
 *
 * 口径：索引缺失是**空态而非错误**（daemon 契约 §market），网络不通同样降级为
 * `available: false`——首页搜索框不能因为市场侧不可用而整体报错。
 */
import { DAEMON_ROUTES, MARKETPLACE_INDEX_SCHEMA, type MarketAsset } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';

import { MARKET_RESULT_LIMIT, searchMarketAssets } from './market';

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

function okBody(items: MarketAsset[]) {
  return {
    ok: true,
    result: {
      schema: MARKETPLACE_INDEX_SCHEMA,
      state: items.length > 0 ? 'ok' : 'empty',
      generatedAt: null,
      total: items.length,
      counts: null,
      items,
      warnings: items.length === 0 ? [{ code: 'index-missing', message: '未找到索引' }] : [],
    },
  };
}

describe('searchMarketAssets', () => {
  it('GET /market/query?q=…&limit=…，返回显示名与类型', async () => {
    const { fetchImpl, calls } = fakeFetch({ body: okBody([asset('a/b', 'Skill A')]) });
    const result = await searchMarketAssets({ baseUrl: BASE, query: '设计', fetchImpl });

    expect(result.available).toBe(true);
    expect(result.items).toEqual([{ id: 'a/b', name: 'Skill A（中文名）', kind: 'skill' }]);
    expect(result.searchDegraded).toBe(false);
    const url = new URL(calls[0] ?? '');
    expect(url.pathname).toBe(DAEMON_ROUTES.marketQuery.path);
    expect(url.searchParams.get('q')).toBe('设计');
    expect(url.searchParams.get('limit')).toBe(String(MARKET_RESULT_LIMIT));
  });

  it('索引缺失（state=empty）→ 空结果但 available=true（空态而非错误）', async () => {
    const { fetchImpl } = fakeFetch({ body: okBody([]) });
    const result = await searchMarketAssets({ baseUrl: BASE, query: '任意', fetchImpl });
    expect(result).toEqual({ available: true, items: [], searchDegraded: false });
  });

  it('daemon 不可达 → available=false（首页搜索整体不报错）', async () => {
    const { fetchImpl } = fakeFetch({ reject: true });
    await expect(searchMarketAssets({ baseUrl: BASE, query: '任意', fetchImpl })).resolves.toEqual({
      available: false,
      items: [],
      searchDegraded: false,
    });
  });

  it('daemon 不响应（请求悬挂）→ 到注入上限降级为 available=false（有界出口，不永久挂起）', async () => {
    // 修复批次 3 · 工作包 C：市场检索走同一超时归一（`gateway-timeout`）。
    // 首页市场分组不能因为 daemon 不回话而永久停在「正在搜索…」。
    const never = (async () => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const outcome = await Promise.race([
      searchMarketAssets({ baseUrl: BASE, query: '设计', fetchImpl: never, timeoutMs: 20 }),
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
    await expect(searchMarketAssets({ baseUrl: BASE, query: '任意', fetchImpl })).resolves.toEqual({
      available: false,
      items: [],
      searchDegraded: false,
    });
  });

  it('检索索引降级（search-index-*）→ searchDegraded=true（首页「暂按字面匹配」提示的依据）', async () => {
    const { fetchImpl } = fakeFetch({
      body: {
        ok: true,
        result: {
          schema: MARKETPLACE_INDEX_SCHEMA,
          state: 'ok',
          generatedAt: null,
          total: 1,
          counts: null,
          items: [asset('a/b', 'Skill A')],
          warnings: [
            { code: 'search-index-missing', message: '未找到 BM25 检索索引：当前按字面匹配' },
          ],
        },
      },
    });
    const result = await searchMarketAssets({ baseUrl: BASE, query: '幻灯片', fetchImpl });

    expect(result.available).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.searchDegraded).toBe(true);
  });

  it('空查询直接返回空结果，不发请求', async () => {
    const { fetchImpl, calls } = fakeFetch({ body: okBody([asset('a', 'A')]) });
    const result = await searchMarketAssets({ baseUrl: BASE, query: '   ', fetchImpl });
    expect(result.items).toEqual([]);
    expect(result.searchDegraded).toBe(false);
    expect(calls).toEqual([]);
  });
});
