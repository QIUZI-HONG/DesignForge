/**
 * 数据看板指标（D6；《技能市场规格 v1》§6.2 D6 + v1.1 §7.6 三看板口径）。
 *
 * 口径纪律（看板的「绝不伪造」与市场页同一把尺）：
 * - 指标只从 **daemon `/market/query` 的响应 + 其返回的卡片** 算，算不出的项**显式标「未上报」**
 *   （不猜、不填 0 冒充真值）；
 * - 三看板的**判红绿阈值随 MK 定稿**（规格 §9.11 未决）——这里只给**数值与分布**，不给颜色结论；
 * - `/market/query` 不含 `index.collector`（批次 runId / ODS 水位），故「采集进度」的这两项
 *   在本段显示未上报——补字段需 daemon 侧扩展（已列为未决，见报告）。
 */

import type { MarketAsset, MarketAssetKind, MarketQueryResponse } from '@dforge/contracts';

/** 四层仓（§4.1）。 */
export type LayerId = 'ods' | 'dwd' | 'dws' | 'ads';

/** 采集进度（批次与水位；缺失项为 null，界面标「未上报」）。 */
export interface CollectionProgress {
  /** 索引生成时刻（§1.1 generatedAt）。 */
  generatedAt: string | null;
  /** 批次 runId（`index.collector.runId`；`/market/query` 不返回 → null）。 */
  runId: string | null;
  /** ODS 水位（`index.collector.odsWatermark`；同上 → null）。 */
  odsWatermark: string | null;
  /** 卡片总数（counts.total）。 */
  total: number | null;
  /** 四类分布（加载到的子集实测；数量少于此说明分页截断）。 */
  byKind: { kind: MarketAssetKind; count: number }[];
  /** 可装载数（counts.loadable）。 */
  loadable: number | null;
  /** 受守门限制数（total − loadable；不出现 blocked 资产，故即「仅看」类）。 */
  gated: number | null;
  /** 当前加载到的卡片数（分页窗口）。 */
  loaded: number;
}

/** 读采集进度。 */
export function readCollectionProgress(response: MarketQueryResponse): CollectionProgress {
  const counts = response.counts;
  const items = response.items;
  const byKind = (['skill', 'plugin', 'design-system', 'template'] as const).map((kind) => ({
    kind,
    count: items.filter((asset) => asset.kind === kind).length,
  }));
  return {
    generatedAt: response.generatedAt,
    runId: null,
    odsWatermark: null,
    total: counts?.total ?? null,
    byKind,
    loadable: counts?.loadable ?? null,
    gated: counts === null ? null : Math.max(0, counts.total - counts.loadable),
    loaded: items.length,
  };
}

/** 层状态（有上报/未接入）。 */
export interface LayerStatus {
  id: LayerId;
  labelKey: string;
  status: 'reported' | 'unreported';
  /** 条目数（只有 ADS 从索引卡片可数）。 */
  entries: number | null;
  /** 最近重建/生成时刻。 */
  rebuiltAt: string | null;
  noteKey: string;
}

/**
 * 四层状态（§4.1）。
 * ADS = 索引本身（卡片数 + generatedAt，有上报）；ODS/DWD/DWS 的条目数与重建时刻来自采集线
 * 产物清单，本段 daemon 未上报 → 显式「未接入上报」（不以 ADS 数字冒充）。
 */
export function readLayerStatuses(response: MarketQueryResponse): LayerStatus[] {
  return [
    {
      id: 'ods',
      labelKey: 'dashboard.layer.ods',
      status: 'unreported',
      entries: null,
      rebuiltAt: null,
      noteKey: 'dashboard.layer.unreportedNote',
    },
    {
      id: 'dwd',
      labelKey: 'dashboard.layer.dwd',
      status: 'unreported',
      entries: null,
      rebuiltAt: null,
      noteKey: 'dashboard.layer.unreportedNote',
    },
    {
      id: 'dws',
      labelKey: 'dashboard.layer.dws',
      status: 'unreported',
      entries: null,
      rebuiltAt: null,
      noteKey: 'dashboard.layer.unreportedNote',
    },
    {
      id: 'ads',
      labelKey: 'dashboard.layer.ads',
      status: response.counts === null ? 'unreported' : 'reported',
      entries: response.counts?.total ?? null,
      rebuiltAt: response.generatedAt,
      noteKey:
        response.counts === null ? 'dashboard.layer.unreportedNote' : 'dashboard.layer.adsNote',
    },
  ];
}

/** 字段覆盖率（完整性看板用）。 */
export interface FieldCoverage {
  /** 字段键（人类可读，如 `version`）。 */
  field: string;
  present: number;
  missing: number;
}

/** 完整性看板。 */
export interface CompletenessBoard {
  total: number;
  /** 字段缺失总数（跨字段累加）。 */
  missingTotal: number;
  /** 字段齐全率（0–1；1 = 所有列出字段都在）。 */
  rate: number;
  fields: FieldCoverage[];
}

