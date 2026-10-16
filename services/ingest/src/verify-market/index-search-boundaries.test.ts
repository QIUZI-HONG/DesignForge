/**
 * 验证线 · 风险点 5：索引与检索（schema 校验器 / BM25 边界 / 排序稳定性 / 分页 / 合规守门）。
 */

import type { MarketAsset } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';
import { buildMarketplaceIndex } from '../index/build.ts';
import type { DwsAssetRecord } from '../index/dws.ts';
import { validateMarketplaceIndex } from '../index/schema.ts';
import { buildSearchIndex, percentile, queryTerms, searchMarketIndex } from '../index/search.ts';

const HASH = 'a'.repeat(64);

function marketAsset(id: string, name: string, summary: string, quality: number): MarketAsset {
  const repo = id.slice(3).split('#')[0] ?? 'acme/x';
  const path = id.split('#')[1] ?? '';
  return {
    id,
    kind: 'skill',
    name,
    displayName: { 'zh-CN': name, en: name },
    summary: { 'zh-CN': summary, en: summary },
    source: {
      repo,
      repoId: 1,
      path,
      ref: 'a'.repeat(40),
      fetchedAt: '2026-10-15T00:00:00Z',
      license: { spdx: 'MIT', gate: 'loadable', evidence: { path: 'LICENSE', sha256: HASH } },
      stars: 1,
      pushedAt: '2026-10-15T00:00:00Z',
      archived: false,
      homepage: null,
      upstream: null,
      brandDerived: false,
    },
    capabilities: ['prompt:inject'],
    facets: { category: '其他', lane: 'create', mode: null, tags: [], scenes: [] },
    quality: {
      score: quality,
      dims: {
        spec: quality,
        maintenance: quality,
        docs: quality,
        security: quality,
        ecosystem: quality,
      },
    },
    installGate: {
      mode: 'loadable',
      licenseGate: 'loadable',
      security: 'pass',
      reasons: [],
      ackRequired: [],
    },
    digest: `sha256:${HASH}`,
    embeddingRef: null,
    metrics: { installs: 0, adoptions: 0, favorites: 0, lastUsedAt: null },
    yanked: null,
  };
}

function dwsRecord(id: string, gate: 'loadable' | 'view-only' | 'blocked'): DwsAssetRecord {
  const asset = marketAsset(id, (id.split('#')[1] ?? 'x') || 'root', '简介', 0.5);
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    displayName: asset.displayName,
    summary: asset.summary,
    source: {
      repo: asset.source.repo,
      repoId: asset.source.repoId,
      path: asset.source.path,
      ref: asset.source.ref,
      fetchedAt: asset.source.fetchedAt,
      license: { spdx: 'MIT', gate, evidence: { path: 'LICENSE', sha256: HASH } },
      stars: asset.source.stars,
      pushedAt: asset.source.pushedAt,
      archived: asset.source.archived,
      homepage: null,
      upstream: null,
      brandDerived: false,
    },
    facets: { category: '其他', lane: 'create', mode: null, tags: [], scenes: [] },
    quality: {
      score: 0.5,
      dims: { spec: 0.5, maintenance: 0.5, docs: 0.5, security: 0.5, ecosystem: 0.5 },
    },
    security: 'pass',
    reasons: [],
    digest: `sha256:${HASH}`,
  };
}

const GOOD_ASSETS: MarketAsset[] = [
  marketAsset('gh:acme/x#alpha', 'alpha', '配色工具', 0.9),
  marketAsset('gh:acme/x#beta', 'beta', '另一个配色工具', 0.9),
  marketAsset('gh:acme/x#gamma', 'gamma', '🚀 rocket', 0.5),
];
const INDEX = buildSearchIndex(GOOD_ASSETS, { generatedAt: '2026-10-15T00:00:00Z' });

