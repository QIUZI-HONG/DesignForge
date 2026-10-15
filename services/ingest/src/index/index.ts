/**
 * @dforge/ingest · 索引与检索（MK-04）公共 API。
 *
 * 分层（详见各模块头注释）：
 *   dws      → DWS 输入契约（DWD 资产行 + DWS 质量/facet 联结行）与宽容读取器
 *   build    → `df.marketplace.index/v1` 产出（门禁合成/blocked 过滤/counts/确定性排序）
 *   schema   → schema 校验器（生产侧严格档；daemon/FE-11/MK-05 复用）
 *   terms    → 中英术语等价类与分词（"PPT/幻灯片/deck" 起步表）
 *   search   → BM25 检索、排序（质量分 × 相关度）与倒排产物
 *   pipeline → ADS 产物集构建与落盘（先校验后写）
 *   query-set→ 示例查询集（≥10 条，判据链第 5 环）
 */

export type { MarketplaceBuildOptions } from './build.ts';
export {
  ACK_REQUIRED_CAPABILITIES,
  buildMarketplaceIndex,
  composeInstallGate,
  DEFAULT_CAPABILITIES,
  DEFAULT_COLLECTOR_NAME,
  toMarketAsset,
} from './build.ts';
export type {
  DwsAssetRecord,
  DwsFacets,
  DwsLicense,
  DwsLocalizedText,
  DwsQuality,
  DwsQualityExplain,
  DwsReadResult,
  DwsSource,
} from './dws.ts';
export { readDwsAsset, readDwsSample } from './dws.ts';
export type { AdsArtifacts, WrittenAdsArtifacts } from './pipeline.ts';
export {
  ADS_INDEX_FILENAME,
  ADS_SEARCH_INDEX_FILENAME,
  buildAdsArtifacts,
  writeAdsArtifacts,
} from './pipeline.ts';
export type { ExampleQuery, ExampleQueryFilters } from './query-set.ts';
export { EXAMPLE_QUERIES } from './query-set.ts';
export type {
  IndexIssueCode,
  IndexValidationIssue,
  IndexValidationOptions,
  IndexValidationResult,
} from './schema.ts';
export {
  CAPABILITY_WHITELIST,
  formatIndexIssues,
  MARKETPLACE_INDEX_SCHEMA_ID,
  QUALITY_WEIGHTS,
  validateMarketplaceIndex,
} from './schema.ts';
export type {
  MarketSearchHit,
  RankedHit,
  SearchAssetsOptions,
  SearchFilters,
  SearchIndex,
  SearchIndexDoc,
  SearchResponse,
} from './search.ts';
export {
  BM25_B,
  BM25_K1,
  buildSearchIndex,
  percentile,
  queryTerms,
  SEARCH_FIELD_WEIGHTS,
  SEARCH_INDEX_SCHEMA,
  searchAssets,
  searchIndexOf,
  searchMarketIndex,
} from './search.ts';
export {
  classOf,
  expandEquivalents,
  indexText,
  TERM_EQUIVALENCE_CLASSES,
  TERM_TABLE_VERSION,
  tokenizeText,
} from './terms.ts';
