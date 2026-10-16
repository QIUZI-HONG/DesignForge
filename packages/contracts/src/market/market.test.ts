import { describe, expect, it } from 'vitest';

import {
  displayText,
  type InstallGateMode,
  MARKETPLACE_INDEX_SCHEMA,
  type MarketSecurityLevel,
  parseMarketplaceIndex,
} from './index.ts';
import { MARKET_LICENSE_GATES, MARKET_SECURITY_LEVELS } from './vocab.ts';

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

describe('market · 词表派生（登记面补漏：层内不得再写字面量）', () => {
  it('InstallGateMode 与 license 三档真源贴合（Record 键集 = 别名取值集，编译期对账）', () => {
    // Record<别名, true> 的键集必须与别名取值集**完全相等**：多一个成员（别名漂移）
    // 或真源增删成员（此处缺键）都会编译失败——词表变动必须走票面。
    const gateCoverage: Record<InstallGateMode, true> = {
      loadable: true,
      'view-only': true,
      blocked: true,
    };
    expect(Object.keys(gateCoverage).sort()).toEqual([...MARKET_LICENSE_GATES].sort());
  });

  it('installGate.security 指向安全审计真源（不再自写 pass/warn/fail 联合）', () => {
    const securityCoverage: Record<MarketSecurityLevel, true> = {
      pass: true,
      warn: true,
      fail: true,
    };
    expect(Object.keys(securityCoverage).sort()).toEqual([...MARKET_SECURITY_LEVELS].sort());
  });
});
