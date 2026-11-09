/**
 * @dforge/contracts · 市场查询协议与资产比较（arch-v1 · 票② · #4）。
 *
 * 归属裁决：同一协议此前在 daemon / web 各写一份（查询串 encode 与 decode 两张表、
 * 排序比较器两份、tag 分面语义两处），分叉无人守。本模块是这几件事的**唯一实现**：
 * - `encodeMarketQuery` / `decodeMarketQuery`：查询串编解码（encode 与 web 原表逐参数一致，
 *   decode 与 daemon 原 `routes/market.ts` 表一致——容忍、逐项校验、丢弃非法值；
 *   tags 解码失败例外为**回退保留原项**，见 `decodeMarketQuery` 行内注释）；
 * - `compareMarketAssets`：排序比较器（**口径以 daemon `market/service.ts` 的 sortAssets 为准**：
 *   score = 质量分降序 → stars 降序；updated = pushedAt 倒序；name = 中文展示名 localeCompare）；
 * - `matchesMarketFacets`：分面匹配（tag **任一命中 some** 为规范，见规格 §6.2 D3）。
 *
 * 展示名回退（`displayText`）随比较器一并落在这里：排序键必须与卡片主文案同口径
 * （zh-CN → en → 机器名），否则「界面看到的顺序」与「比较器的顺序」会漂移。
 */

import type { MarketAsset } from './index.ts';
import type { MarketAssetKind, MarketCategory, MarketLane, MarketMode } from './vocab.ts';
import { isMarketAssetKind, isMarketLane, MARKET_CATEGORIES, MARKET_MODES } from './vocab.ts';

/** 排序档（`score` = 综合评分；`updated` = 最近更新；`name` = 展示名）。 */
export type MarketSort = 'score' | 'updated' | 'name';

/** 查询请求（`GET /market/query` 查询串 → 规范化参数）。 */
export interface MarketQueryParams {
  q?: string;
  kinds?: MarketAssetKind[];
  category?: MarketCategory;
  lane?: MarketLane;
  mode?: MarketMode;
  scene?: string;
  tags?: string[];
  loadableOnly?: boolean;
  sort?: MarketSort;
  limit?: number;
  offset?: number;
}

/** 双语字段（缺一言回退另一言，皆缺回退 name）。 */
export interface MarketLocalizedText {
  'zh-CN'?: string;
  en?: string;
}

/** 双语回退（卡片主文案：zh-CN → en → 机器名）。 */
export function displayText(localized: MarketLocalizedText, fallback: string): string {
  const zh = localized['zh-CN'];
  if (typeof zh === 'string' && zh.trim().length > 0) return zh;
  const en = localized.en;
  if (typeof en === 'string' && en.trim().length > 0) return en;
  return fallback;
}

/**
 * 查询参数 → 查询串（不含 `?`；空值不落参）。
 * 逐参数与 web 原 `buildMarketQueryUrl` 的表一致（kind/tags 逗号连接、loadable=1、offset>0 才落）。
 *
 * tags **逐项转义**（D-19 #3 · 票 A · A5）：每项先 `encodeURIComponent` 再 join(',')——
 * 含逗号/百分号的单个 tag 不再与项分隔符混淆（`tags.join(',')` 的旧 wire 里，含逗号的
 * 单个 tag 解码侧会被拆成多个）。签名不变（仍 `MarketQueryParams → string`）；
 * decode 侧同票内对齐。
 */
export function encodeMarketQuery(params: MarketQueryParams): string {
  const search = new URLSearchParams();
  if (params.q !== undefined && params.q.length > 0) search.set('q', params.q);
  if (params.kinds !== undefined && params.kinds.length > 0)
    search.set('kind', params.kinds.join(','));
  if (params.category !== undefined) search.set('category', params.category);
  if (params.lane !== undefined) search.set('lane', params.lane);
  if (params.mode !== undefined) search.set('mode', params.mode);
  if (params.scene !== undefined) search.set('scene', params.scene);
  if (params.tags !== undefined && params.tags.length > 0)
    search.set('tags', params.tags.map((tag) => encodeURIComponent(tag)).join(','));
  if (params.loadableOnly === true) search.set('loadable', '1');
  if (params.sort !== undefined) search.set('sort', params.sort);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.offset !== undefined && params.offset > 0) search.set('offset', String(params.offset));
  return search.toString();
}

/**
 * 查询串 → 查询参数（容忍式：非法值逐项丢弃，不抛错）。
 * 逐参数与 daemon 原 `routes/market.ts` 的 parseQuery 表一致：
 * - `q`：trim 后非空才入参（保留原串，trim 由服务层做）；
 * - `kind`：逗号分隔、trim、只保留四类词表值，全非法则不入参；
 * - `category`/`lane`/`mode`：词表内才入参；
 * - `scene`：非空字符串入参；`tags`：逗号分隔、逐项 `decodeURIComponent`（**失败回退
 *   保留原项**，见下方行内注释）、trim、丢空项（D-19 #3 · 票 A · A5，与 encode 逐项
 *   转义对称）；
 * - `loadable`：`1` 或 `true` → `loadableOnly`；
 * - `sort`：只认三档；`limit`/`offset`：`parseInt` 后按 >0 / >=0 入参（与 daemon 原表一致）。
 */
