import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MARKETPLACE_INDEX_SCHEMA } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';
import type { TestDaemon } from '../testing/harness.ts';
import { createTestDaemon, injectJson } from '../testing/harness.ts';

/** 资产夹具（可覆盖关键字段）。 */
function makeAsset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gh:anthropics/skills#skills/pdf',
    kind: 'skill',
    name: 'pdf-export',
    displayName: { 'zh-CN': 'PDF 导出', en: 'PDF Export' },
    summary: { 'zh-CN': '把设计稿一键导出为分页 PDF', en: 'Export to PDF' },
    source: {
      repo: 'anthropics/skills',
      repoId: 1,
      path: 'skills/pdf',
      ref: 'a'.repeat(40),
      fetchedAt: '2026-10-15T22:05:11Z',
      license: {
        spdx: 'MIT',
        gate: 'loadable',
        evidence: { path: 'LICENSE', sha256: 'b'.repeat(64) },
      },
      stars: 100,
      pushedAt: '2026-10-01T09:00:00Z',
      archived: false,
      homepage: null,
      upstream: null,
      brandDerived: false,
    },
    capabilities: ['prompt:inject'],
    facets: { category: '网站设计', lane: 'create', mode: 'components', tags: ['pdf'], scenes: [] },
    quality: {
      score: 0.5,
      dims: { spec: 0.5, maintenance: 0.5, docs: 0.5, security: 0.5, ecosystem: 0.5 },
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

function makeIndex(assets: Record<string, unknown>[]): Record<string, unknown> {
  return {
    schema: MARKETPLACE_INDEX_SCHEMA,
    generatedAt: '2026-10-15T12:00:00Z',
    collector: {
      name: 'df-market',
      version: '0.1.0',
      runId: 'r1',
      odsWatermark: '2026-10-15T12:00:00Z',
    },
    counts: {
      total: assets.length,
      byKind: { skill: assets.length, plugin: 0, 'design-system': 0, template: 0 },
      loadable: assets.length,
    },
    assets,
  };
}

async function seedIndex(daemon: TestDaemon, content: unknown): Promise<void> {
  const dir = join(daemon.dataRoot, 'market');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'df.marketplace.index.v1.json'),
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}

/** 在**同族目录**写入 BM25 倒排产物（与市场索引同目录，即 ADS 落盘口径）。 */
async function seedSearchIndex(daemon: TestDaemon, content: unknown): Promise<void> {
  const dir = join(daemon.dataRoot, 'market');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'market_search_index.v1.json'),
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}

