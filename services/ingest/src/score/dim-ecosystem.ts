/**
 * 维度五 · 生态热度 `ecosystem`（权重 .15，规格 §5.1/§5.2）。
 *
 * 信号与子权（维度内归一化，和 = 1.00）：
 *   ecosystem.stars-growth  .45  星标增速的**批内分位**（无历史星标 → 不可得）
 *   ecosystem.forks         .20  fork 数的批内分位
 *   ecosystem.referenced    .35  被引用数（被其他仓引用/同源落点数）的批内分位
 *
 * **防马太（规格 §5.2 明示）**：本维不使用绝对星标数进分值——星标只作增速的基数
 * 与僵尸仓判定（M2）输入；三个信号都取「批内分位」（口径见 `percentile.ts`）。
 * 分位语境 = 批内**非冷启动**资产（零采纳样本不是「0 分数据点」，不参与分布）。
 *
 * 冷启动托底（规格 §5.4）：新资产（<90 天）或零采纳（无星无 fork 无引用）→
 * 本维整体置空（null = 雷达空心），**由总分重归一化实现「spec + maintenance 托底」**：
 * 不给零采纳记 0 分，也不让它永远垫底。观测值照留在信号里（可解释）。
 */

import { REASON_TEXT } from './codes.ts';
import { batchPercentile, starsGrowthRate } from './percentile.ts';
import { daysBetween } from './time.ts';
import type { DimensionResult, DwdAsset, SignalDetail } from './types.ts';
import {
  collectDeductions,
  finalizeScore,
  makeDeduction,
  normalizedWeight,
  roundTo,
  weightedMean,
} from './util.ts';

/** 冷启动判定线（规格 §5.4：新资产 <90 天）。 */
export const COLD_START_DAYS = 90;

/** 批内分位语境（同轴取值集合；由 `buildEcosystemContext` 从整批构建）。 */
export interface EcosystemContext {
  /** 星标增速取值（非冷启动且历史星标可得者）。 */
  starsGrowth: readonly number[];
  /** fork 数取值（非冷启动者）。 */
  forks: readonly number[];
  /** 被引用数取值（非冷启动且数据可得者）。 */
  referenced: readonly number[];
}

/** 冷启动判定（规格 §5.4：<90 天或零采纳）。 */
export function isColdStart(input: DwdAsset, asOf: string): boolean {
  const ageDays = daysBetween(input.repo.createdAt, asOf);
  const zeroAdoption =
    input.repo.stars === 0 && input.repo.forks === 0 && (input.trend.referencedBy ?? 0) === 0;
  return ageDays < COLD_START_DAYS || zeroAdoption;
}

/** 从整批构建分位语境（排除冷启动资产；批量与顺序无关 → 确定性）。 */
export function buildEcosystemContext(inputs: readonly DwdAsset[], asOf: string): EcosystemContext {
  const warm = inputs.filter((input) => !isColdStart(input, asOf));
  return {
    starsGrowth: warm
      .filter((input) => input.trend.stars90dAgo !== null)
      .map((input) => starsGrowthRate(input.repo.stars, input.trend.stars90dAgo as number)),
    forks: warm.map((input) => input.repo.forks),
    referenced: warm
      .filter((input) => input.trend.referencedBy !== null)
      .map((input) => input.trend.referencedBy as number),
  };
}

/** 生态热度评分。 */
export function scoreEcosystem(
  input: DwdAsset,
  ctx: EcosystemContext,
  asOf: string,
): DimensionResult {
  const coldStart = isColdStart(input, asOf);
  const prevStars = input.trend.stars90dAgo;
  const growth = prevStars === null ? null : starsGrowthRate(input.repo.stars, prevStars);
  const growthPercentile = growth === null ? null : batchPercentile(growth, ctx.starsGrowth);
  const forkPercentile = batchPercentile(input.repo.forks, ctx.forks);
  const referenced = input.trend.referencedBy;
  const referencedPercentile =
    referenced === null ? null : batchPercentile(referenced, ctx.referenced);

  // 冷启动：本维整体置空（观测照留，供可解释展示）；分位在原始值上计算，展示值才舍入。
  const scoreOf = (raw: number | null): number | null => (coldStart ? null : raw);

  const signals: SignalDetail[] = [
    {
      code: 'ecosystem.stars-growth',
      value: growth === null ? null : roundTo(growth, 4),
      weight: 0.45,
      score: scoreOf(growthPercentile),
    },
    {
      code: 'ecosystem.forks',
      value: input.repo.forks,
      weight: 0.2,
      score: scoreOf(forkPercentile),
    },
    {
      code: 'ecosystem.referenced',
      value: referenced,
      weight: 0.35,
      score: scoreOf(referencedPercentile),
    },
  ];

  const byCode = new Map(signals.map((s) => [s.code, s]));

  /** 按信号当前子分记一笔扣分（理由带上分位与观测值）。 */
  const deduct = (signalCode: string, reasonCode: string, describe: () => string) => {
    const s = byCode.get(signalCode);
    if (s === undefined || s.score === null || s.score >= 1) return null;
    return makeDeduction(
      reasonCode,
      `${describe()}（批内分位 ${roundTo(s.score, 2)}）`,
      normalizedWeight(signals, signalCode) * (1 - s.score),
    );
  };

  const deductions = collectDeductions([
    deduct(
      'ecosystem.stars-growth',
      'E1',
      () => `${REASON_TEXT.E1}（增速 ${byCode.get('ecosystem.stars-growth')?.value ?? '—'}）`,
    ),
    deduct('ecosystem.forks', 'E2', () => `${REASON_TEXT.E2}（fork ${input.repo.forks}）`),
    deduct('ecosystem.referenced', 'E3', () => `${REASON_TEXT.E3}（被引用 ${referenced ?? '—'}）`),
  ]);

  return { score: finalizeScore(weightedMean(signals)), signals, deductions };
}
