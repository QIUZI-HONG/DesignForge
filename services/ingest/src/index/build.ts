/**
 * 市场索引产出（MK-04）——DWS 联结行 → `df.marketplace.index/v1`（规格 §1 逐字段）。
 *
 * 职责边界：
 * - **本模块**：字段映射与缺省补齐（capabilities/metrics/yanked/embeddingRef）、门禁合成
 *   （`installGate` = license 档 + 安全结论 + 归档/品牌/下架派生，§7.2）、blocked 过滤（§1.1）、
 *   counts 统计、确定性排序（§4.3：同输入同输出）；
 * - **不做**：评分（MK-03）、文件哈希与 digest 计算（MK-02）、采集与 license 判定（MK-01）。
 *
 * 产物形状一律用 `@dforge/contracts` 的 `MarketplaceIndex`（INF-01 已定稿），不另起一套。
 */

import {
  MARKETPLACE_INDEX_SCHEMA,
  type MarketAsset,
  type MarketInstallGate,
  type MarketplaceIndex,
} from '@dforge/contracts';

import type { DwsAssetRecord } from './dws.ts';

/** 需显式授权的能力（§7.1：subprocess/bash 默认拒绝，装载确认条逐次授权）。 */
export const ACK_REQUIRED_CAPABILITIES: readonly string[] = ['subprocess', 'bash'];

/** 能力缺省（§1.2：资产未声明时缺省 `["prompt:inject"]`）。 */
export const DEFAULT_CAPABILITIES: readonly string[] = ['prompt:inject'];

/** 批次元数据（生成者 + 批次溯源；`generatedAt` 可注入以复现，§4.3）。 */
export interface MarketplaceBuildOptions {
  /** 索引生成时刻（ISO8601；取自批次元数据而非当前时钟——去时钟依赖）。 */
  generatedAt: string;
  collector: { name: string; version: string; runId: string; odsWatermark: string };
}

/** 缺省生成者标识（`df market index` 批次）。 */
export const DEFAULT_COLLECTOR_NAME = 'df-market';

/**
 * 合成装载门（规格 §7.2 三档守门 + §1.2 installGate 字段）。
 * blocked 优先级最高（品牌复刻 / 下架 / 许可禁止）；归档仓与「仅看」许可归 view-only。
 */
export function composeInstallGate(record: DwsAssetRecord): MarketInstallGate {
  const capabilities = record.capabilities ?? [...DEFAULT_CAPABILITIES];
  const licenseGate = record.source.license.gate;
  const reasons = [...record.reasons];

  let mode: MarketInstallGate['mode'];
  if (licenseGate === 'blocked' || record.source.brandDerived || record.yanked != null) {
    mode = 'blocked';
    if (record.source.brandDerived) reasons.push('品牌复刻（商标风险，§7.2）');
    if (record.yanked != null) reasons.push(`已下架：${record.yanked.reason}（§8.2）`);
  } else if (licenseGate === 'view-only' || record.source.archived) {
    mode = 'view-only';
    if (record.source.archived) reasons.push('归档仓（仅看，§7.2）');
  } else {
    mode = 'loadable';
  }

  return {
    mode,
    licenseGate,
    security: record.security,
    // 原因去重但保序（license 判定理由在前，派生说明在后）
    reasons: [...new Set(reasons)],
    ackRequired: capabilities.filter((capability) =>
      (ACK_REQUIRED_CAPABILITIES as readonly string[]).includes(capability),
    ),
  };
}

/** DWS 行 → 卡片（§1.2 逐字段映射 + 缺省补齐）。 */
export function toMarketAsset(record: DwsAssetRecord): MarketAsset {
  const asset: MarketAsset = {
    id: record.id,
    kind: record.kind,
    name: record.name,
    displayName: record.displayName,
    summary: record.summary,
    source: {
      repo: record.source.repo,
      repoId: record.source.repoId,
      path: record.source.path,
      ref: record.source.ref,
      fetchedAt: record.source.fetchedAt,
      license: {
        spdx: record.source.license.spdx,
        gate: record.source.license.gate,
        // 卡片 schema 要求 evidence 两键为 string；未取回正文时以空串表达「无证据」（§1.3）
        evidence: {
          path: record.source.license.evidence.path ?? '',
          sha256: record.source.license.evidence.sha256 ?? '',
        },
      },
      stars: record.source.stars,
      pushedAt: record.source.pushedAt,
      archived: record.source.archived,
      homepage: record.source.homepage,
      upstream: record.source.upstream,
      brandDerived: record.source.brandDerived,
    },
    capabilities: [...(record.capabilities ?? DEFAULT_CAPABILITIES)],
    facets: {
      category: record.facets.category as MarketAsset['facets']['category'],
      lane: record.facets.lane as MarketAsset['facets']['lane'],
      mode: record.facets.mode as MarketAsset['facets']['mode'],
      tags: [...record.facets.tags],
      scenes: [...record.facets.scenes],
    },
    quality: record.quality,
    installGate: composeInstallGate(record),
    digest: record.digest,
    // v1 恒 null（向量检索圈外，§1.2/§9）
    embeddingRef: null,
    // 首版遥测仅本地且未回流：全 0/空（§1.2/§8.3）
    metrics: record.metrics ?? { installs: 0, adoptions: 0, favorites: 0, lastUsedAt: null },
    yanked: record.yanked ?? null,
  };
  if (record.description !== undefined) asset.description = record.description;
  if (typeof record.version === 'string') asset.version = record.version;
  return asset;
}

/**
 * 产出市场索引：blocked 过滤 → 按 id 升序（确定性）→ counts 统计 → 顶层元数据。
 *
 * 规格依据：§1.1（`assets` 不含 blocked；counts = total/byKind/loadable）、§4.3（幂等与可复现）。
 */
export function buildMarketplaceIndex(
  records: readonly DwsAssetRecord[],
  options: MarketplaceBuildOptions,
): MarketplaceIndex {
  const assets = records
    .map(toMarketAsset)
    .filter((asset) => asset.installGate.mode !== 'blocked')
    // 字典序（UTF-16 码元序）——跨平台一致；不用 localeCompare（依赖 locale 环境）
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const byKind = { skill: 0, plugin: 0, 'design-system': 0, template: 0 };
  let loadable = 0;
  for (const asset of assets) {
    byKind[asset.kind] += 1;
    if (asset.installGate.mode === 'loadable') loadable += 1;
  }

  return {
    schema: MARKETPLACE_INDEX_SCHEMA,
    generatedAt: options.generatedAt,
    collector: options.collector,
    counts: { total: assets.length, byKind, loadable },
    assets,
  };
}
