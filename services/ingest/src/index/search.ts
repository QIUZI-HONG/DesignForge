/**
 * 检索首版（MK-04）——BM25 简化版 + 中英术语等价类 + 排序 = 质量分 × 相关度。
 *
 * 规格依据：
 * - 《技能市场规格 v1》§6.2 D3（名称/描述/标签/正文；首版 BM25 + 术语等价类，向量检索圈外）
 *   与 §6.1（默认排序「综合评分 = quality.score × 相关度」，采纳/最近更新为辅）；
 * - 《市场首实现》§4 判据链第 5 环（示例查询集 ≥10 条、≥5 条查询 ≥3 结果、P95 只记基线）。
 *
 * 结构：
 * - `buildSearchIndex(assets)` → **可序列化倒排产物**（`market_search_index.v1.json`，§4.1）：
 *   term → [docIndex, 加权 tf]，含 doc 长度/质量分与 BM25 参数（口径可审计、可复现）；
 * - `searchMarketIndex(index, q)` → 只按产物排序（不依赖卡片，证据脚本走这条路径）；
 * - `searchAssets(assets, q, opts)` → 面向页面/CLI 的便捷面（过滤 + 排序 + 分页 + 卡片回填）。
 *
 * 口径细节：
 * - 字段权重（`SEARCH_FIELD_WEIGHTS`）让名称/标签的分量高于长文描述；
 * - 相关度取**结果集内最大值归一**（Top-1 = 1），与质量分同尺度相乘；
 * - 空查询 = browse 模式：按质量分倒序（D1「精选 = 质量分 Top-N」）；
 * - 首版无向量检索：`embeddingRef` 恒 null（本模块不参与）。
 */

import type { MarketAsset, MarketplaceIndex } from '@dforge/contracts';

import { indexText, TERM_TABLE_VERSION } from './terms.ts';

/** 检索索引契约标识（§4.1 `market_search_index.v1.json`）。 */
export const SEARCH_INDEX_SCHEMA = 'df.marketplace.search-index/v1' as const;

/** BM25 参数（简化版；口径写进产物，便于复核）。 */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

/** 字段权重（名称 ≈ 标签 > 摘要 > 分类面 > 仓库/描述；域内口径，改动进快照评审）。 */
export const SEARCH_FIELD_WEIGHTS = {
  name: 3,
  displayName: 3,
  tags: 2,
  summary: 2,
  facets: 1.5,
  repo: 1.5,
  capabilities: 1,
  description: 1,
} as const;

/** 单文档（倒排的 doc 表；只带检索与排序所需的最小元数据）。 */
export interface SearchIndexDoc {
  id: string;
  /** 加权文档长度（Σ 字段权重 × 词数）。 */
  length: number;
  /** 质量分（排序乘子；来自 DWS §5）。 */
  quality: number;
}

/** 倒排产物（JSON 可序列化）。 */
export interface SearchIndex {
  schema: typeof SEARCH_INDEX_SCHEMA;
  generatedAt: string;
  algorithm: { name: 'bm25'; k1: number; b: number };
  /** 字段权重（口径快照；改权重 = 换检索口径，需重建索引）。 */
  fieldWeights: Record<string, number>;
  termTableVersion: number;
  docCount: number;
  avgDocLength: number;
  docs: SearchIndexDoc[];
  /** 词项倒排：term → [docIndex, 加权 tf][]。 */
  postings: Record<string, [number, number][]>;
}

/** 排序命中（不带卡片；解释字段齐备）。 */
export interface RankedHit {
  id: string;
  /** 原始 BM25 分（未归一）。 */
  bm25: number;
  /** 归一相关度 (0,1]（结果集内最大值 = 1）。 */
  relevance: number;
  quality: number;
  /** 排序键 = 质量分 × 相关度（browse 模式 = 质量分）。 */
  score: number;
  /** 命中的（扩展后）词项，按贡献降序——「为什么是这个结果」。 */
  matchedTerms: string[];
}

