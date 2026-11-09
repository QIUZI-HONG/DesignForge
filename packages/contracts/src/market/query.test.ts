/**
 * 市场查询协议测试（arch-v1 · 票② · #4）。
 *
 * 接缝：`@dforge/contracts` 公开面（`market/query.ts` 经 `market/index.ts` 转出）——
 * 查询串编解码、资产比较器、分面匹配。口径来源：
 * - decode 表 = daemon `routes/market.ts` 原 parseQuery（容忍、逐项校验、丢弃非法值）；
 * - compare 表 = daemon `market/service.ts` 原 sortAssets（口径以 daemon 为准）；
 * - tags 语义 = **任一命中（some）**（规格 §6.2 D3；本票定稿）。
 */

import { describe, expect, it } from 'vitest';

import type { MarketAsset } from './index.ts';
import {
  compareMarketAssets,
  decodeMarketQuery,
  displayText,
  encodeMarketQuery,
  type MarketQueryParams,
  matchesMarketFacets,
} from './index.ts';

/** 资产夹具（只填比较/匹配用到的字段，其余给同构默认值）。 */
function makeAsset(overrides: {
  id?: string;
  displayName?: { 'zh-CN'?: string; en?: string };
  name?: string;
  kind?: MarketAsset['kind'];
  category?: string;
  lane?: string;
  mode?: string | null;
  tags?: string[];
  scenes?: string[];
  score?: number;
  stars?: number;
  pushedAt?: string;
  gateMode?: 'loadable' | 'view-only';
}): MarketAsset {
  return {
    id: overrides.id ?? 'gh:acme/skills#skills/a',
    kind: overrides.kind ?? 'skill',
    name: overrides.name ?? 'asset',
    displayName: overrides.displayName ?? { 'zh-CN': '资产' },
    summary: { 'zh-CN': '摘要' },
    source: {
      repo: 'acme/skills',
      repoId: 1,
      path: 'skills/a',
      ref: 'a'.repeat(40),
      fetchedAt: '2026-10-15T22:05:11Z',
      license: {
        spdx: 'MIT',
        gate: overrides.gateMode ?? 'loadable',
        evidence: { path: 'LICENSE', sha256: 'b'.repeat(64) },
      },
      stars: overrides.stars ?? 0,
      pushedAt: overrides.pushedAt ?? '2026-10-01T09:00:00Z',
      archived: false,
      homepage: null,
      upstream: null,
      brandDerived: false,
    },
    capabilities: ['prompt:inject'],
    facets: {
      category: (overrides.category ?? '其他') as MarketAsset['facets']['category'],
      lane: (overrides.lane ?? 'create') as MarketAsset['facets']['lane'],
      mode: (overrides.mode ?? null) as MarketAsset['facets']['mode'],
      tags: overrides.tags ?? [],
      scenes: overrides.scenes ?? [],
    },
    quality: {
      score: overrides.score ?? 0.5,
      dims: { spec: 0.5, maintenance: 0.5, docs: 0.5, security: 0.5, ecosystem: 0.5 },
    },
    installGate: {
      mode: overrides.gateMode ?? 'loadable',
      licenseGate: overrides.gateMode ?? 'loadable',
      security: 'pass',
      reasons: [],
      ackRequired: [],
    },
    digest: `sha256:${'c'.repeat(64)}`,
    embeddingRef: null,
    yanked: null,
  };
}

