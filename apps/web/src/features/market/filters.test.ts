/**
 * 筛选/检索纯逻辑测试（接缝：`@/features/market/filters`）。
 *
 * 断言：UI 状态 → daemon 参数映射、客户端过滤（许可档/来源/已装载）真生效、
 * 排序与 daemon 同口径、高亮**不丢字符**（这条不变量比「有没有高亮」更重要）。
 */

import { describe, expect, it } from 'vitest';

import { makeAsset } from './__fixtures__/market';
import {
  activeFilterCount,
  applyClientFilters,
  clientFilterOf,
  collectScenes,
  containsCjk,
  hasActiveFilters,
  highlightSegments,
  INITIAL_MARKET_FILTERS,
  MARKET_KIND_TABS,
  matchesQuery,
  selectFeatured,
  sortAssets,
  toQueryParams,
} from './filters';

describe('filters · 状态映射', () => {
  it('初始筛选：全部/综合评分排序/无搜索', () => {
    expect(INITIAL_MARKET_FILTERS).toMatchObject({ kind: 'all', sort: 'score', query: '' });
    expect(hasActiveFilters(INITIAL_MARKET_FILTERS)).toBe(false);
    expect(activeFilterCount(INITIAL_MARKET_FILTERS)).toBe(0);
  });

  it('只把 daemon 认识的字段放进查询参数（许可档/来源/已装载是客户端过滤）', () => {
    const params = toQueryParams({
      ...INITIAL_MARKET_FILTERS,
      query: '  pdf  ',
      kind: 'design-system',
      category: '设计系统',
      lane: 'refine',
      scene: 'ppt-design',
      licenseGate: 'loadable',
      repo: 'acme',
      loadedOnly: true,
      sort: 'updated',
    });
    expect(params).toEqual({
      q: 'pdf',
      kinds: ['design-system'],
      category: '设计系统',
      lane: 'refine',
      scene: 'ppt-design',
      sort: 'updated',
      limit: 60,
    });
  });

  it('激活筛选计数涵盖客户端过滤项', () => {
    expect(
      activeFilterCount({ ...INITIAL_MARKET_FILTERS, licenseGate: 'view-only', loadedOnly: true }),
    ).toBe(2);
  });

  it('一级标签覆盖四类资产 + 全部（清单 D1）', () => {
    expect(MARKET_KIND_TABS.map((tab) => tab.value)).toEqual([
      'all',
      'skill',
      'plugin',
      'design-system',
      'template',
    ]);
  });
});

describe('filters · 客户端过滤与排序', () => {
  const skill = makeAsset({ id: 'gh:a/s#skill', name: 'skill' });
  const viewOnly = makeAsset({
    id: 'gh:a/s#view-only',
    name: 'view-only',
    source: {
      ...makeAsset().source,
      license: { spdx: null, gate: 'view-only', evidence: { path: '', sha256: '' } },
    },
  });
  const otherRepo = makeAsset({
    id: 'gh:b/t#other',
    name: 'other',
    source: { ...makeAsset().source, repo: 'b/t' },
  });

  it('许可档过滤（仅可装载/仅看）', () => {
    const filtered = applyClientFilters([skill, viewOnly, otherRepo], {
      licenseGate: 'view-only',
      repo: '',
      loadedOnly: false,
      loadedIds: [],
      sort: 'score',
    });
    expect(filtered.map((asset) => asset.id)).toEqual(['gh:a/s#view-only']);
  });

  it('来源仓库关键字过滤（大小写不敏感，命中 owner/repo）', () => {
    const filtered = applyClientFilters([skill, otherRepo], {
      licenseGate: 'all',
      repo: 'B/T',
      loadedOnly: false,
      loadedIds: [],
      sort: 'score',
    });
    expect(filtered.map((asset) => asset.id)).toEqual(['gh:b/t#other']);
  });

  it('已装载过滤（真值来自本地装载记录）', () => {
    const filtered = applyClientFilters([skill, otherRepo], {
      licenseGate: 'all',
      repo: '',
      loadedOnly: true,
      loadedIds: ['gh:b/t#other'],
      sort: 'score',
    });
    expect(filtered.map((asset) => asset.id)).toEqual(['gh:b/t#other']);
  });

  it('三条客户端过滤可叠加（空结果即空态，不兜底造数据）', () => {
    expect(
      applyClientFilters([skill, viewOnly, otherRepo], {
        licenseGate: 'loadable',
        repo: 'b/t',
        loadedOnly: true,
        loadedIds: [],
        sort: 'score',
      }),
    ).toEqual([]);
  });

  it('排序：评分降序（并列按星标）、更新时间降序、中文名升序', () => {
    const low = makeAsset({ id: 'gh:a/s#low', quality: { ...makeAsset().quality, score: 0.2 } });
    const high = makeAsset({ id: 'gh:a/s#high', quality: { ...makeAsset().quality, score: 0.95 } });
    expect(sortAssets([low, high], 'score').map((asset) => asset.id)).toEqual([
      'gh:a/s#high',
      'gh:a/s#low',
    ]);

    const older = makeAsset({
      id: 'gh:a/s#old',
      source: { ...makeAsset().source, pushedAt: '2020-01-01T00:00:00Z' },
    });
    const newer = makeAsset({
      id: 'gh:a/s#new',
      source: { ...makeAsset().source, pushedAt: '2026-01-01T00:00:00Z' },
    });
    expect(sortAssets([older, newer], 'updated').map((asset) => asset.id)).toEqual([
      'gh:a/s#new',
      'gh:a/s#old',
    ]);

    const zhB = makeAsset({ id: 'gh:a/s#b', displayName: { 'zh-CN': '乙工具' } });
    const zhA = makeAsset({ id: 'gh:a/s#a', displayName: { 'zh-CN': '甲工具' } });
    expect(sortAssets([zhB, zhA], 'name').map((asset) => asset.id)).toEqual([
      'gh:a/s#a',
      'gh:a/s#b',
    ]);
  });

  it('clientFilterOf 从筛选状态取客户端输入', () => {
    expect(
      clientFilterOf({ ...INITIAL_MARKET_FILTERS, licenseGate: 'loadable', loadedOnly: true }, [
        'x',
      ]),
    ).toEqual({
      licenseGate: 'loadable',
      repo: '',
      loadedOnly: true,
      loadedIds: ['x'],
      sort: 'score',
      preserveOrder: false,
    });
  });

  it('搜索态保留 daemon 的相关度序（相关度 × 质量分不在客户端重排）', () => {
    const lowQuality = makeAsset({
      id: 'gh:a/s#low',
      quality: { ...makeAsset().quality, score: 0.2 },
    });
    const highQuality = makeAsset({
      id: 'gh:a/s#high',
      quality: { ...makeAsset().quality, score: 0.9 },
    });
    // daemon 已在服务端按相关度 × 质量分排序（此处 [low, high] 即服务端序）
    const ordered = [lowQuality, highQuality];
    const searched = clientFilterOf({ ...INITIAL_MARKET_FILTERS, query: '幻灯片' }, []);
    expect(searched.preserveOrder).toBe(true);
    expect(applyClientFilters(ordered, searched).map((asset) => asset.id)).toEqual([
      'gh:a/s#low',
      'gh:a/s#high',
    ]);
    // 非搜索态仍走质量分兜底排序；显式换排序维度时不保留检索序
    expect(
      applyClientFilters(ordered, clientFilterOf(INITIAL_MARKET_FILTERS, [])).map((a) => a.id),
    ).toEqual(['gh:a/s#high', 'gh:a/s#low']);
    expect(
      clientFilterOf({ ...INITIAL_MARKET_FILTERS, query: '幻灯片', sort: 'updated' }, [])
        .preserveOrder,
    ).toBe(false);
  });
});

