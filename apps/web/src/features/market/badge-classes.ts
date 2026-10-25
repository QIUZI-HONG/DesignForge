/**
 * 徽标/进度条色调 → 修饰类名（工单 06 · 样式单轨）。
 *
 * 原按 tone 拼 `badgeStyle(tone)` / `meterFillStyle(tone)` 内联对象；色调语义收敛到
 * `market.css` 的修饰档（`--ok/--warn/--danger`），本模块只做 tone → 类名的纯映射
 * （基座类承载排版，色调档只覆盖 color/background-color）。
 */

/** 徽标色调档（neutral = 次级前景，与基座同色）。 */
export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger';

/** 徽标类名（neutral 即基座，不加修饰档）。 */
export function badgeClassName(tone: BadgeTone): string {
  return tone === 'neutral' ? 'dfg-market__badge' : `dfg-market__badge dfg-market__badge--${tone}`;
}

/** 进度条填充类名（primary 即基座主色）。 */
export function meterFillClassName(tone: 'primary' | 'warn' | 'danger'): string {
  return tone === 'primary'
    ? 'dfg-market__meter-fill'
    : `dfg-market__meter-fill dfg-market__meter-fill--${tone}`;
}