/** 声明「应尽量有」的字段（§1.2 可选但影响可用性；必填字段由解析器保证，不重复列）。 */
function optionalFieldChecks(asset: MarketAsset): { field: string; present: boolean }[] {
  return [
    { field: 'description', present: (asset.description ?? '').length > 0 },
    { field: 'version', present: (asset.version ?? '').length > 0 },
    { field: 'homepage', present: (asset.source.homepage ?? '').length > 0 },
    { field: 'upstream', present: (asset.source.upstream ?? '').length > 0 },
    { field: 'metrics', present: asset.metrics !== undefined },
    { field: 'summary.zh-CN', present: (asset.summary['zh-CN'] ?? '').length > 0 },
    { field: 'displayName.zh-CN', present: (asset.displayName['zh-CN'] ?? '').length > 0 },
    { field: 'facets.tags', present: asset.facets.tags.length > 0 },
    { field: 'facets.scenes', present: asset.facets.scenes.length > 0 },
    { field: 'license.spdx', present: asset.source.license.spdx !== null },
    { field: 'license.evidence', present: asset.source.license.evidence.path.length > 0 },
    { field: 'quality.explain', present: asset.quality.explain !== undefined },
  ];
}

/** 完整性：逐字段缺失率（字段缺失率 = missing / total）。 */
export function computeCompleteness(assets: readonly MarketAsset[]): CompletenessBoard {
  const total = assets.length;
  if (total === 0) {
    return { total: 0, missingTotal: 0, rate: 1, fields: [] };
  }
  const fields: FieldCoverage[] = [];
  let missingTotal = 0;
  const first = assets[0];
  if (first !== undefined) {
    for (const check of optionalFieldChecks(first)) {
      let missing = 0;
      for (const asset of assets) {
        const found = optionalFieldChecks(asset).find((item) => item.field === check.field);
        if (found === undefined || !found.present) missing += 1;
      }
      fields.push({ field: check.field, present: total - missing, missing });
      missingTotal += missing;
    }
  }
  const slotTotal = total * fields.length;
  return {
    total,
    missingTotal,
    rate: slotTotal === 0 ? 1 : (slotTotal - missingTotal) / slotTotal,
    fields,
  };
}

/** 一致性看板。 */
export interface ConsistencyBoard {
  total: number;
  /** 重复 id 组（解析器与 schema 校验均要求唯一；>0 说明上游数据异常）。 */
  duplicateIdGroups: string[][];
  /** 重复 digest 组（同内容多卡片 = 近重复未聚合的信号）。 */
  duplicateDigestGroups: string[][];
  /** 孤儿引用：ref / digest / 许可证据路径为空（引用悬空）。 */
  danglingRefs: number;
}

/** 一致性：重复率与孤儿引用。 */
export function computeConsistency(assets: readonly MarketAsset[]): ConsistencyBoard {
  const byId = new Map<string, string[]>();
  const byDigest = new Map<string, string[]>();
  let danglingRefs = 0;
  for (const asset of assets) {
    byId.set(asset.id, [...(byId.get(asset.id) ?? []), asset.id]);
    byDigest.set(asset.digest, [...(byDigest.get(asset.digest) ?? []), asset.id]);
    if (
      asset.source.ref.length === 0 ||
      asset.digest.length === 0 ||
      asset.source.license.evidence.path.length === 0
    ) {
      danglingRefs += 1;
    }
  }
  return {
    total: assets.length,
    duplicateIdGroups: [...byId.values()].filter((group) => group.length > 1),
    duplicateDigestGroups: [...byDigest.values()].filter((group) => group.length > 1),
    danglingRefs,
  };
}

/** 时效性看板。 */
export interface FreshnessBucket {
  key: 'fresh30' | 'fresh90' | 'fresh365' | 'stale';
  labelKey: string;
  count: number;
}

/** 时效性：数据新鲜度分布 + 索引年龄。 */
export interface FreshnessBoard {
  buckets: FreshnessBucket[];
  /** 无法解析 pushedAt 的卡片数（如实计入，不悄悄丢掉）。 */
  unknown: number;
  /** 索引生成时刻距现在的天数（nowIso 与 generatedAt 都可解析时给，否则 null）。 */
  indexAgeDays: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 时效性分布（按 `source.pushedAt` 距 `nowIso` 的天数分档）。 */
export function computeFreshness(
  assets: readonly MarketAsset[],
  response: { generatedAt: string | null },
  nowIso: string,
): FreshnessBoard {
  const now = Date.parse(nowIso);
  let fresh30 = 0;
  let fresh90 = 0;
  let fresh365 = 0;
  let stale = 0;
  let unknown = 0;
  for (const asset of assets) {
    const pushed = Date.parse(asset.source.pushedAt);
    if (!Number.isFinite(pushed) || !Number.isFinite(now)) {
      unknown += 1;
      continue;
    }
    const days = (now - pushed) / DAY_MS;
    if (days <= 30) fresh30 += 1;
    else if (days <= 90) fresh90 += 1;
    else if (days <= 365) fresh365 += 1;
    else stale += 1;
  }
  const buckets: FreshnessBucket[] = [
    { key: 'fresh30', labelKey: 'dashboard.fresh.30', count: fresh30 },
    { key: 'fresh90', labelKey: 'dashboard.fresh.90', count: fresh90 },
    { key: 'fresh365', labelKey: 'dashboard.fresh.365', count: fresh365 },
    { key: 'stale', labelKey: 'dashboard.fresh.stale', count: stale },
  ];
  const generated = response.generatedAt === null ? Number.NaN : Date.parse(response.generatedAt);
  return {
    buckets,
    unknown,
    indexAgeDays:
      Number.isFinite(generated) && Number.isFinite(now) ? (now - generated) / DAY_MS : null,
  };
}
