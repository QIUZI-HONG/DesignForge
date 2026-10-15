/**
 * 汇总层 · 五维合成与 DWS 记录（MK-03；规格 §5.1 总分口径）。
 *
 * 口径：
 *   - 每维 [0,1]；`score = Σ(权重 × 维度分)`，**两位小数**（规格 §5.1）——但本记录里的
 *     总分是排序键（卡片展示以雷达 + 徽标为主，规格 §5.1「总分不单独展示」是 UI 约束）；
 *   - 维度为 null（空心：无信号）时**按可用权重重归一化**——这正是规格 §5.4 的
 *     冷启动托底实现：零采纳资产不因生态热度为空而挨一记 0 分；
 *   - `confidence`：规格 §5.4——合规样本（无 frontmatter 等）`low`；`deferred`（未全量校验）
 *     亦如实降置信，不假装 high。
 */

import { scoreDocs } from './dim-docs.ts';
import type { EcosystemContext } from './dim-ecosystem.ts';
import { isColdStart, scoreEcosystem } from './dim-ecosystem.ts';
import { scoreMaintenance } from './dim-maintenance.ts';
import { scoreSecurity } from './dim-security.ts';
import { scoreSpec } from './dim-spec.ts';
import {
  type AssetQualityRecord,
  DIM_WEIGHTS,
  DIMENSIONS,
  type DimensionResult,
  type DimKey,
  DWS_QUALITY_SCHEMA,
  type DwdAsset,
  ROUND_TOTAL_DIGITS,
  type ScoreBatchOptions,
} from './types.ts';
import { roundTo } from './util.ts';

/** 单资产评分：五维 → DWS `asset_quality` 记录。 */
export function scoreAsset(
  input: DwdAsset,
  ctx: EcosystemContext,
  options: ScoreBatchOptions,
): AssetQualityRecord {
  const { asOf } = options;
  const results: Record<DimKey, DimensionResult> = {
    spec: scoreSpec(input),
    maintenance: scoreMaintenance(input, asOf),
    docs: scoreDocs(input),
    security: scoreSecurity(input),
    ecosystem: scoreEcosystem(input, ctx, asOf),
  };

  const dims = {} as Record<DimKey, number | null>;
  let weighted = 0;
  let availableWeight = 0;
  for (const key of DIMENSIONS) {
    const dimScore = results[key].score;
    dims[key] = dimScore;
    if (dimScore !== null) {
      weighted += DIM_WEIGHTS[key] * dimScore;
      availableWeight += DIM_WEIGHTS[key];
    }
  }
  const score =
    availableWeight > 0 ? roundTo(weighted / availableWeight, ROUND_TOTAL_DIGITS) : null;

  return {
    schema: DWS_QUALITY_SCHEMA,
    assetId: input.asset.id,
    kind: input.asset.kind,
    asOf,
    score,
    confidence: input.asset.compliance === 'ok' ? 'high' : 'low',
    flags: {
      archived: input.repo.archived,
      coldStart: isColdStart(input, asOf),
      nonCompliant: input.asset.compliance === 'non-compliant',
      filesTruncated: input.files.truncated,
    },
    dims,
    explain: {
      spec: { signals: results.spec.signals, deductions: results.spec.deductions },
      maintenance: {
        signals: results.maintenance.signals,
        deductions: results.maintenance.deductions,
      },
      docs: { signals: results.docs.signals, deductions: results.docs.deductions },
      security: { signals: results.security.signals, deductions: results.security.deductions },
      ecosystem: { signals: results.ecosystem.signals, deductions: results.ecosystem.deductions },
    },
  };
}
