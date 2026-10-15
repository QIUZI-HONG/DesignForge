import { describe, expect, it } from 'vitest';

import { displayText, MARKETPLACE_INDEX_SCHEMA, parseMarketplaceIndex } from './index.ts';

function makeAsset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gh:anthropics/skills#skills/pdf',
    kind: 'skill',
    name: 'pdf-export',
    displayName: { 'zh-CN': 'PDF 导出', en: 'PDF Export' },
    summary: { 'zh-CN': '把设计稿一键导出为分页 PDF', en: 'Export designs to paginated PDF' },
    source: {
      repo: 'anthropics/skills',
      repoId: 123456789,
      path: 'skills/pdf',
      ref: 'a'.repeat(40),
      fetchedAt: '2026-10-15T22:05:11Z',
      license: {
        spdx: 'MIT',
        gate: 'loadable',
        evidence: { path: 'LICENSE', sha256: 'b'.repeat(64) },
      },
      stars: 1234,
      pushedAt: '2026-10-01T09:00:00Z',
      archived: false,
      homepage: null,
      upstream: null,
      brandDerived: false,
    },
    capabilities: ['prompt:inject', 'fs:read'],
    facets: {
      category: '网站设计',
      lane: 'create',
      mode: 'components',
      tags: ['dashboard'],
      scenes: [],
    },
    quality: {
      score: 0.87,
      dims: { spec: 0.9, maintenance: 0.8, docs: 0.85, security: 0.95, ecosystem: 0.75 },
    },
    installGate: {
      mode: 'loadable',
      licenseGate: 'loadable',
      security: 'pass',
      reasons: [],
      ackRequired: [],
    },
    digest: `sha256:${'c'.repeat(64)}`,
    embeddingRef: null,
    yanked: null,
    ...overrides,
  };
}

function makeIndex(
  assets: unknown[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema: MARKETPLACE_INDEX_SCHEMA,
    generatedAt: '2026-10-15T12:00:00Z',
    collector: {
      name: 'df-market',
      version: '0.1.0',
      runId: '20261015-2201',
      odsWatermark: '2026-10-15T22:00:00Z',
    },
    counts: {
      total: assets.length,
      byKind: { skill: assets.length, plugin: 0, 'design-system': 0, template: 0 },
      loadable: assets.length,
    },
    assets,
    ...overrides,
  };
}

describe('market · df.marketplace.index/v1 解析', () => {
  it('接受合法索引并保真字段', () => {
    const result = parseMarketplaceIndex(makeIndex([makeAsset()]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toBe(0);
    const asset = result.index.assets[0];
    expect(asset?.id).toBe('gh:anthropics/skills#skills/pdf');
    expect(asset?.source.license.gate).toBe('loadable');
    expect(asset?.quality.score).toBe(0.87);
    expect(asset?.facets.category).toBe('网站设计');
  });

  it('schema 不匹配即失败（主版本精确匹配）', () => {
    const result = parseMarketplaceIndex(makeIndex([], { schema: 'df.marketplace.index/v2' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('schema');
  });

  it('未知枚举归 other/其他，未知字段忽略（前向兼容 §1.5）', () => {
    const result = parseMarketplaceIndex(
      makeIndex([
        makeAsset({
          facets: {
            category: '未来新品类',
            lane: 'create',
            mode: 'future-mode',
            tags: [],
            scenes: [],
          },
          futureField: { anything: true },
        }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.index.assets[0]?.facets.category).toBe('其他');
    expect(result.index.assets[0]?.facets.mode).toBe('other');
  });

  it('缺关键字段的资产被跳过并计数，不拖垮整批', () => {
    const result = parseMarketplaceIndex(
      makeIndex([makeAsset(), { kind: 'skill' }, makeAsset({ id: '' })]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.index.assets).toHaveLength(1);
    expect(result.skipped).toBe(2);
  });

  it('displayText 回退链：zh-CN → en → name', () => {
    expect(displayText({ 'zh-CN': '中文', en: 'English' }, 'fallback')).toBe('中文');
    expect(displayText({ en: 'English' }, 'fallback')).toBe('English');
    expect(displayText({}, 'fallback')).toBe('fallback');
  });
});
