/**
 * 批内分位与星标增速（MK-03；生态热度防马太口径）。
 *
 * 规格依据：《技能市场规格 v1》§5.2「生态热度」——星标 + **星标增速** · fork 数 ·
 * 被引用数；**防马太：用增速与分位，不用绝对星标排名**（v1.1 §4.4.3 明示）。
 * 本模块提供两件纯函数：分位与增速；绝对星标值只用于增速/僵尸仓判定，**不进分值**。
 */

/** 分位取值（口径写死于此，改则同步改测试与报告）。 */
export const PERCENTILE_RULE =
  '批内分位 p = 批内 ≤ 本值的样本占比；最高值 1.00，并列同分位，全员并列 → 全员 1.00';

/**
 * 批内分位：`p = #{v' ≤ v} / n`。
 * @param value 本资产取值（须已包含在 `values` 中，分位才自洽）
 * @param values 批内同轴取值（空批 → null = 无信号）
 */
export function batchPercentile(value: number, values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let notAbove = 0;
  for (const v of values) {
    if (v <= value) notAbove += 1;
  }
  return notAbove / values.length;
}

/**
 * 星标增速 =（现值 − 上期）/ max(上期, 1)。
 * 上期为 0 时以 1 为分母：新仓暴增不至于无穷，也不会把老仓的绝对星数优势带进来。
 */
export function starsGrowthRate(stars: number, stars90dAgo: number): number {
  return (stars - stars90dAgo) / Math.max(stars90dAgo, 1);
}
