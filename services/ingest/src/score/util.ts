/**
 * 评分汇总工具（MK-03；纯函数，无副作用）。
 *
 * 职责：把「信号 → 维度分」的公共记账逻辑收在一处——
 * 加权归一化（不可得信号不参与）、扣分尘埃过滤、定点舍入、扣分排序。
 * 各维度模块只负责产出 `signals` 与 `deductions`，汇总口径不重复实现。
 */

import type { Deduction, SignalDetail } from './types.ts';
import { DEDUCTION_DUST, ROUND_DIM_DIGITS } from './types.ts';

/** 定点舍入（十进位；先放大再 Math.round，规避浮点噪声进快照）。 */
export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 收敛到 [0,1]。 */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * 信号加权均值（**未舍入**）：只计 `score !== null` 的信号并按有效权重归一化；
 * 全部不可得 → null（该维空心，规格 §5.3「雷达数据点在无信号时显示为空心」）。
 */
export function weightedMean(signals: readonly SignalDetail[]): number | null {
  const available = signals.filter((s) => s.score !== null);
  if (available.length === 0) return null;
  const totalWeight = available.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight <= 0) return null;
  const weighted = available.reduce((sum, s) => sum + s.weight * (s.score as number), 0);
  return weighted / totalWeight;
}

/** 维度分定型：clamp + 定点舍入（null 原样透传）。 */
export function finalizeScore(raw: number | null): number | null {
  return raw === null ? null : roundTo(clamp01(raw), ROUND_DIM_DIGITS);
}

/**
 * 构造一条扣分记录；`delta` 低于尘埃阈值（0.005）返回 null（调用方过滤）。
 * 记账口径：`delta` = 该信号在维度内的权重 ×（1 − 子分），即这一笔扣掉的维度分。
 */
export function makeDeduction(code: string, reason: string, delta: number): Deduction | null {
  if (delta < DEDUCTION_DUST) return null;
  return { code, reason, delta: roundTo(delta, ROUND_DIM_DIGITS) };
}

/** 扣分排序：delta 降序，同值按码升序（确定性快照依赖）。 */
export function sortDeductions(deductions: readonly Deduction[]): Deduction[] {
  return [...deductions].sort((a, b) => {
    if (b.delta !== a.delta) return b.delta - a.delta;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
}

/**
 * 信号在本维度内的**归一化权重**：分母 = 可算信号（score ≠ null）权重之和。
 * 这样 `归一化权重 × (1 − 子分)` 恰是这一笔扣掉的维度分，Σ扣分 = 1 − 维度分。
 */
export function normalizedWeight(signals: readonly SignalDetail[], code: string): number {
  const total = signals.reduce((sum, s) => sum + (s.score === null ? 0 : s.weight), 0);
  const own = signals.find((s) => s.code === code);
  if (own === undefined || own.score === null || total <= 0) return 0;
  return own.weight / total;
}

/** 过滤空扣分并排序（各维度收尾统一走这里）。 */
export function collectDeductions(items: readonly (Deduction | null)[]): Deduction[] {
  return sortDeductions(items.filter((d): d is Deduction => d !== null));
}