/** 带卡片的命中（市场页直接用）。 */
export interface MarketSearchHit extends RankedHit {
  asset: MarketAsset;
}

/** 检索响应（`mode` 区分词面检索与浏览排序）。 */
export interface SearchResponse<H> {
  query: string;
  /** 扩展后的查询词项（含等价类 canonical，可解释）。 */
  terms: string[];
  mode: 'search' | 'browse';
  /** 过滤后的命中总数（分页依据）。 */
  total: number;
  hits: H[];
}

/** 检索过滤面（与 contracts `MarketQueryParams` 同族，页面直接落参）。 */
export interface SearchFilters {
  kinds?: readonly string[];
  category?: string;
  lane?: string;
  mode?: string;
  scene?: string;
  /** 全部命中才算通过（标签筛选的直觉语义）。 */
  tags?: readonly string[];
  loadableOnly?: boolean;
}

/** `searchAssets` 选项。 */
export interface SearchAssetsOptions {
  filters?: SearchFilters;
  /** 排序：`score`（默认，质量分 × 相关度）/ `updated`（pushedAt 倒序）/ `name`（展示名升序）。 */
  sort?: 'score' | 'updated' | 'name';
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT = 20;
const MAX_MATCHED_TERMS = 8;

/** 双语拼接（索引用；回退规则与展示一致）。 */
function localizedText(localized: { 'zh-CN'?: string; en?: string }): string {
  return [localized['zh-CN'], localized.en].filter((text) => typeof text === 'string').join(' ');
}

/** 文档各字段文本（权重表驱动；新增字段只需加一行）。 */
function docFields(asset: MarketAsset): [string, number][] {
  return [
    [asset.name, SEARCH_FIELD_WEIGHTS.name],
    [localizedText(asset.displayName), SEARCH_FIELD_WEIGHTS.displayName],
    [asset.facets.tags.join(' '), SEARCH_FIELD_WEIGHTS.tags],
    [localizedText(asset.summary), SEARCH_FIELD_WEIGHTS.summary],
    [
      [asset.facets.category, asset.facets.lane, asset.facets.mode ?? '', ...asset.facets.scenes]
        .filter((part) => part.length > 0)
        .join(' '),
      SEARCH_FIELD_WEIGHTS.facets,
    ],
    [asset.source.repo, SEARCH_FIELD_WEIGHTS.repo],
    [asset.capabilities.join(' '), SEARCH_FIELD_WEIGHTS.capabilities],
    [asset.description ?? '', SEARCH_FIELD_WEIGHTS.description],
  ];
}

/**
 * 构建倒排产物（`market_search_index.v1.json`，§4.1）。
 * 幂等：同输入同产物（§4.3；`generatedAt` 由调用方注入）。
 */
export function buildSearchIndex(
  assets: readonly MarketAsset[],
  options: { generatedAt?: string } = {},
): SearchIndex {
  const docs: SearchIndexDoc[] = [];
  const postings = new Map<string, [number, number][]>();

  assets.forEach((asset, docIndex) => {
    const weightedTf = new Map<string, number>();
    let length = 0;
    for (const [text, weight] of docFields(asset)) {
      if (text.length === 0) continue;
      for (const term of indexText(text)) {
        weightedTf.set(term, (weightedTf.get(term) ?? 0) + weight);
        length += weight;
      }
    }
    docs.push({ id: asset.id, length, quality: asset.quality.score });
    for (const [term, tf] of weightedTf) {
      const list = postings.get(term);
      if (list === undefined) postings.set(term, [[docIndex, tf]]);
      else list.push([docIndex, tf]);
    }
  });

  const totalLength = docs.reduce((sum, doc) => sum + doc.length, 0);
  const postingsRecord: Record<string, [number, number][]> = {};
  // 词项按字典序落盘（确定性产物；便于 diff 与快照）
  for (const term of [...postings.keys()].sort()) {
    postingsRecord[term] = postings.get(term) as [number, number][];
  }

  return {
    schema: SEARCH_INDEX_SCHEMA,
    generatedAt: options.generatedAt ?? '',
    algorithm: { name: 'bm25', k1: BM25_K1, b: BM25_B },
    fieldWeights: { ...SEARCH_FIELD_WEIGHTS },
    termTableVersion: TERM_TABLE_VERSION,
    docCount: docs.length,
    avgDocLength: docs.length === 0 ? 0 : totalLength / docs.length,
    docs,
    postings: postingsRecord,
  };
}

/** 查询词项（去重保序；空串/纯标点 → 空数组）。 */
export function queryTerms(query: string): string[] {
  const terms: string[] = [];
  for (const term of indexText(query)) {
    if (!terms.includes(term)) terms.push(term);
  }
  return terms;
}

interface Accumulator {
  bm25: number;
  contributions: Map<string, number>;
}

/** 核心排序：BM25 → 归一相关度 → 质量分相乘。 */
function rankByRelevance(
  index: SearchIndex,
  terms: readonly string[],
  restrictIds?: ReadonlySet<string>,
): RankedHit[] {
  if (index.docCount === 0 || terms.length === 0) return [];
  const denominatorBase = index.avgDocLength > 0 ? index.avgDocLength : 1;
  const accumulators = new Map<number, Accumulator>();

  for (const term of terms) {
    const posting = index.postings[term];
    if (posting === undefined || posting.length === 0) continue;
    const df = posting.length;
    const idf = Math.log(1 + (index.docCount - df + 0.5) / (df + 0.5));
    for (const [docIndex, tf] of posting) {
      const doc = index.docs[docIndex];
      if (doc === undefined) continue;
      if (restrictIds !== undefined && !restrictIds.has(doc.id)) continue;
      const norm = 1 - BM25_B + (BM25_B * doc.length) / denominatorBase;
      const contribution = idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * norm));
      let accumulator = accumulators.get(docIndex);
      if (accumulator === undefined) {
        accumulator = { bm25: 0, contributions: new Map() };
        accumulators.set(docIndex, accumulator);
      }
      accumulator.bm25 += contribution;
      accumulator.contributions.set(term, contribution);
    }
  }

  let maxBm25 = 0;
  for (const accumulator of accumulators.values()) {
    if (accumulator.bm25 > maxBm25) maxBm25 = accumulator.bm25;
  }
  if (maxBm25 <= 0) return [];

  const hits: RankedHit[] = [];
  for (const [docIndex, accumulator] of accumulators) {
    const doc = index.docs[docIndex] as SearchIndexDoc;
    const relevance = accumulator.bm25 / maxBm25;
    hits.push({
      id: doc.id,
      bm25: accumulator.bm25,
      relevance,
      quality: doc.quality,
      score: doc.quality * relevance,
      matchedTerms: [...accumulator.contributions.entries()]
        .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
        .slice(0, MAX_MATCHED_TERMS)
        .map(([term]) => term),
    });
  }
  hits.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return hits;
}

