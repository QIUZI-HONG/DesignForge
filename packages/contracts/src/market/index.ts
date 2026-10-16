/**
 * @dforge/contracts · market 命名空间（**df.marketplace.index/v1**）。
 *
 * 以 `docs/spec/marketplace-spec-v1.md` §1 为准（逐字段定稿：Asset/Source/facets/quality/
 * installGate/digest 等）。版本演进规则（§1.5）：按 `schema` 精确匹配主版本、
 * **未知字段忽略**（前向兼容）、**未知枚举一律归 other**（不得报错退出）——由 `parseMarketplaceIndex`
 * 与查询层共同保证。
 * 消费方：FE-11（市场前端）、FE-10（编辑器内市场面板）、MK-04/05（索引读写）、CLI 检索。
 */

import { isSha256Digest } from '../ipc/guards.ts';
import type {
  LicenseGate,
  MarketAssetKind,
  MarketCategory,
  MarketLane,
  MarketMode,
  MarketSecurityLevel,
} from './vocab.ts';
import {
  isLicenseGate,
  isMarketAssetKind,
  isMarketLane,
  isMarketSecurityLevel,
  MARKET_CATEGORIES,
  MARKET_MODES,
} from './vocab.ts';

export type {
  LicenseGate,
  MarketAssetKind,
  MarketCategory,
  MarketCompliance,
  MarketLane,
  MarketLicenseTier,
  MarketMode,
  MarketQualityDim,
  MarketSecurityLevel,
} from './vocab.ts';
// 词表真源在 `./vocab.ts`（ADR-0004 ③ 收敛）；本模块只消费与转出，不另立字面量。
export {
  isLicenseGate,
  isMarketAssetKind,
  isMarketCompliance,
  isMarketLane,
  isMarketLicenseTier,
  isMarketSecurityLevel,
  MARKET_ASSET_KINDS,
  MARKET_CATEGORIES,
  MARKET_COMPLIANCES,
  MARKET_LANES,
  MARKET_LICENSE_GATES,
  MARKET_LICENSE_TIERS,
  MARKET_MODES,
  MARKET_QUALITY_DIMENSIONS,
  MARKET_QUALITY_WEIGHTS,
  MARKET_SECURITY_LEVELS,
} from './vocab.ts';

/** 市场索引契约标识。 */
export const MARKETPLACE_INDEX_SCHEMA = 'df.marketplace.index/v1' as const;

/** 装载门模式（blocked 者不进 assets 列表——见 §1.1）。
 *
 * 与 license 三档（`MARKET_LICENSE_GATES`）同词表：由真源**派生别名**，不另立字面量
 * （code-review：B 半做——此处此前是第二份 `'loadable' | 'view-only' | 'blocked'`，
 * 已由 `guard:vocab` 登记名 InstallGateMode 覆盖）。
 */
export type InstallGateMode = LicenseGate;

/** 双语字段（缺一言回退另一言，皆缺回退 name）。 */
export interface MarketLocalizedText {
  'zh-CN'?: string;
  en?: string;
}

/** 溯源块（§1.3）。 */
export interface MarketSource {
  repo: string;
  repoId: number;
  path: string;
  /** 采集时点 commit（40 位 hex；卡片与详情显示短哈希）。 */
  ref: string;
  fetchedAt: string;
  license: {
    spdx: string | null;
    gate: LicenseGate;
    evidence: { path: string; sha256: string };
  };
  stars: number;
  pushedAt: string;
  archived: boolean;
  homepage: string | null;
  upstream: string | null;
  brandDerived: boolean;
}

/** 分类面（§1.4）。 */
export interface MarketAssetFacets {
  category: MarketCategory;
  lane: MarketLane;
  mode: MarketMode | null;
  tags: string[];
  scenes: string[];
}

/** 五维评分与可解释（§5；explain 结构随 MK-03 展开，v1 允许缺省）。 */
export interface MarketQuality {
  score: number;
  dims: {
    spec: number;
    maintenance: number;
    docs: number;
    security: number;
    ecosystem: number;
  };
  explain?: Record<string, unknown>;
}

/** 装载门（§1.2 / §7.2）。 */
export interface MarketInstallGate {
  mode: InstallGateMode;
  licenseGate: LicenseGate;
  /** 静态安全审计结论：真源 `MARKET_SECURITY_LEVELS` 的派生类型（勿另立字面量联合）。 */
  security: MarketSecurityLevel;
  reasons: string[];
  /** 需显式授权的能力（D4 确认门禁输入）。 */
  ackRequired: string[];
}