describe('检索边界（BM25 空查询/单字符/CJK/emoji/超长）', () => {
  it('空查询 = browse 模式：按质量分倒序、同分按 id 升序（稳定）', () => {
    const res = searchMarketIndex(INDEX, '');
    expect(res.mode).toBe('browse');
    expect(res.hits.map((h) => h.id)).toEqual([
      'gh:acme/x#alpha',
      'gh:acme/x#beta',
      'gh:acme/x#gamma',
    ]);
    expect(res.hits.map((h) => h.quality)).toEqual([0.9, 0.9, 0.5]);
  });

  it('单字符 token：拉丁单字符精确匹配语义（0 命中不崩）；中文「配色」可命中', () => {
    expect(queryTerms('a')).toEqual(['a']);
    // 拉丁单字符按 token 精确匹配：文档词表里没有独立 "a" token → 0 命中（不报错、不兜底全量）
    expect(searchMarketIndex(INDEX, 'a').total).toBe(0);
    expect(searchMarketIndex(INDEX, '配色').total).toBe(2);

    // 现状记录：emoji 不产生词项 → mode=browse → 命中全量（CLI 的 --q 🚀 会展示全部资产）
    expect(queryTerms('🚀')).toEqual([]);
    const emoji = searchMarketIndex(INDEX, '🚀');
    expect(emoji.mode).toBe('browse');
    expect(emoji.total).toBe(3);
  });

  it('纯标点 = 空查询语义；超长 query（10k 字符）毫秒级且不崩', () => {
    expect(queryTerms('!!!...')).toEqual([]);
    const long = `${'甲'.repeat(5000)} ${'x'.repeat(5000)}`;
    const started = performance.now();
    const res = searchMarketIndex(INDEX, long);
    const elapsed = performance.now() - started;
    expect(Array.isArray(res.hits)).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  it('同分并列：排序确定（反转输入顺序 → 同序）', () => {
    const forward = searchMarketIndex(INDEX, '配色').hits.map((h) => h.id);
    const reversedIndex = buildSearchIndex([...GOOD_ASSETS].reverse(), {
      generatedAt: '2026-10-15T00:00:00Z',
    });
    const backward = searchMarketIndex(reversedIndex, '配色').hits.map((h) => h.id);
    expect(forward).toEqual(backward);
  });

  it('分页边界：offset 越界 → 空页但 total 不变；负 offset 归 0；limit 0 → 空页', () => {
    const all = searchMarketIndex(INDEX, '配色');
    expect(all.total).toBe(2);
    expect(searchMarketIndex(INDEX, '配色', { offset: 99 }).hits).toEqual([]);
    expect(searchMarketIndex(INDEX, '配色', { offset: 99 }).total).toBe(2);
    expect(searchMarketIndex(INDEX, '配色', { offset: -3 }).hits).toHaveLength(2);
    expect(searchMarketIndex(INDEX, '配色', { limit: 0 }).hits).toEqual([]);
    const paged = searchMarketIndex(INDEX, '配色', { offset: 1, limit: 1 });
    expect(paged.hits).toHaveLength(1);
    expect(paged.hits[0]?.id).toBe(all.hits[1]?.id);
  });

  it('空索引（0 文档）：browse 与 search 均安全返回（无除零）', () => {
    const empty = buildSearchIndex([], {});
    expect(empty.avgDocLength).toBe(0);
    expect(searchMarketIndex(empty, '').total).toBe(0);
    expect(searchMarketIndex(empty, 'x').total).toBe(0);
  });

  it('percentile：空数组 0；p>1 / p≤0 均夹取到有效秩', () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([5], 1.5)).toBe(5);
    expect(percentile([5], 0)).toBe(5);
  });
});

describe('schema 校验器：畸形卡片', () => {
  const wrap = (assets: MarketAsset[]) =>
    ({
      schema: 'df.marketplace.index/v1',
      generatedAt: '2026-10-15T00:00:00Z',
      collector: { name: 'x', version: '1', runId: 'r', odsWatermark: '2026-10-15T00:00:00Z' },
      counts: {
        total: assets.length,
        byKind: { skill: assets.length, plugin: 0, 'design-system': 0, template: 0 },
        loadable: assets.filter((a) => a.installGate.mode === 'loadable').length,
      },
      assets,
    }) as unknown;

  it('基线卡片通过校验（对照组）', () => {
    const result = validateMarketplaceIndex(wrap([...GOOD_ASSETS.slice(0, 1)]));
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });

  it('NaN / 类型错 / 缺字段 / 重复 id / counts 不自洽 → 逐条拦住', () => {
    const nanScore = structuredClone(GOOD_ASSETS[0]) as MarketAsset;
    nanScore.quality.score = Number.NaN;
    expect(validateMarketplaceIndex(wrap([nanScore])).errors.map((e) => e.path)).toContain(
      'assets[0].quality.score',
    );

    const nanDim = structuredClone(GOOD_ASSETS[0]) as MarketAsset & {
      quality: { dims: Record<string, unknown> };
    };
    nanDim.quality.dims.ecosystem = Number.NaN;
    expect(
      validateMarketplaceIndex(wrap([nanDim as MarketAsset])).errors.map((e) => e.path),
    ).toContain('assets[0].quality.dims.ecosystem');

    const badStars = structuredClone(GOOD_ASSETS[0]) as unknown as { source: { stars: unknown } };
    badStars.source.stars = '很多';
    expect(
      validateMarketplaceIndex(wrap([badStars as unknown as MarketAsset])).errors.map(
        (e) => e.path,
      ),
    ).toContain('assets[0].source.stars');

    const missingYanked = structuredClone(GOOD_ASSETS[0]) as Partial<MarketAsset>;
    delete missingYanked.yanked;
    expect(
      validateMarketplaceIndex(wrap([missingYanked as MarketAsset])).errors.map((e) => e.path),
    ).toContain('assets[0].yanked');

    const FIRST = GOOD_ASSETS[0] as MarketAsset;
    const dup = [FIRST, structuredClone(FIRST)];
    expect(validateMarketplaceIndex(wrap(dup)).errors.map((e) => e.code)).toContain('duplicate-id');

    const badCounts = wrap([FIRST]) as { counts: { total: number } };
    badCounts.counts.total = 99;
    expect(validateMarketplaceIndex(badCounts).errors.map((e) => e.code)).toContain(
      'counts-mismatch',
    );

    // embeddingRef 非 null（v1 圈外）→ 拦
    const embedding = structuredClone(GOOD_ASSETS[0]) as MarketAsset & { embeddingRef: unknown };
    embedding.embeddingRef = 'vec:1';
    expect(
      validateMarketplaceIndex(wrap([embedding as MarketAsset])).errors.map((e) => e.path),
    ).toContain('assets[0].embeddingRef');
  });

  it('超长值：中文简介 >80 字 → warning（不拦）；tags >10 → warning', () => {
    const long = structuredClone(GOOD_ASSETS[0]) as MarketAsset;
    long.summary = { 'zh-CN': '甲'.repeat(300), en: 'long' };
    long.facets = { ...long.facets, tags: Array.from({ length: 15 }, (_, i) => `t${i}`) };
    const result = validateMarketplaceIndex(wrap([long]));
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain('summary-too-long');
    expect(codes).toContain('tags-overflow');
  });

  it('blocked 资产出现在索引 → 硬错误（§1.1 不得出现）', () => {
    const blocked = structuredClone(GOOD_ASSETS[0]) as MarketAsset;
    blocked.installGate = { ...blocked.installGate, mode: 'blocked', licenseGate: 'blocked' };
    blocked.source = {
      ...blocked.source,
      license: { ...blocked.source.license, gate: 'blocked' },
    };
    const result = validateMarketplaceIndex(wrap([blocked]));
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('blocked-present');
  });
});

