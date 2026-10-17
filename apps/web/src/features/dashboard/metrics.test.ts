/**
 * 看板指标测试（接缝：`@/features/dashboard/metrics`）。
 *
 * 断言 D6 的三看板口径与「不猜」纪律：缺失项显式未上报、字段缺失率逐字段可核对、
 * 重复/孤儿引用如实计数、时效性分档与索引年龄可算且边界正确。
 */

import { describe, expect, it } from 'vitest';

import { marketFixtures } from '@/features/market';
import {
  computeCompleteness,
  computeConsistency,
  computeFreshness,
  readCollectionProgress,
  readLayerStatuses,
} from './metrics';

// 夹具经 market 公开面取（`marketFixtures` 命名空间），不引 `__fixtures__` 深路径
const { makeAsset, makeQueryResponse } = marketFixtures;

describe('dashboard · 采集进度', () => {
  it('从查询响应读生成时刻/总数/可装载/受限；子集分布按加载卡片实测', () => {
    const response = makeQueryResponse({
      items: [makeAsset({ id: 'a', kind: 'skill' }), makeAsset({ id: 'b', kind: 'template' })],
      counts: {
        total: 40,
        byKind: { skill: 15, plugin: 9, 'design-system': 8, template: 8 },
        loadable: 31,
      },
    });
    const progress = readCollectionProgress(response);
    expect(progress).toMatchObject({
      generatedAt: '2026-10-15T22:40:00Z',
      total: 40,
      loadable: 31,
      gated: 9,
      loaded: 2,
    });
    expect(progress.byKind).toEqual([
      { kind: 'skill', count: 1 },
      { kind: 'plugin', count: 0 },
      { kind: 'design-system', count: 0 },
      { kind: 'template', count: 1 },
    ]);
    // runId / 水位不在 /market/query 响应里：显式 null（界面标未上报）
    expect(progress.runId).toBeNull();
    expect(progress.odsWatermark).toBeNull();
  });

  it('空态（counts=null）时数值为 null，不填 0 冒充真值', () => {
    const progress = readCollectionProgress(
      makeQueryResponse({ items: [], total: 0, counts: null }),
    );
    expect(progress.total).toBeNull();
    expect(progress.loadable).toBeNull();
    expect(progress.gated).toBeNull();
  });
});

describe('dashboard · 四层状态', () => {
  it('ADS 有上报（卡片数 + 生成时刻）；ODS/DWD/DWS 标未接入上报', () => {
    const layers = readLayerStatuses(makeQueryResponse());
    expect(layers.map((layer) => layer.id)).toEqual(['ods', 'dwd', 'dws', 'ads']);
    const ads = layers.find((layer) => layer.id === 'ads');
    expect(ads).toMatchObject({
      status: 'reported',
      entries: 2,
      rebuiltAt: '2026-10-15T22:40:00Z',
    });
    for (const id of ['ods', 'dwd', 'dws'] as const) {
      expect(layers.find((layer) => layer.id === id)).toMatchObject({
        status: 'unreported',
        entries: null,
      });
    }
  });
});

describe('dashboard · 完整性（字段缺失率）', () => {
  it('逐字段统计缺失；齐全时缺失率为 0', () => {
    const full = makeAsset({
      metrics: { installs: 0, adoptions: 0, favorites: 0, lastUsedAt: null },
      source: {
        ...makeAsset().source,
        homepage: 'https://example.com',
        upstream: 'upstream/repo',
      },
      quality: { ...makeAsset().quality, explain: { spec: { signals: [], deductions: [] } } },
    });
    const board = computeCompleteness([full]);
    expect(board.total).toBe(1);
    expect(board.rate).toBe(1);
    expect(board.fields.find((field) => field.field === 'version')).toMatchObject({
      present: 1,
      missing: 0,
    });
  });

  it('缺失率按槽位算：两张卡缺 2 个槽位 → 全体缺失计数为 2', () => {
    const bare = makeAsset({ facets: { ...makeAsset().facets, tags: [], scenes: [] } });
    const board = computeCompleteness([bare, bare]);
    const tags = board.fields.find((field) => field.field === 'facets.tags');
    expect(tags).toMatchObject({ present: 0, missing: 2 });
    expect(board.missingTotal).toBeGreaterThanOrEqual(4);
    expect(board.rate).toBeLessThan(1);
  });

  it('空列表 → 完整率 1（无数据不做结论）', () => {
    expect(computeCompleteness([])).toEqual({ total: 0, missingTotal: 0, rate: 1, fields: [] });
  });
});

