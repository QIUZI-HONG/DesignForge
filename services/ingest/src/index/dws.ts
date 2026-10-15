/**
 * DWS 输入契约（MK-04 消费面）——四层仓中 DWD 资产行 + DWS 质量/facet 行的**联结行**。
 *
 * 规格依据：《技能市场规格 v1》§4.4（DWS = asset_quality 五维 + 扣分原因码 / asset_facet
 * category·lane·mode·tags·scenes）；卡片的最终字段在 §1.2。MK-03（评分）并行落地中，
 * 本文件先给 MK-04 需要的最小输入形状 + 宽容读取器；MK-03 落地后由其产出对接
 * （若字段形状不一致 → 在 MK-04 内做适配层，见报告「偏离与未决」）。
 *
 * 与 `@dforge/contracts` 的关系：契约管**产物侧**（`df.marketplace.index/v1` 卡片），
 * 本文件管**输入侧**（DWS 行）；产物一律用 contracts 的类型（见 build.ts）。
 */

import type { LicenseGate, MarketAssetKind } from '@dforge/contracts';

/** 双语文本（同卡片；缺一言回退另一言）。 */
export interface DwsLocalizedText {
  'zh-CN'?: string;
  en?: string;
}

/** 许可判定（MK-01 产出、MK-02 落 DWD；`evidence.sha256` 可能为 null = 未取回正文）。 */
export interface DwsLicense {
  spdx: string | null;
  gate: LicenseGate;
  evidence: { path: string | null; sha256: string | null };
}

/** 溯源字段（DWD repo 表 + 资产行；对应卡片 `source`，§1.3）。 */
export interface DwsSource {
  repo: string;
  repoId: number;
  path: string;
  ref: string;
  fetchedAt: string;
  license: DwsLicense;
  stars: number;
  pushedAt: string;
  archived: boolean;
  homepage: string | null;
  upstream: string | null;
  brandDerived: boolean;
}

/** 五维解释（§5.3：signals + deductions；原因码词表可扩展）。 */
export interface DwsQualityExplain {
  signals?: { code: string; value: number; weight: number }[];
  deductions?: { code: string; reason: string; delta: number }[];
}

/** 质量行（DWS asset_quality，§5.1 权重口径）。 */
export interface DwsQuality {
  score: number;
  dims: { spec: number; maintenance: number; docs: number; security: number; ecosystem: number };
  explain?: Record<string, DwsQualityExplain>;
}

/** 分类面（DWS asset_facet，§1.4；未知枚举由读取器归 其他/other）。 */
export interface DwsFacets {
  category: string;
  lane: string;
  mode: string | null;
  tags: string[];
  scenes: string[];
}

/** 一条联结后的 DWS 资产行（MK-04 的输入单元）。 */
export interface DwsAssetRecord {
  id: string;
  kind: MarketAssetKind;
  name: string;
  displayName: DwsLocalizedText;
  summary: DwsLocalizedText;
  description?: string;
  version?: string | null;
  source: DwsSource;
  /** 未声明时缺省 `["prompt:inject"]`（§1.2，由 build 补缺）。 */
  capabilities?: string[];
  facets: DwsFacets;
  quality: DwsQuality;
  /** 静态安全审计结论（§1.2 installGate.security 的来源）。 */
  security: 'pass' | 'warn' | 'fail';
  /** 门禁原因（license 判定理由 + 安全扣分说明；build 会并入 installGate.reasons）。 */
  reasons: string[];
  digest: string;
  /** 本地回流计数（首版全 0/空；§8.3 遥测默认仅本地）。 */
  metrics?: { installs: number; adoptions: number; favorites: number; lastUsedAt: string | null };
  yanked?: { reason: string; at: string; source: string } | null;
}