describe('encodeMarketQuery（与 web 原查询串表逐参数一致）', () => {
  it('全参数：q / kind / category / lane / mode / scene / tags / loadable / sort / limit / offset', () => {
    const search = encodeMarketQuery({
      q: '幻灯片 导出',
      kinds: ['skill', 'plugin'],
      category: 'PPT设计',
      lane: 'create',
      mode: 'template',
      scene: 'ppt-design',
      tags: ['pdf', '导出'],
      loadableOnly: true,
      sort: 'name',
      limit: 60,
      offset: 20,
    });
    const params = new URLSearchParams(search);
    expect(params.get('q')).toBe('幻灯片 导出');
    expect(params.get('kind')).toBe('skill,plugin');
    expect(params.get('category')).toBe('PPT设计');
    expect(params.get('lane')).toBe('create');
    expect(params.get('mode')).toBe('template');
    expect(params.get('scene')).toBe('ppt-design');
    // 票 A · A5（D-19 #3）：tags 逐项转义后，URLSearchParams 一层解码看到的是
    // 「逐项 encodeURIComponent 后 join(',')」形态（旧 wire 为裸 'pdf,导出'）
    expect(params.get('tags')).toBe('pdf,%E5%AF%BC%E5%87%BA');
    expect(params.get('loadable')).toBe('1');
    expect(params.get('sort')).toBe('name');
    expect(params.get('limit')).toBe('60');
    expect(params.get('offset')).toBe('20');
  });

  it('空参数 / 空数组 / offset=0 / 空 q 不落查询串', () => {
    expect(encodeMarketQuery({})).toBe('');
    expect(encodeMarketQuery({ q: '', kinds: [], tags: [], offset: 0 })).toBe('');
    expect(encodeMarketQuery({ loadableOnly: false })).toBe('');
  });

  it('tags 逐项转义：含逗号/百分号/中文的单个 tag 编码后不与分隔符混淆（D-19 #3 · 票 A · A5）', () => {
    const search = encodeMarketQuery({ tags: ['a,b', '100%', '导出'] });
    // URLSearchParams 一层解码后应看到「逐项 encodeURIComponent 后 join(',')」的形态：
    // 单 tag 内的逗号 → %2C（与项分隔符裸逗号区分），百分号 → %25，中文 → UTF-8 百分号
    expect(new URLSearchParams(search).get('tags')).toBe('a%2Cb,100%25,%E5%AF%BC%E5%87%BA');
  });

  it('与 decode 往返：合法参数不丢不增', () => {
    const params: MarketQueryParams = {
      q: '图标',
      kinds: ['template'],
      category: '图标&插画',
      lane: 'refine',
      mode: 'components',
      scene: 'icon-illustration',
      tags: ['svg'],
      loadableOnly: true,
      sort: 'updated',
      limit: 10,
      offset: 2,
    };
    expect(decodeMarketQuery(encodeMarketQuery(params))).toEqual(params);
  });

  it('含逗号/百分号/中文 tag 的 encode→decode 往返恒等（D-19 #3 · 票 A · A5）', () => {
    const tags = ['a,b', '100%', '导出'];
    const roundTripped = decodeMarketQuery(encodeMarketQuery({ tags }));
    expect(roundTripped.tags).toEqual(tags);
  });

  it('decode 逐项转义：非法转义序列丢弃该项、其余保留（容忍哲学）', () => {
    // %zz 非法转义 → 该项丢弃；合法项保留
    expect(decodeMarketQuery('tags=a%zz,b').tags).toEqual(['b']);
    // 悬尾 % 序列 → 该项丢弃；全部非法 → tags 不入参
    expect(decodeMarketQuery('tags=%E0%A4%A,x').tags).toEqual(['x']);
    expect(decodeMarketQuery('tags=%E0%A4%A').tags).toBeUndefined();
  });

  it('decode 兼容旧 wire 格式（裸逗号分隔、简单项）：行为与此前一致', () => {
    expect(decodeMarketQuery('tags=pdf%2C%E5%AF%BC%E5%87%BA').tags).toEqual(['pdf', '导出']);
    expect(decodeMarketQuery('tags=a,,b%20').tags).toEqual(['a', 'b']);
  });
});

describe('decodeMarketQuery（与 daemon 原 parseQuery 表一致：容忍、逐项校验、丢弃非法值）', () => {
  it('合法值全部入参（kind 逗号连接、trim、丢弃未知项）', () => {
    const params = decodeMarketQuery(
      'q=%20%E5%B9%BB%E7%81%AF%E7%89%87%20&kind=skill,bogus,template&category=%E7%BD%91%E7%AB%99%E8%AE%BE%E8%AE%A1&lane=create&mode=components&scene=%E6%B5%B7%E6%8A%A5&tags=a,,b%20&loadable=true&sort=updated&limit=5&offset=2',
    );
    // 注意：q 只校验 trim 后非空，入参保留原串（service 层再 trim——原 daemon 口径）
    expect(params).toEqual({
      q: ' 幻灯片 ',
      kinds: ['skill', 'template'],
      category: '网站设计',
      lane: 'create',
      mode: 'components',
      scene: '海报',
      tags: ['a', 'b'],
      loadableOnly: true,
      sort: 'updated',
      limit: 5,
      offset: 2,
    });
  });

  it('非法值逐项丢弃（不报错、不全灭）', () => {
    expect(
      decodeMarketQuery(
        'q=%20&kind=%20%20&category=bogus&lane=bogus&mode=bogus&scene=&tags=,,&sort=bogus&limit=0&offset=-1',
      ),
    ).toEqual({});
    expect(decodeMarketQuery('limit=abc')).toEqual({});
    expect(decodeMarketQuery('limit=-3')).toEqual({});
  });

  it('容忍前导 ? 与 URLSearchParams 入参', () => {
    expect(decodeMarketQuery('?sort=name')).toEqual({ sort: 'name' });
    expect(decodeMarketQuery(new URLSearchParams('loadable=1'))).toEqual({ loadableOnly: true });
  });

  it('kind 全非法 → kinds 不入参（空数组不落参）', () => {
    expect(decodeMarketQuery('kind=bogus')).toEqual({});
  });

  it('sort 只认三档；limit/offset 按 parseInt 口径（与 daemon 原表一致）', () => {
    expect(decodeMarketQuery('sort=score').sort).toBe('score');
    expect(decodeMarketQuery('sort=hot')).toEqual({});
    expect(decodeMarketQuery('limit=5abc').limit).toBe(5);
  });
});

