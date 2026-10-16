/**
 * 时间计算（MK-03；纯函数，禁时钟依赖）。
 *
 * 纪律：评分器不读系统时钟（规格 §4.3.2「去时钟依赖」）——一切时间差都以
 * 批次注入的 `asOf` 为基准；本模块只做两时刻之间的确定性换算。
 */

/** 一天的毫秒数。 */
export const DAY_MS = 86_400_000;

/**
 * 两时刻相差的天数（向下取整；`to` 早于 `from` 时为负）。
 * 任一时刻不可解析 → null（= 无数据）：评分侧按「信号不可得」处理（不参与加权、不扣分）——
 * NaN 不得泄漏进信号观测值与扣分理由文本（JSONL 落盘会静默变 null，语义漂移）。
 */
export function daysBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.floor((to - from) / DAY_MS);
}

/** `iso` 距 `asOf` 是否不超过 `days` 天（含等号；未来时刻视为不超过；不可解析 = false）。 */
export function isWithinDays(iso: string, asOf: string, days: number): boolean {
  const age = daysBetween(iso, asOf);
  return age !== null && age <= days;
}
