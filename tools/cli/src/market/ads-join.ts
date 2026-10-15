/**
 * DWS 联结行装配（DWD 资产行 × 评分行 × 分类面 → `ads.DwsAssetRecord`）。
 *
 * 这是判据链第 3→4 环的接缝（规格《市场首实现》§4）：评分产物（`asset_quality.jsonl`）
 * 与 DWD 资产行按 `assetId` 联结，再补上分类面（本票推导，`facets.ts`）与安全结论
 * （安全维扣分推导：有 X1/X2/X3 类扣分 → warn，否则 pass）。
 */

import type { ads, score } from '@dforge/ingest';
import type { JoinedAsset } from './dwd-map.ts';
import { deriveFacets } from './facets.ts';

/** 评分记录类型（由评分批次产物推导，不跨包引用内部路径）。 */
type AssetQualityRecord = ReturnType<typeof score.scoreBatch>['records'][number];

/** 安全结论推导：安全维有正扣分（X 码）→ `warn`；无信号/无扣分 → `pass`。 */
export function securityVerdict(record: AssetQualityRecord): 'pass' | 'warn' {
  const penalties = record.explain.security.deductions.filter(
    (deduction) => deduction.delta > 0 && deduction.code.startsWith('X'),
  );
  return penalties.length > 0 ? 'warn' : 'pass';
}

/** 单条联结：DWD 资产行 + 评分行 + 分类面 → ADS 输入契约。 */
export function buildDwsRecord(
  joined: JoinedAsset,
  quality: AssetQualityRecord,
): ads.DwsAssetRecord {
  const { asset, repo, license } = joined;
  const rawTexts = asset as unknown as Record<string, unknown>;
  const description =
    typeof rawTexts.text_body === 'string' && rawTexts.text_body !== ''
      ? (rawTexts.text_body as string)
      : typeof rawTexts.text_readme === 'string' && rawTexts.text_readme !== ''
        ? (rawTexts.text_readme as string)
        : undefined;

  const record: ads.DwsAssetRecord = {
    id: asset.asset_id,
    kind: asset.kind as ads.DwsAssetRecord['kind'],
    name: asset.name,
    displayName: { 'zh-CN': asset.display_name_zh_cn, en: asset.display_name_en },
    summary: { 'zh-CN': asset.summary_zh_cn, en: asset.summary_en },
    source: {
      repo: asset.repo_full_name,
      repoId: repo?.repo_id ?? asset.repo_id,
      path: asset.root,
      ref: asset.ref,
      fetchedAt: asset.fetched_at,
      license: {
        spdx: license?.spdx ?? null,
        gate: license?.gate ?? asset.license_gate,
        evidence: {
          path: license?.evidence_path ?? null,
          sha256: license?.evidence_sha256 ?? null,
        },
      },
      stars: repo?.stars ?? 0,
      pushedAt: repo?.pushed_at ?? '',
      archived: repo?.archived === true,
      homepage: repo?.homepage ?? null,
      upstream: repo?.upstream ?? null,
      brandDerived: asset.brand_derived === true,
    },
    capabilities: Array.isArray(asset.capabilities) ? [...asset.capabilities] : [],
    facets: deriveFacets(joined),
    quality: {
      score: quality.score ?? 0,
      dims: {
        spec: quality.dims.spec ?? 0,
        maintenance: quality.dims.maintenance ?? 0,
        docs: quality.dims.docs ?? 0,
        security: quality.dims.security ?? 0,
        ecosystem: quality.dims.ecosystem ?? 0,
      },
      explain: quality.explain as unknown as NonNullable<ads.DwsAssetRecord['quality']['explain']>,
    },
    security: securityVerdict(quality),
    reasons: [
      ...(license?.reasons ?? []).slice(),
      ...(quality.score === null ? ['无可算维度（全维空心，总分按 0 落卡片，规格 §5.3）'] : []),
      ...(quality.flags.coldStart ? ['冷启动资产（生态热度不参与总分，规格 §5.4）'] : []),
      ...(quality.flags.filesTruncated ? ['Trees 截断（文件清单可能不全，规格 §3.5）'] : []),
    ],
    digest: asset.digest ?? '',
  };

  const version = typeof asset.version === 'string' && asset.version !== '' ? asset.version : null;
  if (version !== null) record.version = version;
  if (description !== undefined) record.description = description;
  return record;
}