/** 本地回流计数（首版全 0；遥测默认仅本地）。 */
export interface MarketMetrics {
  installs: number;
  adoptions: number;
  favorites: number;
  lastUsedAt: string | null;
}

/** 下架标记（§8.2）。 */
export interface MarketYank {
  reason: string;
  at: string;
  source: 'rights-holder' | 'license-change' | 'policy' | string;
}

/** 资产卡片（§1.2 逐字段）。 */
export interface MarketAsset {
  id: string;
  kind: MarketAssetKind;
  name: string;
  displayName: MarketLocalizedText;
  summary: MarketLocalizedText;
  description?: string;
  source: MarketSource;
  capabilities: string[];
  facets: MarketAssetFacets;
  quality: MarketQuality;
  installGate: MarketInstallGate;
  digest: string;
  version?: string;
  /** 首版恒 null（向量检索圈外）。 */
  embeddingRef: string | null;
  metrics?: MarketMetrics;
  yanked: MarketYank | null;
}

/** 索引顶层（§1.1）。 */
export interface MarketplaceIndex {
  schema: typeof MARKETPLACE_INDEX_SCHEMA;
  generatedAt: string;
  collector: { name: string; version: string; runId: string; odsWatermark: string };
  counts: { total: number; byKind: Record<MarketAssetKind, number>; loadable: number };
  assets: MarketAsset[];
}

/** 索引解析结果（宽容解析：未知字段忽略、未知枚举归 other；仅关键结构缺失才失败）。 */
export type MarketplaceParseResult =
  | { ok: true; index: MarketplaceIndex; skipped: number }
  | { ok: false; reason: string };

function asLocalizedText(value: unknown): MarketLocalizedText {
  if (typeof value !== 'object' || value === null) return {};
  const record = value as Record<string, unknown>;
  const text: MarketLocalizedText = {};
  if (typeof record['zh-CN'] === 'string') text['zh-CN'] = record['zh-CN'];
  if (typeof record.en === 'string') text.en = record.en;
  return text;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeCategory(value: unknown): MarketCategory {
  return typeof value === 'string' && (MARKET_CATEGORIES as readonly string[]).includes(value)
    ? (value as MarketCategory)
    : '其他';
}

function normalizeMode(value: unknown): MarketMode | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && (MARKET_MODES as readonly string[]).includes(value)
    ? (value as MarketMode)
    : 'other';
}

function normalizeGate(value: unknown): LicenseGate {
  return isLicenseGate(value) ? value : 'view-only';
}

