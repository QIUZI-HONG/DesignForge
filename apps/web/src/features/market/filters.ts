/**
 * 市场筛选与检索的纯逻辑（D1 筛选栏 / D3 搜索与筛选）。
 *
 * 分层（为什么这样切）：
 * - **daemon 侧**（`MarketQueryParams`）：q / kind / category / lane / mode / scene / tags /
 *   loadable / sort —— 服务端过滤 + 排序是「唯一真源」，浏览器不重算排序；
 * - **本模块**：把 UI 状态映射成查询参数（`toQueryParams`），并承接 daemon 语义未覆盖、
 *   又必须真实生效的三项——**许可档**、**来源仓库**、**是否已装载**（`applyClientFilters`，
 *   后者的真值在本地装载记录里，daemon 不持有）。
 * 三项过滤都作用在 daemon 已返回的当前页上，页面显式声明该口径，不静默假装全量。
 */

import type {
  LicenseGate,
  MarketAsset,
  MarketAssetKind,
  MarketCategory,
  MarketLane,
  MarketQueryParams,
} from '@dforge/contracts';
import { displayText } from '@dforge/contracts';

/** 一级标签（四类资产 + 全部；《技能市场规格 v1》§6.1）。 */
export const MARKET_KIND_TABS: readonly { value: MarketAssetKind | 'all'; labelKey: string }[] = [
  { value: 'all', labelKey: 'market.kind.all' },
  { value: 'skill', labelKey: 'market.kind.skill' },
  { value: 'plugin', labelKey: 'market.kind.plugin' },
  { value: 'design-system', labelKey: 'market.kind.designSystem' },
  { value: 'template', labelKey: 'market.kind.template' },
];

/** 筛选状态（D3 的全部筛选项）。 */
export interface MarketFilters {
  /** 搜索串（名称/描述/标签/来源仓库；命中高亮）。 */
  query: string;
  kind: MarketAssetKind | 'all';
  category: MarketCategory | 'all';
  lane: MarketLane | 'all';
  /** 许可档（客户端过滤：daemon 查询只认「仅可装载」布尔）。 */
  licenseGate: LicenseGate | 'all';
  /** 来源仓库关键字（客户端过滤 `owner/repo`）。 */
  repo: string;
  /** 只看已装载（真值在本地装载记录）。 */
  loadedOnly: boolean;
  /** 场景（D1 场景化入口；`null` = 全部场景）。 */
  scene: string | null;
  sort: 'score' | 'updated' | 'name';
}

/** 初始筛选（对应规格 §6.1：默认「综合评分」排序）。 */
export const INITIAL_MARKET_FILTERS: MarketFilters = {
  query: '',
  kind: 'all',
  category: 'all',
  lane: 'all',
  licenseGate: 'all',
  repo: '',
  loadedOnly: false,
  scene: null,
  sort: 'score',
};

/** 筛选状态 → daemon 查询参数（只带服务端认识的字段）。 */
export function toQueryParams(filters: MarketFilters, limit = 60): MarketQueryParams {
  const params: MarketQueryParams = { sort: filters.sort, limit };
  const query = filters.query.trim();
  if (query.length > 0) params.q = query;
  if (filters.kind !== 'all') params.kinds = [filters.kind];
  if (filters.category !== 'all') params.category = filters.category;
  if (filters.lane !== 'all') params.lane = filters.lane;
  if (filters.scene !== null) params.scene = filters.scene;
  return params;
}

/** 是否有任何激活的筛选（决定空态给「清空筛选」还是「首次采集」）。 */
export function hasActiveFilters(filters: MarketFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.kind !== 'all' ||
    filters.category !== 'all' ||
    filters.lane !== 'all' ||
    filters.licenseGate !== 'all' ||
    filters.repo.trim().length > 0 ||
    filters.loadedOnly ||
    filters.scene !== null
  );
}

/** 激活筛选的计数（徽标用；排序不算筛选）。 */
export function activeFilterCount(filters: MarketFilters): number {
  let count = 0;
  if (filters.query.trim().length > 0) count += 1;
  if (filters.kind !== 'all') count += 1;
  if (filters.category !== 'all') count += 1;
  if (filters.lane !== 'all') count += 1;
  if (filters.licenseGate !== 'all') count += 1;
  if (filters.repo.trim().length > 0) count += 1;
  if (filters.loadedOnly) count += 1;
  if (filters.scene !== null) count += 1;
  return count;
}