describe('compareMarketAssets（口径以 daemon sortAssets 为准）', () => {
  const low = makeAsset({ id: 'gh:a/s#low', score: 0.4, stars: 10 });
  const high = makeAsset({ id: 'gh:a/s#high', score: 0.9, stars: 1 });
  const highStars = makeAsset({ id: 'gh:a/s#high-stars', score: 0.9, stars: 99 });

  it('score：质量分降序，并列按 stars 降序', () => {
    const sorted = [low, highStars, high].sort(compareMarketAssets('score'));
    expect(sorted.map((asset) => asset.id)).toEqual([
      'gh:a/s#high-stars',
      'gh:a/s#high',
      'gh:a/s#low',
    ]);
  });

  it('updated：pushedAt 倒序', () => {
    const older = makeAsset({ id: 'gh:a/s#older', pushedAt: '2026-01-01T00:00:00Z' });
    const newer = makeAsset({ id: 'gh:a/s#newer', pushedAt: '2026-09-01T00:00:00Z' });
    expect([older, newer].sort(compareMarketAssets('updated')).map((a) => a.id)).toEqual([
      'gh:a/s#newer',
      'gh:a/s#older',
    ]);
  });

  it('name：展示名中文序（zh-CN localeCompare）；缺 zh 回退 en 再回退机器名', () => {
    const zhB = makeAsset({ id: 'gh:a/s#b', displayName: { 'zh-CN': '乙' }, name: 'b' });
    const zhA = makeAsset({ id: 'gh:a/s#a', displayName: { 'zh-CN': '甲' }, name: 'a' });
    expect([zhB, zhA].sort(compareMarketAssets('name')).map((a) => a.id)).toEqual([
      'gh:a/s#a',
      'gh:a/s#b',
    ]);

    const en = makeAsset({ id: 'gh:a/s#en', displayName: { en: 'Aardvark' }, name: 'zzz' });
    const machine = makeAsset({ id: 'gh:a/s#m', displayName: {}, name: 'Beta' });
    expect([machine, en].sort(compareMarketAssets('name')).map((a) => a.id)).toEqual([
      'gh:a/s#en',
      'gh:a/s#m',
    ]);
  });

  it('displayText 仍是公开面（排序回退口径的单一实现）', () => {
    const asset = makeAsset({ displayName: { en: 'Only English' }, name: 'machine' });
    expect(displayText(asset.displayName, asset.name)).toBe('Only English');
  });
});

describe('matchesMarketFacets（分面语义；tags = 任一命中）', () => {
  const asset = makeAsset({
    kind: 'skill',
    category: 'PPT设计',
    lane: 'create',
    mode: 'template',
    tags: ['ppt', '幻灯片', 'deck'],
    scenes: ['ppt-design'],
    gateMode: 'loadable',
  });

  it('tags 任一命中即通过（some，不是 every）', () => {
    expect(matchesMarketFacets(asset, { tags: ['不存在的标签', 'ppt'] })).toBe(true);
    expect(matchesMarketFacets(asset, { tags: ['deck', '不存在'] })).toBe(true);
    expect(matchesMarketFacets(asset, { tags: ['不存在'] })).toBe(false);
  });

  it('tags 大小写不敏感（与 daemon 原实现一致）', () => {
    expect(matchesMarketFacets(asset, { tags: ['PPT'] })).toBe(true);
  });

  it('kinds 空数组 = 不过滤；非空按成员判定', () => {
    expect(matchesMarketFacets(asset, { kinds: [] })).toBe(true);
    expect(matchesMarketFacets(asset, { kinds: ['skill'] })).toBe(true);
    expect(matchesMarketFacets(asset, { kinds: ['plugin'] })).toBe(false);
  });

  it('category / lane / mode / scene 精确匹配；loadableOnly 只放行 loadable 门', () => {
    expect(matchesMarketFacets(asset, { category: 'PPT设计' })).toBe(true);
    expect(matchesMarketFacets(asset, { category: '网站设计' })).toBe(false);
    expect(matchesMarketFacets(asset, { lane: 'create' })).toBe(true);
    expect(matchesMarketFacets(asset, { lane: 'deliver' })).toBe(false);
    expect(matchesMarketFacets(asset, { mode: 'template' })).toBe(true);
    expect(matchesMarketFacets(asset, { mode: 'tokens' })).toBe(false);
    expect(matchesMarketFacets(asset, { scene: 'ppt-design' })).toBe(true);
    expect(matchesMarketFacets(asset, { scene: 'motion-design' })).toBe(false);
    expect(matchesMarketFacets(asset, { loadableOnly: true })).toBe(true);
    expect(matchesMarketFacets(makeAsset({ gateMode: 'view-only' }), { loadableOnly: true })).toBe(
      false,
    );
  });

  it('空查询（无任何分面）→ 全部通过', () => {
    expect(matchesMarketFacets(asset, {})).toBe(true);
    expect(matchesMarketFacets(asset, { tags: [], kinds: [] })).toBe(true);
  });
});