function parseAsset(value: unknown): MarketAsset | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const source = raw.source;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  if (typeof raw.name !== 'string' || raw.name.length === 0) return null;
  if (typeof source !== 'object' || source === null) return null;
  const rawSource = source as Record<string, unknown>;
  if (typeof rawSource.repo !== 'string' || typeof rawSource.path !== 'string') return null;

  const rawLicense = rawSource.license;
  const licenseRecord =
    typeof rawLicense === 'object' && rawLicense !== null
      ? (rawLicense as Record<string, unknown>)
      : {};
  const rawEvidence = licenseRecord.evidence;
  const evidenceRecord =
    typeof rawEvidence === 'object' && rawEvidence !== null
      ? (rawEvidence as Record<string, unknown>)
      : {};

  const rawFacets = raw.facets;
  const facetsRecord =
    typeof rawFacets === 'object' && rawFacets !== null
      ? (rawFacets as Record<string, unknown>)
      : {};
  const rawQuality = raw.quality;
  const qualityRecord =
    typeof rawQuality === 'object' && rawQuality !== null
      ? (rawQuality as Record<string, unknown>)
      : {};
  const rawDims = qualityRecord.dims;
  const dimsRecord =
    typeof rawDims === 'object' && rawDims !== null ? (rawDims as Record<string, unknown>) : {};
  const rawGate = raw.installGate;
  const gateRecord =
    typeof rawGate === 'object' && rawGate !== null ? (rawGate as Record<string, unknown>) : {};
  const rawMetrics = raw.metrics;
  const metricsRecord =
    typeof rawMetrics === 'object' && rawMetrics !== null
      ? (rawMetrics as Record<string, unknown>)
      : null;

  const kind: MarketAssetKind = isMarketAssetKind(raw.kind) ? raw.kind : 'skill';
  const lane: MarketLane = isMarketLane(facetsRecord.lane) ? facetsRecord.lane : 'create';

  const quality: MarketQuality = {
    score: asNumber(qualityRecord.score),
    dims: {
      spec: asNumber(dimsRecord.spec),
      maintenance: asNumber(dimsRecord.maintenance),
      docs: asNumber(dimsRecord.docs),
      security: asNumber(dimsRecord.security),
      ecosystem: asNumber(dimsRecord.ecosystem),
    },
  };
  if (typeof qualityRecord.explain === 'object' && qualityRecord.explain !== null) {
    quality.explain = qualityRecord.explain as Record<string, unknown>;
  }

  const asset: MarketAsset = {
    id: raw.id,
    kind,
    name: raw.name,
    displayName: asLocalizedText(raw.displayName),
    summary: asLocalizedText(raw.summary),
    source: {
      repo: rawSource.repo,
      repoId: asNumber(rawSource.repoId, -1),
      path: rawSource.path,
      ref: typeof rawSource.ref === 'string' ? rawSource.ref : '',
      fetchedAt: typeof rawSource.fetchedAt === 'string' ? rawSource.fetchedAt : '',
      license: {
        spdx: typeof licenseRecord.spdx === 'string' ? licenseRecord.spdx : null,
        gate: normalizeGate(licenseRecord.gate),
        evidence: {
          path: typeof evidenceRecord.path === 'string' ? evidenceRecord.path : '',
          sha256: typeof evidenceRecord.sha256 === 'string' ? evidenceRecord.sha256 : '',
        },
      },
      stars: asNumber(rawSource.stars),
      pushedAt: typeof rawSource.pushedAt === 'string' ? rawSource.pushedAt : '',
      archived: asBoolean(rawSource.archived),
      homepage: typeof rawSource.homepage === 'string' ? rawSource.homepage : null,
      upstream: typeof rawSource.upstream === 'string' ? rawSource.upstream : null,
      brandDerived: asBoolean(rawSource.brandDerived),
    },
    capabilities: asStringArray(raw.capabilities),
    facets: {
      category: normalizeCategory(facetsRecord.category),
      lane,
      mode: normalizeMode(facetsRecord.mode),
      tags: asStringArray(facetsRecord.tags),
      scenes: asStringArray(facetsRecord.scenes),
    },
    quality,
    installGate: {
      mode: normalizeGate(gateRecord.mode),
      licenseGate: normalizeGate(gateRecord.licenseGate),
      security: isMarketSecurityLevel(gateRecord.security) ? gateRecord.security : 'pass',
      reasons: asStringArray(gateRecord.reasons),
      ackRequired: asStringArray(gateRecord.ackRequired),
    },
    digest: typeof raw.digest === 'string' ? raw.digest : '',
    embeddingRef: typeof raw.embeddingRef === 'string' ? raw.embeddingRef : null,
    yanked: null,
  };
  if (typeof raw.description === 'string') asset.description = raw.description;
  if (typeof raw.version === 'string') asset.version = raw.version;
  if (metricsRecord !== null) {
    asset.metrics = {
      installs: asNumber(metricsRecord.installs),
      adoptions: asNumber(metricsRecord.adoptions),
      favorites: asNumber(metricsRecord.favorites),
      lastUsedAt: typeof metricsRecord.lastUsedAt === 'string' ? metricsRecord.lastUsedAt : null,
    };
  }
  if (typeof raw.yanked === 'object' && raw.yanked !== null) {
    const yank = raw.yanked as Record<string, unknown>;
    asset.yanked = {
      reason: typeof yank.reason === 'string' ? yank.reason : '',
      at: typeof yank.at === 'string' ? yank.at : '',
      source: typeof yank.source === 'string' ? yank.source : 'policy',
    };
  }
  return asset;
}

/**
 * 解析市场索引 JSON（消费方契约 §1.5）。
 * - schema 不匹配 → 失败（调用方按「索引无效」空态处理）；
 * - 单条资产缺关键字段 → 跳过并计数（`skipped`），不拖垮整批。
 */