/** 客户端过滤输入（已装载集合由本地装载记录提供）。 */
export interface ClientFilterInput {
  licenseGate: LicenseGate | 'all';
  repo: string;
  loadedOnly: boolean;
  loadedIds: readonly string[];
  sort: MarketFilters['sort'];
}

/** 从筛选状态取客户端过滤输入。 */
export function clientFilterOf(
  filters: MarketFilters,
  loadedIds: readonly string[],
): ClientFilterInput {
  return {
    licenseGate: filters.licenseGate,
    repo: filters.repo,
    loadedOnly: filters.loadedOnly,
    loadedIds,
    sort: filters.sort,
  };
}

/**
 * 客户端过滤 + 兜底排序（许可档/来源仓库/已装载）。
 * 排序与 daemon 同口径（score 降序→stars；updated 按 pushedAt；name 按中文展示名），
 * 仅作为「daemon 未排序字段」的兜底，不改变 daemon 已给的相对次序语义。
 */
export function applyClientFilters(
  assets: readonly MarketAsset[],
  input: ClientFilterInput,
): MarketAsset[] {
  const repoNeedle = input.repo.trim().toLowerCase();
  const loaded = new Set(input.loadedIds);
  const filtered = assets.filter((asset) => {
    if (input.licenseGate !== 'all' && asset.source.license.gate !== input.licenseGate)
      return false;
    if (repoNeedle.length > 0 && !asset.source.repo.toLowerCase().includes(repoNeedle))
      return false;
    if (input.loadedOnly && !loaded.has(asset.id)) return false;
    return true;
  });
  return sortAssets(filtered, input.sort);
}

/** 排序（与 daemon `sortAssets` 同口径；纯函数，便于断言）。 */
export function sortAssets(
  assets: readonly MarketAsset[],
  sort: MarketFilters['sort'],
): MarketAsset[] {
  const sorted = [...assets];
  switch (sort) {
    case 'name':
      sorted.sort((a, b) =>
        displayText(a.displayName, a.name).localeCompare(
          displayText(b.displayName, b.name),
          'zh-CN',
        ),
      );
      break;
    case 'updated':
      sorted.sort((a, b) => b.source.pushedAt.localeCompare(a.source.pushedAt));
      break;
    default:
      sorted.sort((a, b) => b.quality.score - a.quality.score || b.source.stars - a.source.stars);
      break;
  }
  return sorted;
}

/**
 * 场景 chips 的来源：**已取回条目的场景并集**（去重、稳定排序）。
 *
 * 为什么不硬编码 9 场景词表：最终中文命名与 id 待术语校准（规格 §9.10）；
 * 且 daemon v1 不返回分面聚合——用当前结果集并集是唯一不伪造数据的做法。
 */
export function collectScenes(assets: readonly MarketAsset[]): string[] {
  const scenes = new Set<string>();
  for (const asset of assets) {
    for (const scene of asset.facets.scenes) {
      if (scene.trim().length > 0) scenes.add(scene);
    }
  }
  return [...scenes].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** 高亮片段（D3「搜索命中高亮」）：按命中把文本切成片段，保序且不丢字符。 */
export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/**
 * 切分文本为命中/非命中片段（大小写不敏感；空查询返回单段非命中）。
 * 不丢字符：`segments.map(s => s.text).join('') === text`（测试断言此不变量）。
 */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const needle = query.trim();
  if (needle.length === 0) return [{ text, hit: false }];
  const haystack = text.toLowerCase();
  const target = needle.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const at = haystack.indexOf(target, cursor);
    if (at < 0) {
      segments.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (at > cursor) segments.push({ text: text.slice(cursor, at), hit: false });
    segments.push({ text: text.slice(at, at + target.length), hit: true });
    cursor = at + target.length;
  }
  return segments;
}

/** 纯文本是否命中查询（卡片是否显示高亮片段）。 */
export function matchesQuery(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return false;
  return text.toLowerCase().includes(needle);
}

/** 是否含中日韩表意文字（判断资产原文是否为中文；用于 §6.3 的翻译声明口径）。 */
export function containsCjk(text: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff]/.test(text);
}

/** 精选（D1「发现 / 精选 / 分类」的精选口径）：质量分 Top-N（规格 §6.2）。 */
export const FEATURED_COUNT = 6;

/** 取精选集合（按综合评分降序取前 N；不足则全给，不补造）。 */
export function selectFeatured(
  assets: readonly MarketAsset[],
  count: number = FEATURED_COUNT,
): MarketAsset[] {
  return sortAssets(assets, 'score').slice(0, count);
}