describe('dashboard · 一致性（重复率、孤儿引用）', () => {
  it('重复 id / 重复 digest 分组计数；孤儿引用按 ref/digest/许可证据缺失计', () => {
    const same = makeAsset({ id: 'same' });
    const duplicateContent = makeAsset({ id: 'other', digest: same.digest });
    const dangling = makeAsset({
      id: 'dangling',
      digest: '',
      source: {
        ...makeAsset().source,
        ref: '',
        license: { spdx: null, gate: 'view-only', evidence: { path: '', sha256: '' } },
      },
    });
    const board = computeConsistency([same, same, duplicateContent, dangling]);
    expect(board.total).toBe(4);
    expect(board.duplicateIdGroups).toEqual([['same', 'same']]);
    expect(board.duplicateDigestGroups.map((group) => group.length)).toEqual([3]);
    expect(board.danglingRefs).toBe(1);
  });

  it('健康数据无重复无孤儿（0 是如实值，不是「未上报」）', () => {
    const board = computeConsistency([
      makeAsset({ id: 'a', digest: 'sha256:a' }),
      makeAsset({ id: 'b', digest: 'sha256:b' }),
    ]);
    expect(board).toMatchObject({
      duplicateIdGroups: [],
      duplicateDigestGroups: [],
      danglingRefs: 0,
    });
  });
});

describe('dashboard · 时效性（新鲜度分布）', () => {
  const now = '2026-10-15T00:00:00Z';

  it('按 pushedAt 距今日数分四档；索引年龄可算', () => {
    const assets = [
      makeAsset({ id: 'd10', source: { ...makeAsset().source, pushedAt: '2026-10-05T00:00:00Z' } }),
      makeAsset({ id: 'd60', source: { ...makeAsset().source, pushedAt: '2026-08-16T00:00:00Z' } }),
      makeAsset({
        id: 'd200',
        source: { ...makeAsset().source, pushedAt: '2026-03-29T00:00:00Z' },
      }),
      makeAsset({
        id: 'd800',
        source: { ...makeAsset().source, pushedAt: '2024-08-07T00:00:00Z' },
      }),
    ];
    const board = computeFreshness(assets, { generatedAt: '2026-10-14T00:00:00Z' }, now);
    expect(board.buckets.map((bucket) => bucket.count)).toEqual([1, 1, 1, 1]);
    expect(board.unknown).toBe(0);
    expect(board.indexAgeDays).toBeCloseTo(1, 5);
  });

  it('边界：恰好 30/90/365 天归入前一档', () => {
    const at = (days: number): string =>
      new Date(Date.parse(now) - days * 24 * 60 * 60 * 1000).toISOString();
    const board = computeFreshness(
      [
        makeAsset({ id: 'd30', source: { ...makeAsset().source, pushedAt: at(30) } }),
        makeAsset({ id: 'd31', source: { ...makeAsset().source, pushedAt: at(31) } }),
      ],
      { generatedAt: null },
      now,
    );
    expect(board.buckets.map((bucket) => bucket.count)).toEqual([1, 1, 0, 0]);
  });

  it('时间戳无法解析 → 计入 unknown（不悄悄丢）；无生成时刻 → 索引年龄 null', () => {
    const broken = makeAsset({ source: { ...makeAsset().source, pushedAt: '不是时间' } });
    const board = computeFreshness([broken], { generatedAt: null }, now);
    expect(board.unknown).toBe(1);
    expect(board.indexAgeDays).toBeNull();
  });
});