describe('合规守门：不可装载资产不得进可装载集', () => {
  it('blocked 被过滤出索引；view-only 保留但不计入 loadable', () => {
    const records = [
      dwsRecord('gh:acme/x#load', 'loadable'),
      dwsRecord('gh:acme/x#view', 'view-only'),
      dwsRecord('gh:acme/x#block', 'blocked'),
    ];
    const index = buildMarketplaceIndex(records, {
      generatedAt: '2026-10-15T00:00:00Z',
      collector: {
        name: 'df-market',
        version: '0.1.0',
        runId: 'r',
        odsWatermark: '2026-10-15T00:00:00Z',
      },
    });
    expect(index.assets.map((a) => a.id)).toEqual(['gh:acme/x#load', 'gh:acme/x#view']);
    expect(index.counts).toMatchObject({ total: 2, loadable: 1 });
    expect(index.assets.find((a) => a.id === 'gh:acme/x#view')?.installGate.mode).toBe('view-only');
    expect(validateMarketplaceIndex(index).ok).toBe(true);
  });

  it('NOASSERTION / 无 license / AGPL 三档边界（assessLicense 对抗）', async () => {
    const { assessLicense } = await import('../collect/license.ts');
    const base = { archived: false, brandDerived: false, hasLicenseFile: true };
    expect(assessLicense({ ...base, spdx: 'NOASSERTION' }).gate).toBe('view-only');
    expect(assessLicense({ ...base, spdx: 'NOASSERTION' }).tier).toBe('noassertion');
    expect(assessLicense({ ...base, spdx: null }).gate).toBe('view-only');
    expect(assessLicense({ ...base, spdx: 'AGPL-3.0' }).gate).toBe('view-only');
    expect(assessLicense({ ...base, spdx: 'GPL-3.0-only' }).tier).toBe('strong-copyleft');
    expect(assessLicense({ ...base, spdx: 'LGPL-2.1' }).tier).toBe('weak-copyleft');
    // 宽松 SPDX 但无许可原文 → 不乐观默认装载
    expect(assessLicense({ ...base, spdx: 'MIT', hasLicenseFile: false }).gate).toBe('view-only');
    expect(assessLicense({ ...base, spdx: 'MIT' }).gate).toBe('loadable');
    // yank / 品牌复刻 → blocked
    expect(assessLicense({ ...base, spdx: 'MIT', yanked: true }).gate).toBe('blocked');
    expect(assessLicense({ ...base, spdx: 'MIT', brandDerived: true }).gate).toBe('blocked');
  });

  it('品牌复刻判定只做整名/前缀（not-apple / pineapple 不误判）', async () => {
    const { detectBrandDerived } = await import('../collect/license.ts');
    expect(detectBrandDerived({ name: 'apple', manifestSourceType: null })).toBe(true);
    expect(detectBrandDerived({ name: 'apple-design-kit', manifestSourceType: null })).toBe(true);
    expect(detectBrandDerived({ name: 'not-apple', manifestSourceType: null })).toBe(false);
    expect(detectBrandDerived({ name: 'pineapple', manifestSourceType: null })).toBe(false);
    expect(detectBrandDerived({ name: 'x', manifestSourceType: 'bundled' })).toBe(true);
  });
});