describe('filters · 场景与高亮（D1 场景 chips / D3 命中高亮）', () => {
  it('场景并集去重且稳定排序（不硬编码 9 场景词表——命名待校准）', () => {
    const assets = [
      makeAsset({
        id: 'gh:a/s#1',
        facets: { ...makeAsset().facets, scenes: ['ppt-design', 'web-app'] },
      }),
      makeAsset({ id: 'gh:a/s#2', facets: { ...makeAsset().facets, scenes: ['ppt-design'] } }),
      makeAsset({ id: 'gh:a/s#3', facets: { ...makeAsset().facets, scenes: [] } }),
    ];
    expect(collectScenes(assets)).toEqual(['ppt-design', 'web-app']);
  });

  it('高亮切分保序不丢字符，命中段大小写不敏感', () => {
    const segments = highlightSegments('PDF 导出与 pdf 预览', 'pdf');
    expect(segments.map((segment) => segment.text).join('')).toBe('PDF 导出与 pdf 预览');
    expect(segments.filter((segment) => segment.hit).map((segment) => segment.text)).toEqual([
      'PDF',
      'pdf',
    ]);
  });

  it('首尾命中与连续命中都正确切分', () => {
    const head = highlightSegments('pdf 工具', 'pdf');
    expect(head[0]).toEqual({ text: 'pdf', hit: true });
    const tail = highlightSegments('工具 pdf', 'pdf');
    expect(tail[tail.length - 1]).toEqual({ text: 'pdf', hit: true });
    const repeated = highlightSegments('aa', 'a');
    expect(repeated).toEqual([
      { text: 'a', hit: true },
      { text: 'a', hit: true },
    ]);
  });

  it('空查询/无命中 → 单段非命中（组件直接渲染原文）', () => {
    expect(highlightSegments('任意文本', '   ')).toEqual([{ text: '任意文本', hit: false }]);
    expect(highlightSegments('任意文本', 'zzz')).toEqual([{ text: '任意文本', hit: false }]);
    expect(highlightSegments('', 'pdf')).toEqual([]);
  });

  it('matchesQuery 与高亮同口径（大小写不敏感、忽略首尾空白）', () => {
    expect(matchesQuery('PDF Export', ' pdf ')).toBe(true);
    expect(matchesQuery('PDF Export', 'docx')).toBe(false);
    expect(matchesQuery('PDF Export', '   ')).toBe(false);
  });
});

describe('filters · 语言判定（§6.3 翻译声明）', () => {
  it('中文/中英混排判为中文；纯英文判为非中文', () => {
    expect(containsCjk('把设计稿导出为 PDF')).toBe(true);
    expect(containsCjk('Export designs to PDF 分页')).toBe(true);
    expect(containsCjk('Export designs to paginated PDF')).toBe(false);
    expect(containsCjk('')).toBe(false);
  });
});

describe('filters · 精选（D1 发现/精选/分类）', () => {
  it('按评分取 Top-N，不足则原样给出（不补造）', () => {
    const assets = [
      makeAsset({ id: 'a', quality: { ...makeAsset().quality, score: 0.1 } }),
      makeAsset({ id: 'b', quality: { ...makeAsset().quality, score: 0.9 } }),
      makeAsset({ id: 'c', quality: { ...makeAsset().quality, score: 0.5 } }),
    ];
    expect(selectFeatured(assets, 2).map((asset) => asset.id)).toEqual(['b', 'c']);
    expect(selectFeatured(assets, 10)).toHaveLength(3);
  });
});
