import { readFileSync } from 'node:fs';

import type { MarketplaceIndex } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';

import { buildMarketplaceIndex } from './build.ts';
import { type DwsAssetRecord, readDwsSample } from './dws.ts';
import { EXAMPLE_QUERIES } from './query-set.ts';
import {
  buildSearchIndex,
  type MarketSearchHit,
  percentile,
  SEARCH_INDEX_SCHEMA,
  searchAssets,
  searchMarketIndex,
} from './search.ts';

const OPTIONS = {
  generatedAt: '2026-10-15T23:00:00Z',
  collector: {
    name: 'df-market',
    version: '0.1.0',
    runId: '20261015-2300',
    odsWatermark: '2026-10-15T22:40:00Z',
  },
};

function readFixture(): DwsAssetRecord[] {
  const raw = readFileSync(
    new URL('./__fixtures__/dws-assets.sample.json', import.meta.url),
    'utf8',
  );
  return readDwsSample(JSON.parse(raw)).assets;
}

function buildCards(): MarketplaceIndex {
  return buildMarketplaceIndex(readFixture(), OPTIONS);
}

describe('示例查询集 · 命中率（判据链第 5 环）', () => {
  const index = buildCards();
  const results = EXAMPLE_QUERIES.map((example) => ({
    example,
    response: searchAssets(index.assets, example.q, {
      ...(example.filters === undefined ? {} : { filters: example.filters }),
      limit: 10,
    }),
  }));
  const snapshot: Record<string, { total: number; top: string[] }> = {};
  for (const { example, response } of results) {
    snapshot[example.id] = { total: response.total, top: response.hits.map((hit) => hit.id) };
  }

  it('查询集 ≥10 条且逐条执行', () => {
    expect(EXAMPLE_QUERIES.length).toBeGreaterThanOrEqual(10);
    expect(results).toHaveLength(EXAMPLE_QUERIES.length);
  });

  it('每条查询 ≥1 结果，且满足命中数下限与 mustInclude/topWithin 期望', () => {
    for (const { example, response } of results) {
      const ids = response.hits.map((hit) => hit.id);
      expect(response.total, `查询 ${example.id}（${example.q}）应有结果`).toBeGreaterThanOrEqual(
        1,
      );
      expect(response.total, `查询 ${example.id} 命中数`).toBeGreaterThanOrEqual(example.minHits);
      for (const required of example.mustInclude ?? []) {
        expect(ids, `查询 ${example.id} 应命中 ${required}`).toContain(required);
      }
      const top = ids[0];
      if (example.topWithin !== undefined) {
        expect(example.topWithin, `查询 ${example.id} 的 Top-1 应落在期望集合内`).toContain(top);
      }
    }
  });

  it('≥5 条查询给出 ≥3 结果', () => {
    const rich = results.filter(({ response }) => response.total >= 3);
    expect(rich.length).toBeGreaterThanOrEqual(5);
  });

  it('排序快照（每条查询 Top-10 资产 id；变更需评审）', () => {
    expect(snapshot).toMatchSnapshot();
  });
});

