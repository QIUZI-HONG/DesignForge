// @vitest-environment jsdom
/**
 * 数据看板视图测试（接缝：`DashboardView`，D6）。
 *
 * 断言三段齐备且「不猜」：采集进度里 runId/水位显式标未上报；四层状态里只有 ADS 有上报；
 * 质量三看板给数值与分布、并显式声明阈值未定；时效性分档与索引年龄可见。
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { marketFixtures } from '@/features/market';
import { DashboardView } from './DashboardView';

// 夹具经 market 公开面取（`marketFixtures` 命名空间），不引 `__fixtures__` 深路径
const { makeAsset, makeQueryResponse } = marketFixtures;

afterEach(() => {
  cleanup();
});

function renderBoard() {
  const response = makeQueryResponse({
    items: [
      makeAsset({
        id: 'fresh',
        source: { ...makeAsset().source, pushedAt: '2026-10-10T00:00:00Z' },
      }),
      makeAsset({
        id: 'stale',
        digest: 'sha256:other',
        source: { ...makeAsset().source, pushedAt: '2024-01-01T00:00:00Z' },
      }),
    ],
    counts: {
      total: 40,
      byKind: { skill: 15, plugin: 9, 'design-system': 8, template: 8 },
      loadable: 31,
    },
  });
  return render(<DashboardView response={response} nowIso="2026-10-15T00:00:00Z" />);
}

/** 按标签取统计卡里的数值（卡片结构：标签 + 数值两段文本）。 */
function statValue(container: HTMLElement, label: string): string {
  const card = [...container.querySelectorAll('[data-df-market="stat"]')].find((element) =>
    element.textContent?.startsWith(label),
  );
  if (card === undefined) return '';
  return (card.textContent ?? '').slice(label.length);
}

describe('DashboardView · 采集进度', () => {
  it('给出生成时刻/规模，runId 与 ODS 水位显式标「未上报」', () => {
    const { container } = renderBoard();
    expect(screen.getByText('采集进度')).toBeTruthy();
    expect(statValue(container, '索引生成时刻')).toBe('2026-10-15T22:40:00Z');
    expect(statValue(container, '卡片总数')).toBe('40');
    expect(statValue(container, '可装载')).toBe('31');
    expect(statValue(container, '受守门限制')).toBe('9');
    expect(statValue(container, '本次加载')).toBe('2');
    expect(statValue(container, '批次 runId')).toBe('未上报');
    expect(statValue(container, 'ODS 水位')).toBe('未上报');
    expect(screen.getByText(/需 daemon 侧补字段或直读 ADS 产物/)).toBeTruthy();
    expect(screen.getByText(/加载 2 张卡片（总数 40）/)).toBeTruthy();
  });
});

describe('DashboardView · 四层状态', () => {
  it('ADS 上报卡片数与生成时刻；ODS/DWD/DWS 未接入上报', () => {
    const { container } = renderBoard();
    const rows = [...container.querySelectorAll('[data-df-market="layer-row"]')];
    expect(rows.map((row) => row.getAttribute('data-df-layer'))).toEqual([
      'ods',
      'dwd',
      'dws',
      'ads',
    ]);
    const ads = rows[3];
    expect(ads?.textContent).toContain('2026-10-15T22:40:00Z');
    expect(ads?.textContent).toContain('索引即 ADS 产物');
    for (const row of rows.slice(0, 3)) {
      expect(row.textContent).toContain('未上报');
    }
  });
});

describe('DashboardView · 质量三看板', () => {
  it('完整性给齐全率与逐字段缺失；阈值未定显式声明（不给通过结论）', () => {
    const { container } = renderBoard();
    expect(screen.getByText('完整性（字段缺失率）')).toBeTruthy();
    expect(screen.getByText(/字段齐全率/)).toBeTruthy();
    expect(
      container.querySelectorAll('[data-df-market="completeness-table"] tbody tr').length,
    ).toBeGreaterThan(5);
    expect(screen.getByText(/判红绿阈值待 MK 定稿/)).toBeTruthy();
  });

  it('一致性给重复与孤儿引用计数', () => {
    renderBoard();
    expect(screen.getByText('一致性（重复率、孤儿引用率）')).toBeTruthy();
    expect(screen.getByText('重复 id 组')).toBeTruthy();
    expect(screen.getByText('重复 digest 组')).toBeTruthy();
    expect(screen.getByText('孤儿引用（ref/digest/许可证据缺失）')).toBeTruthy();
  });

  it('时效性给四档分布与索引年龄（按注入的 now 计算）', () => {
    const { container } = renderBoard();
    expect(screen.getByText('时效性（数据新鲜度分布）')).toBeTruthy();
    const buckets = [...container.querySelectorAll('[data-df-market="freshness-bucket"]')];
    expect(buckets.map((bucket) => bucket.getAttribute('data-df-bucket'))).toEqual([
      'fresh30',
      'fresh90',
      'fresh365',
      'stale',
    ]);
    expect(buckets[0]?.textContent).toContain('1');
    expect(buckets[3]?.textContent).toContain('1');
    expect(container.querySelector('[data-df-market="index-age"]')?.textContent).toContain(
      '索引年龄',
    );
  });
});
