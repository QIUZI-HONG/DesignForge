/**
 * 时间计算（MK-03；纯函数，禁时钟依赖）。
 *
 * 纪律：评分器不读系统时钟（规格 §4.3.2「去时钟依赖」）——一切时间差都以
 * 批次注入的 `asOf` 为基准；本模块只做两时刻之间的确定性换算。
 */

/** 一天的毫秒数。 */
export const DAY_MS = 86_400_000;

/** 两时刻相差的天数（向下取整；`to` 早于 `from` 时为负）。 */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);
}

/** `iso` 距 `asOf` 是否不超过 `days` 天（含等号；未来时刻视为不超过）。 */
export function isWithinDays(iso: string, asOf: string, days: number): boolean {
  return daysBetween(iso, asOf) <= days;
}