describe('排序 = 质量分 × 相关度（§6.1）', () => {
  /** 受控样本：文本与质量分都由测试给定（断言的是排序键性质，不是夹具巧合）。 */
  function synthetic(opts: {
    id: string;
    name: string;
    displayName: string;
    summary: string;
    tags: string[];
    description?: string;
    score: number;
  }): DwsAssetRecord {
    return {
      id: opts.id,
      kind: 'skill',
      name: opts.name,
      displayName: { 'zh-CN': opts.displayName },
      summary: { 'zh-CN': opts.summary },
      ...(opts.description === undefined ? {} : { description: opts.description }),
      source: {
        repo: 'acme/synthetic',
        repoId: 123,
        path: opts.id.split('#')[1] ?? '',
        ref: 'f'.repeat(40),
        fetchedAt: '2026-10-15T00:00:00Z',
        license: {
          spdx: 'MIT',
          gate: 'loadable',
          evidence: { path: 'LICENSE', sha256: `sha256:${'a'.repeat(64)}` },
        },
        stars: 10,
        pushedAt: '2026-10-01T00:00:00Z',
        archived: false,
        homepage: null,
        upstream: null,
        brandDerived: false,
      },
      facets: { category: '其他', lane: 'create', mode: 'utility', tags: opts.tags, scenes: [] },
      quality: {
        score: opts.score,
        dims: {
          spec: opts.score,
          maintenance: opts.score,
          docs: opts.score,
          security: opts.score,
          ecosystem: opts.score,
        },
      },
      security: 'pass',
      reasons: [],
      digest: `sha256:${'b'.repeat(64)}`,
    };
  }

  it('同文本不同质量：质量分高者排前（相关度相同时退化为质量分排序）', () => {
    const cards = buildMarketplaceIndex(
      [
        synthetic({
          id: 'gh:acme/synthetic#a',
          name: 'kit-a',
          displayName: '演示文稿套件 A',
          summary: '幻灯片演示文稿套件',
          tags: ['幻灯片', '模板'],
          score: 0.9,
        }),
        synthetic({
          id: 'gh:acme/synthetic#b',
          name: 'kit-b',
          displayName: '演示文稿套件 B',
          summary: '幻灯片演示文稿套件',
          tags: ['幻灯片', '模板'],
          score: 0.4,
        }),
      ],
      OPTIONS,
    ).assets;
    const response = searchAssets(cards, '幻灯片');
    expect(response.hits.map((hit) => hit.id)).toEqual([
      'gh:acme/synthetic#a',
      'gh:acme/synthetic#b',
    ]);
  });

  it('相关度更高可压过质量分更高的资产（乘法而非单键）', () => {
    const cards = buildMarketplaceIndex(
      [
        synthetic({
          id: 'gh:acme/synthetic#weak',
          name: 'high-quality-kit',
          displayName: '高质量套件',
          summary: '批量重命名图层与批量对齐',
          tags: ['工具'],
          description: '顺手支持图标导出（仅在长文中提及一次）',
          score: 0.9,
        }),
        synthetic({
          id: 'gh:acme/synthetic#strong',
          name: '图标大师',
          displayName: '图标大师',
          summary: '图标生成与图标集管理',
          tags: ['图标', 'icon'],
          score: 0.55,
        }),
      ],
      OPTIONS,
    ).assets;
    const response = searchAssets(cards, '图标');
    expect(response.hits.map((hit) => hit.id)).toEqual([
      'gh:acme/synthetic#strong',
      'gh:acme/synthetic#weak',
    ]);
    const strong = response.hits[0];
    const weak = response.hits[1];
    expect(strong?.quality).toBeLessThan(weak?.quality ?? 0);
    expect(strong?.score).toBeGreaterThan(weak?.score ?? 0);
  });

  it('命中可解释：matchedTerms 非空、score = 质量分 × 归一相关度', () => {
    const response = searchAssets(buildCards().assets, 'ppt 幻灯片');
    const top = response.hits[0];
    expect(top).toBeDefined();
    if (top === undefined) return;
    expect(top.matchedTerms.length).toBeGreaterThan(0);
    expect(top.matchedTerms).toContain('ppt');
    expect(top.bm25).toBeGreaterThan(0);
    expect(top.relevance).toBeGreaterThan(0);
    expect(top.relevance).toBeLessThanOrEqual(1);
    expect(top.score).toBeCloseTo(top.quality * top.relevance, 6);
    // 归一相关度：结果集内最高 bm25 = 1（Top-1 不等于最高 bm25——排序键是乘积）
    const maxRelevance = Math.max(...response.hits.map((hit) => hit.relevance));
    expect(maxRelevance).toBe(1);
  });

  it('排序键复核：命中按 score 降序、score 与质量分/相关度乘积一致（真实夹具）', () => {
    const response = searchAssets(buildCards().assets, '模板 图标 设计系统 ppt', { limit: 50 });
    expect(response.hits.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < response.hits.length; i += 1) {
      const prev = response.hits[i - 1] as MarketSearchHit;
      const curr = response.hits[i] as MarketSearchHit;
      expect(prev.score).toBeGreaterThanOrEqual(curr.score);
      expect(prev.score).toBeCloseTo(prev.quality * prev.relevance, 6);
      expect(curr.score).toBeCloseTo(curr.quality * curr.relevance, 6);
    }
  });
});

describe('过滤与排序（市场页 D1/D3 的检索面）', () => {
  const assets = buildCards().assets;

  it('按 kind 过滤', () => {
    const response = searchAssets(assets, '', { filters: { kinds: ['template'] } });
    expect(response.hits.length).toBeGreaterThanOrEqual(3);
    for (const hit of response.hits) expect(hit.asset.kind).toBe('template');
  });

  it('按场景过滤（D1 场景 chips）', () => {
    const response = searchAssets(assets, '', { filters: { scene: 'ppt-design' } });
    expect(response.hits.length).toBeGreaterThanOrEqual(3);
    for (const hit of response.hits) expect(hit.asset.facets.scenes).toContain('ppt-design');
  });

  it('按标签过滤（全部命中）+ loadableOnly 门禁过滤', () => {
    const response = searchAssets(assets, '', {
      filters: { tags: ['tokens'], loadableOnly: true },
    });
    expect(response.hits.length).toBeGreaterThanOrEqual(1);
    for (const hit of response.hits) {
      expect(hit.asset.facets.tags).toContain('tokens');
      expect(hit.asset.installGate.mode).toBe('loadable');
    }
    // NOASSERTION 的 semi-tokens 被 loadableOnly 排除
    expect(response.hits.map((hit) => hit.id)).not.toContain(
      'gh:semi-design-group/semi-design-tokens#packages/tokens',
    );
  });

  it('sort=updated 按 pushedAt 倒序；sort=name 按展示名', () => {
    const byUpdated = searchAssets(assets, '模板', { sort: 'updated', limit: 10 });
    const times = byUpdated.hits.map((hit) => hit.asset.source.pushedAt);
    expect(times).toEqual([...times].sort().reverse());
    const byName = searchAssets(assets, '', { sort: 'name', limit: 5 });
    const names = byName.hits.map((hit) => hit.asset.displayName['zh-CN'] ?? hit.asset.name);
    expect(names).toEqual([...names].sort());
  });

  it('分页：limit/offset 与 total 语义', () => {
    const all = searchAssets(assets, '模板', { limit: 50 });
    const page1 = searchAssets(assets, '模板', { limit: 2 });
    const page2 = searchAssets(assets, '模板', { limit: 2, offset: 2 });
    expect(page1.total).toBe(all.total);
    expect(page1.hits).toHaveLength(2);
    expect(page1.hits.map((hit) => hit.id)).toEqual(all.hits.slice(0, 2).map((hit) => hit.id));
    expect(page2.hits.map((hit) => hit.id)).toEqual(all.hits.slice(2, 4).map((hit) => hit.id));
  });
});