/** 读取结果：宽容读取，坏行计数跳过（不拖垮整批——与消费侧 parseMarketplaceIndex 同族纪律）。 */
export interface DwsReadResult {
  assets: DwsAssetRecord[];
  skipped: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asLocalized(value: unknown): DwsLocalizedText {
  if (!isRecord(value)) return {};
  const text: DwsLocalizedText = {};
  if (typeof value['zh-CN'] === 'string') text['zh-CN'] = value['zh-CN'];
  if (typeof value.en === 'string') text.en = value.en;
  return text;
}

const KINDS: readonly string[] = ['skill', 'plugin', 'design-system', 'template'];
const LANES: readonly string[] = ['create', 'refine', 'deliver'];

function asKind(value: unknown): MarketAssetKind {
  return typeof value === 'string' && KINDS.includes(value) ? (value as MarketAssetKind) : 'skill';
}

function asGate(value: unknown): LicenseGate {
  return value === 'loadable' || value === 'view-only' || value === 'blocked' ? value : 'view-only';
}

function asSecurity(value: unknown): 'pass' | 'warn' | 'fail' {
  return value === 'pass' || value === 'warn' || value === 'fail' ? value : 'pass';
}

/** 读取单条 DWS 行；缺关键结构（id/name/source/facets/quality）→ null（计入 skipped）。 */
export function readDwsAsset(value: unknown): DwsAssetRecord | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const name = asString(value.name);
  const source = value.source;
  const facets = value.facets;
  const quality = value.quality;
  if (id.length === 0 || name.length === 0) return null;
  if (!isRecord(source) || !isRecord(facets) || !isRecord(quality)) return null;
  const repo = asString(source.repo);
  const path = asString(source.path);
  if (repo.length === 0) return null;
  const license = isRecord(source.license) ? source.license : {};
  const evidence = isRecord(license.evidence) ? license.evidence : {};
  const dims = isRecord(quality.dims) ? quality.dims : {};

  const record: DwsAssetRecord = {
    id,
    kind: asKind(value.kind),
    name,
    displayName: asLocalized(value.displayName),
    summary: asLocalized(value.summary),
    source: {
      repo,
      repoId: asNumber(source.repoId, -1),
      path,
      ref: asString(source.ref),
      fetchedAt: asString(source.fetchedAt),
      license: {
        spdx: typeof license.spdx === 'string' ? license.spdx : null,
        gate: asGate(license.gate),
        evidence: {
          path: typeof evidence.path === 'string' ? evidence.path : null,
          sha256: typeof evidence.sha256 === 'string' ? evidence.sha256 : null,
        },
      },
      stars: asNumber(source.stars),
      pushedAt: asString(source.pushedAt),
      archived: asBoolean(source.archived),
      homepage: typeof source.homepage === 'string' ? source.homepage : null,
      upstream: typeof source.upstream === 'string' ? source.upstream : null,
      brandDerived: asBoolean(source.brandDerived),
    },
    facets: {
      category: asString(facets.category, '其他'),
      lane: typeof facets.lane === 'string' && LANES.includes(facets.lane) ? facets.lane : 'create',
      mode: typeof facets.mode === 'string' ? facets.mode : null,
      tags: asStringArray(facets.tags),
      scenes: asStringArray(facets.scenes),
    },
    quality: {
      score: asNumber(quality.score),
      dims: {
        spec: asNumber(dims.spec),
        maintenance: asNumber(dims.maintenance),
        docs: asNumber(dims.docs),
        security: asNumber(dims.security),
        ecosystem: asNumber(dims.ecosystem),
      },
    },
    security: asSecurity(value.security),
    reasons: asStringArray(value.reasons),
    digest: asString(value.digest),
  };
  if (typeof value.description === 'string') record.description = value.description;
  if (typeof value.version === 'string') record.version = value.version;
  if (Array.isArray(value.capabilities)) record.capabilities = asStringArray(value.capabilities);
  if (isRecord(quality.explain)) {
    record.quality.explain = quality.explain as Record<string, DwsQualityExplain>;
  }
  if (isRecord(value.metrics)) {
    record.metrics = {
      installs: asNumber(value.metrics.installs),
      adoptions: asNumber(value.metrics.adoptions),
      favorites: asNumber(value.metrics.favorites),
      lastUsedAt: typeof value.metrics.lastUsedAt === 'string' ? value.metrics.lastUsedAt : null,
    };
  }
  if (isRecord(value.yanked)) {
    record.yanked = {
      reason: asString(value.yanked.reason),
      at: asString(value.yanked.at),
      source: asString(value.yanked.source, 'policy'),
    };
  }
  return record;
}

/**
 * 读取 DWS 样本（`{asOf, assets[]}` 或裸数组两种形态都接受）。
 * 坏行跳过并计数——如实上报，不假装通过。
 */
export function readDwsSample(value: unknown): DwsReadResult & { asOf: string | null } {
  const asOf = isRecord(value) && typeof value.asOf === 'string' ? value.asOf : null;
  const rawAssets = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.assets)
      ? value.assets
      : null;
  if (rawAssets === null) return { assets: [], skipped: 0, asOf };
  const assets: DwsAssetRecord[] = [];
  let skipped = 0;
  for (const raw of rawAssets) {
    const record = readDwsAsset(raw);
    if (record === null) skipped += 1;
    else assets.push(record);
  }
  return { assets, skipped, asOf };
}