describe('market · 空态（无索引/索引损坏都不报错）', () => {
  it('无索引 → state=empty + warning index-missing（正常空态）', async () => {
    const daemon = await createTestDaemon();
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'GET',
        url: '/market/query',
      });
      expect(statusCode).toBe(200);
      const result = (
        payload as { result: { state: string; items: unknown[]; warnings: { code: string }[] } }
      ).result;
      expect(result.state).toBe('empty');
      expect(result.items).toEqual([]);
      expect(result.warnings[0]?.code).toBe('index-missing');
    } finally {
      await daemon.cleanup();
    }
  });

  it('索引损坏 → state=empty + warning index-invalid（不 500）', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedIndex(daemon, '{ 不是 JSON');
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'GET',
        url: '/market/query',
      });
      expect(statusCode).toBe(200);
      const result = (payload as { result: { state: string; warnings: { code: string }[] } })
        .result;
      expect(result.state).toBe('empty');
      expect(result.warnings[0]?.code).toBe('index-invalid');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('market · 查询与过滤', () => {
  it('返回列表/计数/生成时间；默认按质量分倒序', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedIndex(
        daemon,
        makeIndex([
          makeAsset({
            id: 'gh:a#low',
            quality: {
              score: 0.2,
              dims: { spec: 0, maintenance: 0, docs: 0, security: 0, ecosystem: 0 },
            },
          }),
          makeAsset({
            id: 'gh:a#high',
            quality: {
              score: 0.9,
              dims: { spec: 0, maintenance: 0, docs: 0, security: 0, ecosystem: 0 },
            },
          }),
        ]),
      );
      const { payload } = await injectJson(daemon.app, { method: 'GET', url: '/market/query' });
      const result = (
        payload as {
          result: { state: string; total: number; items: { id: string }[]; generatedAt: string };
        }
      ).result;
      expect(result.state).toBe('ok');
      expect(result.total).toBe(2);
      expect(result.items.map((item) => item.id)).toEqual(['gh:a#high', 'gh:a#low']);
      expect(result.generatedAt).toBe('2026-10-15T12:00:00Z');
    } finally {
      await daemon.cleanup();
    }
  });

  it('过滤：kind / category / q 子串 / loadable（view-only 被排除）', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedIndex(
        daemon,
        makeIndex([
          makeAsset({ id: 'gh:a#skill' }),
          makeAsset({ id: 'gh:a#plugin', kind: 'plugin', name: 'pdf-plugin' }),
          makeAsset({
            id: 'gh:a#viewonly',
            installGate: {
              mode: 'view-only',
              licenseGate: 'view-only',
              security: 'pass',
              reasons: ['NOASSERTION'],
              ackRequired: [],
            },
          }),
        ]),
      );
      const byKind = await injectJson(daemon.app, {
        method: 'GET',
        url: '/market/query?kind=plugin',
      });
      const kindItems = (byKind.payload as { result: { items: { id: string }[] } }).result.items;
      expect(kindItems.map((item) => item.id)).toEqual(['gh:a#plugin']);

      const byQuery = await injectJson(daemon.app, { method: 'GET', url: '/market/query?q=分页' });
      expect((byQuery.payload as { result: { total: number } }).result.total).toBe(3);

      const loadable = await injectJson(daemon.app, {
        method: 'GET',
        url: '/market/query?loadable=1',
      });
      const loadableIds = (
        loadable.payload as { result: { items: { id: string }[] } }
      ).result.items.map((item) => item.id);
      expect(loadableIds).not.toContain('gh:a#viewonly');
      expect(loadableIds).toHaveLength(2);
    } finally {
      await daemon.cleanup();
    }
  });

  it('分页：limit/offset 生效且 total 为过滤后总数', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedIndex(
        daemon,
        makeIndex([
          makeAsset({ id: 'gh:a#1' }),
          makeAsset({ id: 'gh:a#2' }),
          makeAsset({ id: 'gh:a#3' }),
        ]),
      );
      const { payload } = await injectJson(daemon.app, {
        method: 'GET',
        url: '/market/query?limit=2&offset=1',
      });
      const result = (payload as { result: { items: unknown[]; total: number } }).result;
      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(2);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('market · 详情与装载提案（三态）', () => {
  it('详情命中；缺失 → 404 market_asset_not_found', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedIndex(daemon, makeIndex([makeAsset({ id: 'gh:a#skill' })]));
      const found = await injectJson(daemon.app, {
        method: 'GET',
        url: `/market/assets/${encodeURIComponent('gh:a#skill')}`,
      });
      expect(found.statusCode).toBe(200);
      expect(
        (found.payload as { result: { found: boolean; asset: { id: string } } }).result.asset.id,
      ).toBe('gh:a#skill');

      const missing = await injectJson(daemon.app, {
        method: 'GET',
        url: `/market/assets/${encodeURIComponent('gh:no#none')}`,
      });
      expect(missing.statusCode).toBe(404);
      expect((missing.payload as { error: { code: string } }).error.code).toBe(
        'market_asset_not_found',
      );
    } finally {
      await daemon.cleanup();
    }
  });

  it('装载提案三态：loadable（给落点）/ view-only / blocked 均结构化', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedIndex(
        daemon,
        makeIndex([
          makeAsset({ id: 'gh:a#ok' }),
          makeAsset({
            id: 'gh:a#viewonly',
            installGate: {
              mode: 'view-only',
              licenseGate: 'view-only',
              security: 'pass',
              reasons: ['NOASSERTION'],
              ackRequired: [],
            },
          }),
          makeAsset({
            id: 'gh:a#blocked',
            installGate: {
              mode: 'blocked',
              licenseGate: 'blocked',
              security: 'pass',
              reasons: ['品牌复刻'],
              ackRequired: [],
            },
          }),
        ]),
      );

      const loadable = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/load-plan',
        payload: { assetId: 'gh:a#ok' },
      });
      const loadablePlan = (
        loadable.payload as { result: { mode: string; loadable: boolean; targetPathHint: string } }
      ).result;
      expect(loadablePlan.mode).toBe('loadable');
      expect(loadablePlan.loadable).toBe(true);
      expect(loadablePlan.targetPathHint).toBe('.dfg/market/skill/pdf-export/');

      for (const [assetId, expectedMode] of [
        ['gh:a#viewonly', 'view-only'],
        ['gh:a#blocked', 'blocked'],
      ] as const) {
        const { statusCode, payload } = await injectJson(daemon.app, {
          method: 'POST',
          url: '/market/load-plan',
          payload: { assetId },
        });
        expect(statusCode).toBe(200);
        const plan = (
          payload as {
            result: {
              mode: string;
              loadable: boolean;
              targetPathHint: string | null;
              notice: string;
            };
          }
        ).result;
        expect(plan.mode).toBe(expectedMode);
        expect(plan.loadable).toBe(false);
        expect(plan.targetPathHint).toBeNull();
        expect(plan.notice.length).toBeGreaterThan(0);
      }
    } finally {
      await daemon.cleanup();
    }
  });
});

