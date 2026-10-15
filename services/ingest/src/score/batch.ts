/**
 * 批处理 · DWS 层产出（MK-03）。
 *
 * `scoreBatch` = 评分器唯一批量入口：先按整批构建生态热度的分位语境
 * （规格 §5.2 防马太口径），再逐资产五维评分。**确定性**要求（规格 §4.3.2）：
 *   - 无时钟依赖（`asOf` 注入）· 无随机数 · 分位只依赖取值集合（与输入顺序无关）；
 *   - 同输入 → 逐字节同输出（有快照测试守住）。
 */

import { scoreAsset } from './aggregate.ts';
import { buildEcosystemContext } from './dim-ecosystem.ts';
import type { DwdAsset, ScoreBatchOptions, ScoreBatchResult } from './types.ts';

/** 批量评分：整批一次构建分位语境，逐资产产出 `asset_quality` 记录。 */
export function scoreBatch(
  inputs: readonly DwdAsset[],
  options: ScoreBatchOptions,
): ScoreBatchResult {
  const ctx = buildEcosystemContext(inputs, options.asOf);
  const records = inputs.map((input) => scoreAsset(input, ctx, options));
  return {
    records,
    summary: {
      total: records.length,
      coldStart: records.filter((r) => r.flags.coldStart).length,
      archived: records.filter((r) => r.flags.archived).length,
      nonCompliant: records.filter((r) => r.flags.nonCompliant).length,
      fullyScored: records.filter((r) => Object.values(r.dims).every((d) => d !== null)).length,
    },
  };
}