export function parseMarketplaceIndex(value: unknown): MarketplaceParseResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: '索引根必须是 JSON 对象' };
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== MARKETPLACE_INDEX_SCHEMA) {
    return { ok: false, reason: `schema 不匹配（期望 ${MARKETPLACE_INDEX_SCHEMA}）` };
  }
  if (!Array.isArray(record.assets)) {
    return { ok: false, reason: 'assets 必须是数组' };
  }
  const assets: MarketAsset[] = [];
  let skipped = 0;
  for (const raw of record.assets) {
    const asset = parseAsset(raw);
    if (asset === null) {
      skipped += 1;
      continue;
    }
    assets.push(asset);
  }
  const rawCounts = record.counts;
  const countsRecord =
    typeof rawCounts === 'object' && rawCounts !== null
      ? (rawCounts as Record<string, unknown>)
      : {};
  const rawByKind = countsRecord.byKind;
  const byKindRecord =
    typeof rawByKind === 'object' && rawByKind !== null
      ? (rawByKind as Record<string, unknown>)
      : {};
  const rawCollector = record.collector;
  const collectorRecord =
    typeof rawCollector === 'object' && rawCollector !== null
      ? (rawCollector as Record<string, unknown>)
      : {};

  return {
    ok: true,
    skipped,
    index: {
      schema: MARKETPLACE_INDEX_SCHEMA,
      generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : '',
      collector: {
        name: typeof collectorRecord.name === 'string' ? collectorRecord.name : '',
        version: typeof collectorRecord.version === 'string' ? collectorRecord.version : '',
        runId: typeof collectorRecord.runId === 'string' ? collectorRecord.runId : '',
        odsWatermark:
          typeof collectorRecord.odsWatermark === 'string' ? collectorRecord.odsWatermark : '',
      },
      counts: {
        total: asNumber(countsRecord.total, assets.length),
        byKind: {
          skill: asNumber(byKindRecord.skill),
          plugin: asNumber(byKindRecord.plugin),
          'design-system': asNumber(byKindRecord['design-system']),
          template: asNumber(byKindRecord.template),
        },
        loadable: asNumber(countsRecord.loadable),
      },
      assets,
    },
  };
}

/** 双语回退（卡片主文案：zh-CN → en → 机器名）。 */
export function displayText(localized: MarketLocalizedText, fallback: string): string {
  const zh = localized['zh-CN'];
  if (typeof zh === 'string' && zh.trim().length > 0) return zh;
  const en = localized.en;
  if (typeof en === 'string' && en.trim().length > 0) return en;
  return fallback;
}

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
  sort?: 'score' | 'updated' | 'name';
  limit?: number;
  offset?: number;
}

/** 查询告警（部分失败/索引缺失不抛错，前端在结果区提示）。
 *
 * `search-index-*`：BM25 检索索引（`market_search_index.v1.json`）缺失/损坏时的**降级提示**——
 * 查询仍可按字面匹配返回，但中文词项（如「幻灯片」）会漏命中；与 `index-*`（市场索引本身
 * 缺失，无卡片可展示）是两种不同的空态口径，前端据此分别提示，不得合并。 */
export interface MarketQueryWarning {
  code: 'index-missing' | 'index-invalid' | 'search-index-missing' | 'search-index-invalid' | 'partial-failure';
  message: string;
}

/** 查询响应（`state='empty'` 覆盖「无索引/无结果」两种空态）。 */
export interface MarketQueryResponse {
  schema: typeof MARKETPLACE_INDEX_SCHEMA;
  state: 'ok' | 'empty';
  generatedAt: string | null;
  /** 匹配过滤条件的总数（用于分页）。 */
  total: number;
  counts: MarketplaceIndex['counts'] | null;
  items: MarketAsset[];
  warnings: MarketQueryWarning[];
}

/** 详情响应（found=false 由路由映射为 market_asset_not_found）。 */
export type MarketAssetDetailResponse =
  | { found: true; asset: MarketAsset }
  | { found: false; assetId: string };

/** 装载提案请求（真实装载走 MCP 确认桩：dryRun → ackToken → 审计）。 */
export interface MarketLoadPlanRequest {
  assetId: string;
  documentId?: string | null;
}

/** 装载提案（三态：可装载 / 仅看 / 禁）。 */
export interface MarketLoadPlan {
  assetId: string;
  mode: InstallGateMode;
  loadable: boolean;
  ackRequired: string[];
  license: { spdx: string | null; gate: LicenseGate; evidencePath: string; evidenceSha256: string };
  /** 装载落点提示（`.dfg/market/<kind>/<slug>/`）。 */
  targetPathHint: string | null;
  reasons: string[];
  /** 中文说明（三态各自的解释文案）。 */
  notice: string;
}

/** 校验索引摘要（供市场路由做轻量自检；完整解析用 parseMarketplaceIndex）。 */
export function isMarketDigest(value: unknown): value is string {
  return isSha256Digest(value);
}
