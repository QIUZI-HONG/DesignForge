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