/** 质量分倒序（browse 模式：`mode = 'browse'`）。 */
function rankByQuality(index: SearchIndex, restrictIds?: ReadonlySet<string>): RankedHit[] {
  return index.docs
    .filter((doc) => restrictIds === undefined || restrictIds.has(doc.id))
    .map((doc) => ({
      id: doc.id,
      bm25: 0,
      relevance: 0,
      quality: doc.quality,
      score: doc.quality,
      matchedTerms: [],
    }))
    .sort((a, b) =>
      b.quality !== a.quality ? b.quality - a.quality : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
}

/** 只按倒排产物检索（证据脚本/daemon 用；不含过滤与卡片回填）。 */
export function searchMarketIndex(
  index: SearchIndex,
  query: string,
  options: { limit?: number; offset?: number } = {},
): SearchResponse<RankedHit> {
  const terms = queryTerms(query);
  const mode: 'search' | 'browse' = terms.length === 0 ? 'browse' : 'search';
  const ranked = mode === 'browse' ? rankByQuality(index) : rankByRelevance(index, terms);
  const offset = Math.max(options.offset ?? 0, 0);
  const limit = options.limit ?? DEFAULT_LIMIT;
  return {
    query,
    terms,
    mode,
    total: ranked.length,
    hits: ranked.slice(offset, offset + limit),
  };
}

/** 卡片侧过滤（判据链外的一般筛选面，规格 §6.2 D3）。 */
function matchesFilters(asset: MarketAsset, filters: SearchFilters | undefined): boolean {
  if (filters === undefined) return true;
  if (filters.kinds !== undefined && !filters.kinds.includes(asset.kind)) return false;
  if (filters.category !== undefined && asset.facets.category !== filters.category) return false;
  if (filters.lane !== undefined && asset.facets.lane !== filters.lane) return false;
  if (filters.mode !== undefined && asset.facets.mode !== filters.mode) return false;
  if (filters.scene !== undefined && !asset.facets.scenes.includes(filters.scene)) return false;
  if (filters.tags !== undefined) {
    for (const tag of filters.tags) {
      if (!asset.facets.tags.includes(tag)) return false;
    }
  }
  if (filters.loadableOnly === true && asset.installGate.mode !== 'loadable') return false;
  return true;
}

/**
 * 面向页面/CLI 的检索便捷面：过滤（卡片）→ 排序（默认质量分 × 相关度）→ 分页 → 卡片回填。
 *
 * 说明：内部即时构建倒排（首版批量 ≤ 数百条，成本可忽略）；批量大批次下由调用方复用
 * `buildSearchIndex` 与 `searchMarketIndex`（daemon/MK-05 路径）。
 */
export function searchAssets(
  assets: readonly MarketAsset[],
  query: string,
  options: SearchAssetsOptions = {},
): SearchResponse<MarketSearchHit> {
  const index = buildSearchIndex(assets);
  const candidates = assets.filter((asset) => matchesFilters(asset, options.filters));
  const restrictIds = new Set(candidates.map((asset) => asset.id));
  const terms = queryTerms(query);
  const mode: 'search' | 'browse' = terms.length === 0 ? 'browse' : 'search';
  let ranked =
    mode === 'browse'
      ? rankByQuality(index, restrictIds)
      : rankByRelevance(index, terms, restrictIds);

  const sort = options.sort ?? 'score';
  if (sort !== 'score' && ranked.length > 1) {
    const byId = new Map(candidates.map((asset) => [asset.id, asset]));
    ranked = [...ranked].sort((a, b) => {
      const assetA = byId.get(a.id);
      const assetB = byId.get(b.id);
      if (assetA === undefined || assetB === undefined) return 0;
      if (sort === 'updated') {
        if (assetA.source.pushedAt !== assetB.source.pushedAt) {
          return assetA.source.pushedAt < assetB.source.pushedAt ? 1 : -1;
        }
      } else {
        const nameA = assetA.displayName['zh-CN'] ?? assetA.name;
        const nameB = assetB.displayName['zh-CN'] ?? assetB.name;
        if (nameA !== nameB) return nameA < nameB ? -1 : 1;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const hits: MarketSearchHit[] = [];
  for (const hit of ranked) {
    const asset = byId.get(hit.id);
    if (asset !== undefined) hits.push({ ...hit, asset });
  }

  const offset = Math.max(options.offset ?? 0, 0);
  const limit = options.limit ?? DEFAULT_LIMIT;
  return {
    query,
    terms,
    mode,
    total: hits.length,
    hits: hits.slice(offset, offset + limit),
  };
}

/** 分位数（最近秩法；P95 基线记录用——只记口径，不设硬门槛）。 */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(Math.max(Math.ceil(p * sorted.length), 1), sorted.length);
  return sorted[rank - 1] ?? 0;
}

/** 类型收窄辅助：从完整索引抽出可检索子集（daemon 收到完整索引时的桥）。 */
export function searchIndexOf(index: MarketplaceIndex): SearchIndex {
  return buildSearchIndex(index.assets, { generatedAt: index.generatedAt });
}
