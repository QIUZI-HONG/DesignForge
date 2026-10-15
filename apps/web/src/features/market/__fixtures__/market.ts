/**
 * 市场测试夹具（构造合法索引卡片/查询响应；只被 `*.test.ts(x)` 引用）。
 *
 * 为什么集中一处：卡片字段多（§1.2 二十余个键），逐用例手写会把测试淹在样板里；
 * 夹具给「典型可装载卡片」，用例只覆盖自己要断言的那几项。
 */

import type {
  MarketAsset,
  MarketAssetKind,
  MarketLoadPlan,
  MarketplaceIndex,
  MarketQueryResponse,
  MarketQueryWarning,
} from '@dforge/contracts';
import { MARKETPLACE_INDEX_SCHEMA } from '@dforge/contracts';

/** 造一张卡片（默认：可装载的 skill，五维齐、无告警）。 */
export function makeAsset(overrides: Partial<MarketAsset> = {}): MarketAsset {
  const base: MarketAsset = {
    id: 'gh:acme/skills#skills/pdf-export',
    kind: 'skill',
    name: 'pdf-export',
    displayName: { 'zh-CN': 'PDF 导出', en: 'PDF Export' },
    summary: { 'zh-CN': '把设计稿一键导出为分页 PDF', en: 'Export designs to paginated PDF' },
    description: '导出分页 PDF 的工作流说明。',
    source: {
      repo: 'acme/skills',
      repoId: 42,
      path: 'skills/pdf-export',
      ref: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      fetchedAt: '2026-10-15T22:05:11Z',
      license: { spdx: 'MIT', gate: 'loadable', evidence: { path: 'LICENSE', sha256: '77aa11' } },
      stars: 1200,
      pushedAt: '2026-10-01T09:00:00Z',
      archived: false,
      homepage: null,
      upstream: null,
      brandDerived: false,
    },
    capabilities: ['prompt:inject'],
    facets: {
      category: '网站设计',
      lane: 'create',
      mode: 'template',
      tags: ['pdf', 'export'],
      scenes: ['ppt-design'],
    },
    quality: {
      score: 0.82,
      dims: { spec: 0.9, maintenance: 0.7, docs: 0.8, security: 0.9, ecosystem: 0.75 },
    },
    installGate: {
      mode: 'loadable',
      licenseGate: 'loadable',
      security: 'pass',
      reasons: [],
      ackRequired: [],
    },
    digest: 'sha256:9f2c0000000000000000000000000000000000000000000000000000000000ff',
    version: '1.2.0',
    embeddingRef: null,
    yanked: null,
  };
  return { ...base, ...overrides };
}

/** 造查询响应（缺省：两条结果、无告警）。 */
export function makeQueryResponse(
  overrides: Partial<MarketQueryResponse> = {},
): MarketQueryResponse {
  const items = overrides.items ?? [
    makeAsset(),
    makeAsset({ id: 'gh:acme/skills#plugins/ui-kit', kind: 'plugin' }),
  ];
  return {
    schema: MARKETPLACE_INDEX_SCHEMA,
    state: items.length === 0 ? 'empty' : 'ok',
    generatedAt: '2026-10-15T22:40:00Z',
    total: items.length,
    counts: {
      total: items.length,
      byKind: { skill: items.length, plugin: 0, 'design-system': 0, template: 0 },
      loadable: items.length,
    },
    items,
    warnings: [],
    ...overrides,
  };
}

/** 造索引缺失的查询响应（空态 + 告警）。 */
export function makeMissingIndexResponse(warnings: MarketQueryWarning[]): MarketQueryResponse {
  return makeQueryResponse({ items: [], total: 0, counts: null, generatedAt: null, warnings });
}

/** 造装载提案（缺省：可装载 + 需授权 subprocess）。 */
export function makeLoadPlan(overrides: Partial<MarketLoadPlan> = {}): MarketLoadPlan {
  return {
    assetId: 'gh:acme/skills#skills/pdf-export',
    mode: 'loadable',
    loadable: true,
    ackRequired: ['subprocess'],
    license: { spdx: 'MIT', gate: 'loadable', evidencePath: 'LICENSE', evidenceSha256: '77aa11' },
    targetPathHint: '.dfg/market/skill/pdf-export/',
    reasons: [],
    notice: '可装载：dryRun 预览 → 确认后单事务写入 → 审计留痕',
    ...overrides,
  };
}

/** 造索引（看板用例用）。 */
export function makeIndex(overrides: Partial<MarketplaceIndex> = {}): MarketplaceIndex {
  const assets = overrides.assets ?? [makeAsset()];
  return {
    schema: MARKETPLACE_INDEX_SCHEMA,
    generatedAt: '2026-10-15T22:40:00Z',
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

/** 造卡片数组（按 kind 批量）。 */
export function makeAssetsOfKinds(kinds: readonly MarketAssetKind[]): MarketAsset[] {
  return kinds.map((kind, index) =>
    makeAsset({
      id: `gh:acme/skills#${kind}-${String(index)}`,
      kind,
      name: `${kind}-${String(index)}`,
      displayName: { 'zh-CN': `资源 ${String(index)}` },
    }),
  );
}

/** 内存存储（装载记录册用例；不依赖浏览器 localStorage）。 */
export function makeMemoryStorage(initial: Record<string, string> = {}): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  dump(): Record<string, string>;
} {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    dump: () => Object.fromEntries(map),
  };
}