export function decodeMarketQuery(search: string | URLSearchParams): MarketQueryParams {
  const source = typeof search === 'string' ? new URLSearchParams(search) : search;
  const params: MarketQueryParams = {};

  const q = source.get('q');
  if (q !== null && q.trim().length > 0) params.q = q;

  const kind = source.get('kind');
  if (kind !== null) {
    const kinds = kind
      .split(',')
      .map((value) => value.trim())
      .filter((value): value is MarketAssetKind => isMarketAssetKind(value));
    if (kinds.length > 0) params.kinds = kinds;
  }

  const category = source.get('category');
  if (category !== null && (MARKET_CATEGORIES as readonly string[]).includes(category)) {
    params.category = category as MarketCategory;
  }

  const lane = source.get('lane');
  if (isMarketLane(lane)) {
    params.lane = lane;
  }

  const mode = source.get('mode');
  if (mode !== null && (MARKET_MODES as readonly string[]).includes(mode)) {
    params.mode = mode as MarketMode;
  }

  const scene = source.get('scene');
  if (scene !== null && scene.length > 0) params.scene = scene;

  const tags = source.get('tags');
  if (tags !== null) {
    // 逐项解码（D-19 #3 · 票 A · A5，与 encodeMarketQuery 的逐项转义对称）：
    // 每项先 decodeURIComponent，**解码失败（非法转义序列）回退保留原项**（raw fallback），
    // 再 trim、丢空项——不抛错、不全灭、也不静默丢项。
    // 「旧 wire 兼容」的如实语义就是失败回退原项：旧版 web encode
    // （`URLSearchParams.set('tags', join(','))`）对含字面 `%` 的 tag（如 `100%done`）
    // 落 wire 为 `100%25done`，HTTP 层解码后到 daemon 是 `100%done`，decodeURIComponent
    // 遇 `%do` 必抛 URIError——若按「丢该项」处理，旧 wire 客户端的这类合法 tag 会被
    // 静默丢弃。口径：新↔新往返不变（合法转义正常解码）；旧 wire 含 `%` 的 tag
    // 回退保留字面值。
    const list: string[] = [];
    for (const item of tags.split(',')) {
      let value: string;
      try {
        value = decodeURIComponent(item);
      } catch {
        value = item;
      }
      const trimmed = value.trim();
      if (trimmed.length > 0) list.push(trimmed);
    }
    if (list.length > 0) params.tags = list;
  }

  if (source.get('loadable') === '1' || source.get('loadable') === 'true') {
    params.loadableOnly = true;
  }

  const sort = source.get('sort');
  if (sort === 'score' || sort === 'updated' || sort === 'name') params.sort = sort;

  const limit = source.get('limit');
  if (limit !== null) {
    const parsed = Number.parseInt(limit, 10);
    if (Number.isInteger(parsed) && parsed > 0) params.limit = parsed;
  }

  const offset = source.get('offset');
  if (offset !== null) {
    const parsed = Number.parseInt(offset, 10);
    if (Number.isInteger(parsed) && parsed >= 0) params.offset = parsed;
  }

  return params;
}

/**
 * 排序比较器（`sort` 缺省 = 综合评分）。
 * 口径**以 daemon `market/service.ts` 的 sortAssets 为准**（web 此前逐字同口径，未分叉）：
 * - `score`：质量分降序，并列按 stars 降序（指标简化，规格 §6.1）；
 * - `updated`：`pushedAt` 倒序（ISO 串字典序比较）；
 * - `name`：展示名 `localeCompare(…, 'zh-CN')`（回退口径同 `displayText`）。
 */
export function compareMarketAssets(sort: MarketSort): (a: MarketAsset, b: MarketAsset) => number {
  switch (sort) {
    case 'name':
      return (a, b) =>
        displayText(a.displayName, a.name).localeCompare(
          displayText(b.displayName, b.name),
          'zh-CN',
        );
    case 'updated':
      return (a, b) => b.source.pushedAt.localeCompare(a.source.pushedAt);
    default:
      return (a, b) => b.quality.score - a.quality.score || b.source.stars - a.source.stars;
  }
}

/**
 * 分面匹配（`GET /market/query` 的筛选面；`q` 不在此处——检索由 BM25 产物负责）。
 *
 * 语义：
 * - `kinds` 空数组 = 不过滤（与 daemon 原 matchFacets 一致）；
 * - `category`/`lane`/`mode` 精确匹配；`scene` 按 `scenes` 包含；
 * - **`tags` 任一命中（some）即通过**——多 tag 查询是 OR 语义（规格 §6.2 D3，
 *   本票 #4 定稿）；比较前双方小写化（与 daemon 原实现一致）；
 * - `loadableOnly` 只放行 `installGate.mode === 'loadable'`。
 */
export function matchesMarketFacets(asset: MarketAsset, params: MarketQueryParams): boolean {
  const kinds = params.kinds;
  if (kinds !== undefined && kinds.length > 0 && !kinds.includes(asset.kind)) return false;
  if (params.category !== undefined && asset.facets.category !== params.category) return false;
  if (params.lane !== undefined && asset.facets.lane !== params.lane) return false;
  if (params.mode !== undefined && asset.facets.mode !== params.mode) return false;
  if (params.scene !== undefined && !asset.facets.scenes.includes(params.scene)) return false;
  if (params.tags !== undefined && params.tags.length > 0) {
    const haystack = new Set(asset.facets.tags.map((tag) => tag.toLowerCase()));
    if (!params.tags.some((tag) => haystack.has(tag.toLowerCase()))) return false;
  }
  if (params.loadableOnly === true && asset.installGate.mode !== 'loadable') return false;
  return true;
}