describe('检索索引产物（market_search_index.v1.json）', () => {
  it('产物可序列化、可复现：JSON 往返后检索结果一致', () => {
    const index = buildSearchIndex(buildCards().assets, { generatedAt: OPTIONS.generatedAt });
    const artifact = JSON.parse(JSON.stringify(index)) as unknown;
    const direct = searchMarketIndex(index, '幻灯片');
    const roundTrip = searchMarketIndex(artifact as typeof index, '幻灯片');
    expect(roundTrip.hits.map((hit) => hit.id)).toEqual(direct.hits.map((hit) => hit.id));
    const record = artifact as Record<string, unknown>;
    expect(record.schema).toBe(SEARCH_INDEX_SCHEMA);
    expect(record.docCount).toBe(16);
    expect(record.termTableVersion).toBeGreaterThanOrEqual(1);
  });

  it('产物记录算法参数与文档长度（可审计 BM25 口径）', () => {
    const index = buildSearchIndex(buildCards().assets, { generatedAt: OPTIONS.generatedAt });
    expect(index.algorithm).toEqual({ name: 'bm25', k1: 1.2, b: 0.75 });
    expect(index.docs).toHaveLength(index.docCount);
    expect(index.avgDocLength).toBeGreaterThan(0);
    for (const doc of index.docs) {
      expect(doc.length).toBeGreaterThan(0);
      expect(doc.quality).toBeGreaterThan(0);
    }
  });
});

describe('边界：空索引 / 单条索引 / 无命中 / 空查询', () => {
  it('空索引：任何查询 0 命中，不抛异常', () => {
    const response = searchAssets([], 'ppt');
    expect(response.total).toBe(0);
    expect(response.hits).toEqual([]);
    expect(response.mode).toBe('search');
  });

  it('单条索引：命中与不命中两种情形', () => {
    const cards = buildCards().assets.filter((asset) => asset.id.includes('skills/pdf'));
    expect(cards).toHaveLength(1);
    expect(searchAssets(cards, 'pdf').total).toBe(1);
    expect(searchAssets(cards, '幻灯片').total).toBe(0);
  });

  it('无命中查询：total=0、hits=[]、terms 保留（可解释）', () => {
    const response = searchAssets(buildCards().assets, 'zzz-不存在的资产');
    expect(response.total).toBe(0);
    expect(response.terms.length).toBeGreaterThan(0);
  });

  it('空查询：browse 模式按质量分倒序（D1「精选 = 质量分 Top-N」）', () => {
    const response = searchAssets(buildCards().assets, '   ', { limit: 5 });
    expect(response.mode).toBe('browse');
    expect(response.total).toBe(16);
    const qualities = response.hits.map((hit) => hit.asset.quality.score);
    expect(qualities).toEqual([...qualities].sort((a, b) => b - a));
    expect(response.hits[0]?.score).toBe(response.hits[0]?.asset.quality.score);
  });
});

describe('P95 基线工具（只记基线，不设硬门槛）', () => {
  it('percentile 最近秩定位（示例来自手册口径）', () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(samples, 0.5)).toBe(5);
    expect(percentile(samples, 0.95)).toBe(10);
    expect(percentile([42], 0.95)).toBe(42);
    expect(percentile([], 0.95)).toBe(0);
  });

  it('查询集全量执行耗时有限且可测（基线记录用，无阈值断言）', () => {
    const assets = buildCards().assets;
    const samples: number[] = [];
    for (let round = 0; round < 5; round += 1) {
      for (const example of EXAMPLE_QUERIES) {
        const start = performance.now();
        searchAssets(assets, example.q, { limit: 10 });
        samples.push(performance.now() - start);
      }
    }
    const p95 = percentile(samples, 0.95);
    expect(samples).toHaveLength(EXAMPLE_QUERIES.length * 5);
    expect(Number.isFinite(p95)).toBe(true);
    expect(p95).toBeGreaterThan(0);
  });
});
