// @vitest-environment node
/**
 * 空态判定顺序纯函数测试（接缝：`resolveMarketEmptyKind`，表驱动；巡检缺口①②）。
 *
 * 口径（ux-audit spec P2「市场：判定顺序修正」）：
 * - **已装载视图且本地无装载记录** → `installed-empty`（用户还没装载过任何资源，
 *   这是比「索引缺失」更贴切的真话——缺口②）；
 * - **有查询词** → `no-result` 优先于索引缺失（缺口①：无结果空态曾被 index-missing
 *   压住不可达——判定顺序改为查询词优先）；
 * - 其余沿用旧口径：索引缺失/损坏优先于普通无结果；已装载视图有记录但集合被滤空时
 *   给 `no-result`（说「还没有装载任何资源」会是假话）。
 */

import { describe, expect, it } from 'vitest';

import { resolveMarketEmptyKind } from './empty-kind';
import type { MarketOutcome } from './api';
import type { MarketEmptyKind } from './components/MarketStates';

describe('resolveMarketEmptyKind · 判定顺序（巡检缺口①②）', () => {
  const cases: {
    name: string;
    outcome: MarketOutcome;
    hasQuery: boolean;
    installedView: boolean;
    loadedCount: number;
    expected: MarketEmptyKind;
  }[] = [
    // 缺口①：有查询词 → 无结果空态优先于索引缺失
    {
      name: '空索引 + 有查询词（市场视图）→ no-result，不再被 index-missing 压住',
      outcome: 'index-missing',
      hasQuery: true,
      installedView: false,
      loadedCount: 0,
      expected: 'no-result',
    },
    {
      name: '空索引 + 无查询词（市场视图）→ index-missing（采集指引保留）',
      outcome: 'index-missing',
      hasQuery: false,
      installedView: false,
      loadedCount: 0,
      expected: 'index-missing',
    },
    {
      name: '索引损坏 + 有查询词 → no-result（同一判定顺序）',
      outcome: 'index-invalid',
      hasQuery: true,
      installedView: false,
      loadedCount: 0,
      expected: 'no-result',
    },
    {
      name: '索引损坏 + 无查询词 → index-invalid',
      outcome: 'index-invalid',
      hasQuery: false,
      installedView: false,
      loadedCount: 0,
      expected: 'index-invalid',
    },
    // 缺口②：已装载视图与索引缺失区分空态
    {
      name: '空索引 + 已装载视图 + 本地无记录 → installed-empty（不是 index-missing）',
      outcome: 'index-missing',
      hasQuery: false,
      installedView: true,
      loadedCount: 0,
      expected: 'installed-empty',
    },
    {
      name: '空索引 + 已装载视图 + 有查询词 + 本地无记录 → installed-empty（装载事实优先于查询）',
      outcome: 'index-missing',
      hasQuery: true,
      installedView: true,
      loadedCount: 0,
      expected: 'installed-empty',
    },
    {
      name: '空索引 + 已装载视图 + 本地有记录 → index-missing（有记录却列不出，如实说索引缺失）',
      outcome: 'index-missing',
      hasQuery: false,
      installedView: true,
      loadedCount: 2,
      expected: 'index-missing',
    },
    // 旧口径保留：普通无结果
    {
      name: '有索引 + 无查询词（市场视图）→ no-result',
      outcome: 'no-result',
      hasQuery: false,
      installedView: false,
      loadedCount: 0,
      expected: 'no-result',
    },
    {
      name: '有索引 + 已装载视图 + 本地有记录 + 集合被滤空 → no-result（不说「还没装载」）',
      outcome: 'no-result',
      hasQuery: true,
      installedView: true,
      loadedCount: 3,
      expected: 'no-result',
    },
    {
      name: '部分失败 + 客户端过滤滤空 → no-result（空态，不冒充错误）',
      outcome: 'partial',
      hasQuery: false,
      installedView: false,
      loadedCount: 0,
      expected: 'no-result',
    },
  ];

  for (const entry of cases) {
    it(entry.name, () => {
      expect(
        resolveMarketEmptyKind({
          outcome: entry.outcome,
          hasQuery: entry.hasQuery,
          installedView: entry.installedView,
          loadedCount: entry.loadedCount,
        }),
      ).toBe(entry.expected);
    });
  }
});