/* ---------------- E1 · BM25 检索（消费 ADS 倒排产物；修复批次 4） ---------------- */

/**
 * 检索夹具（手写倒排，数值即手算 BM25 的输入——不借被测代码生成期望值）。
 *
 * 词项 = 「幻灯片」经切词 + 术语等价类扩展后的查询词项 [幻灯, 灯片, ppt]
 * （与 MK-05 真产物 `df market search --q 幻灯片` 的 `词项 [幻灯,灯片,ppt]` 同口径）。
 *
 * 手算（N=3，各 doc length=100=avgDocLength → norm=1，k1=1.2）：
 * - idf(df=2) = ln(1 + (3-2+0.5)/2.5) = ln(1.6) = 0.470004
 * - idf(df=1) = ln(1 + (3-1+0.5)/1.5) = ln(8/3) = 0.980829
 * - contribution(tf) = idf × (2.2·tf)/(tf+1.2)
 *   doc0 slides:  2 词 × 0.470004 × 6.6/4.2 = 1.477156
 *   doc1 ppt-kit: 2 词 × 0.470004 × 2.2/2.2 = 0.940009
 *   doc2 deck:    1 词 × 0.980829 × 13.2/7.2 = 1.798186（max）
 * - 相关度 = bm25 / max：slides 0.821469 · ppt-kit 0.522754 · deck 1
 * - 排序键 = 质量分 × 相关度：slides 0.98×0.821469 = **0.805** · deck 0.70×1 = **0.70**
 *   · ppt-kit 0.60×0.522754 = **0.3137**
 * → 期望顺序 [slides, deck, ppt-kit]（纯相关度序会是 [deck, slides, ppt-kit]，
 *   故该断言同时证明「相关度 × 质量分」口径，而非裸 BM25 分排序）。
 */
function makeSearchIndex(): Record<string, unknown> {
  return {
    schema: 'df.marketplace.search-index/v1',
    generatedAt: '2026-10-15T18:37:02.159Z',
    algorithm: { name: 'bm25', k1: 1.2, b: 0.75 },
    fieldWeights: { name: 3, displayName: 3, tags: 2, summary: 2 },
    termTableVersion: 1,
    docCount: 3,
    avgDocLength: 100,
    docs: [
      { id: 'gh:acme/skills#skills/slides', length: 100, quality: 0.98 },
      { id: 'gh:acme/skills#skills/ppt-kit', length: 100, quality: 0.6 },
      { id: 'gh:acme/skills#skills/deck', length: 100, quality: 0.7 },
    ],
    postings: {
      幻灯: [
        [0, 3],
        [1, 1],
      ],
      灯片: [
        [0, 3],
        [1, 1],
      ],
      ppt: [[2, 6]],
    },
  };
}

/** 检索夹具的卡片面（4 张：3 张进倒排 + 1 张只走浏览，验证两口径互不污染）。 */
function makeSearchIndexCards(): Record<string, unknown>[] {
  return [
    makeAsset({
      id: 'gh:acme/skills#skills/slides',
      name: 'slides',
      displayName: { 'zh-CN': '幻灯片生成器' },
      summary: { 'zh-CN': '把大纲渲染成幻灯片' },
    }),
    makeAsset({
      id: 'gh:acme/skills#skills/ppt-kit',
      name: 'ppt-kit',
      displayName: { 'zh-CN': '演示套件' },
      summary: { 'zh-CN': '演示文稿组件库' },
    }),
    makeAsset({
      id: 'gh:acme/skills#skills/deck',
      name: 'deck',
      displayName: { 'zh-CN': '路演模板' },
      summary: { 'zh-CN': 'deck 模板集' },
    }),
    makeAsset({
      id: 'gh:acme/skills#skills/pdf',
      name: 'pdf-export',
      displayName: { 'zh-CN': 'PDF 导出' },
      summary: { 'zh-CN': '分页导出' },
    }),
  ];
}

describe('market · E1 检索（BM25 倒排产物）', () => {
  it('中文查询「幻灯片」经倒排命中（含等价类词项），排序 = 相关度 × 质量分', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedIndex(daemon, makeIndex(makeSearchIndexCards()));
      await seedSearchIndex(daemon, makeSearchIndex());
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'GET',
        url: `/market/query?q=${encodeURIComponent('幻灯片')}`,
      });
      expect(statusCode).toBe(200);
      const result = (
        payload as {
          result: {
            state: string;
            total: number;
            items: { id: string }[];
            warnings: { code: string }[];
          };
        }
      ).result;
      expect(result.warnings).toEqual([]);
      expect(result.total).toBe(3);
      expect(result.items.map((item) => item.id)).toEqual([
        'gh:acme/skills#skills/slides',
        'gh:acme/skills#skills/deck',
        'gh:acme/skills#skills/ppt-kit',
      ]);
      // 只走浏览面的第 4 张不进检索结果（检索真值 = 倒排产物）
      expect(result.items.map((item) => item.id)).not.toContain('gh:acme/skills#skills/pdf');
    } finally {
      await daemon.cleanup();
    }
  });

  it('无查询串不受影响：浏览仍给全量卡片（默认质量分序）', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedIndex(daemon, makeIndex(makeSearchIndexCards()));
      await seedSearchIndex(daemon, makeSearchIndex());
      const { payload } = await injectJson(daemon.app, { method: 'GET', url: '/market/query' });
      const result = (payload as { result: { total: number; warnings: { code: string }[] } })
        .result;
      expect(result.total).toBe(4);
      expect(result.warnings).toEqual([]);
    } finally {
      await daemon.cleanup();
    }
  });

  it('筛选面与检索叠加（kind 过滤仍生效）', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedIndex(daemon, makeIndex(makeSearchIndexCards()));
      await seedSearchIndex(daemon, makeSearchIndex());
      const { payload } = await injectJson(daemon.app, {
        method: 'GET',
        url: `/market/query?q=${encodeURIComponent('幻灯片')}&kind=plugin`,
      });
      const result = (payload as { result: { total: number } }).result;
      expect(result.total).toBe(0);
    } finally {
      await daemon.cleanup();
    }
  });

  it('检索索引缺失 → 降级字面过滤 + warning search-index-missing（不报错）', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedIndex(daemon, makeIndex(makeSearchIndexCards()));
      const hit = await injectJson(daemon.app, {
        method: 'GET',
        url: `/market/query?q=${encodeURIComponent('幻灯片')}`,
      });
      const hitResult = (hit.payload as { result: { total: number; warnings: { code: string }[] } })
        .result;
      expect(hitResult.warnings.map((warning) => warning.code)).toContain('search-index-missing');
      // 字面兜底：摘要含「幻灯片」的那张仍命中（不回归）
      expect(hitResult.total).toBe(1);

      const browse = await injectJson(daemon.app, { method: 'GET', url: '/market/query' });
      expect(
        (browse.payload as { result: { warnings: { code: string }[] } }).result.warnings,
      ).toEqual([]);
    } finally {
      await daemon.cleanup();
    }
  });

  it('检索索引损坏 → 降级字面过滤 + warning search-index-invalid（不 500）', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedIndex(daemon, makeIndex(makeSearchIndexCards()));
      await seedSearchIndex(daemon, '{ 不是 JSON');
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'GET',
        url: `/market/query?q=${encodeURIComponent('幻灯片')}`,
      });
      expect(statusCode).toBe(200);
      const result = (payload as { result: { total: number; warnings: { code: string }[] } })
        .result;
      expect(result.warnings.map((warning) => warning.code)).toContain('search-index-invalid');
      expect(result.total).toBe(1);
    } finally {
      await daemon.cleanup();
    }
  });

  it('索引 schema 不匹配同样按损坏降级（不抛错）', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedIndex(daemon, makeIndex(makeSearchIndexCards()));
      await seedSearchIndex(daemon, {
        ...makeSearchIndex(),
        schema: 'df.marketplace.search-index/v2',
      });
      const { payload } = await injectJson(daemon.app, {
        method: 'GET',
        url: `/market/query?q=${encodeURIComponent('幻灯片')}`,
      });
      const result = (payload as { result: { warnings: { code: string }[] } }).result;
      expect(result.warnings.map((warning) => warning.code)).toContain('search-index-invalid');
    } finally {
      await daemon.cleanup();
    }
  });
});
