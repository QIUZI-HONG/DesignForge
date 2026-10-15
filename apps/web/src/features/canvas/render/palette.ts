/**
 * 画布配色（渲染层唯一取色处）：一律从 `@dforge/ui` 双基准令牌派生。
 *
 * 为什么不让渲染函数直接写颜色：令牌是设计资产，主题切换（浅色首页族 / 深色编辑器族）
 * 必须一处生效；`scripts/guard-tokens.mjs` 也以此为准绳检查「禁裸值」。
 *
 * 透明度调制（悬停、框选填充、选中底）是对**令牌色**的 alpha 乘算，
 * 不是新颜色——常量在此集中声明，便于对齐 Figma 视觉权重。
 */

import { PRIMITIVES, type ThemeName, themeOf } from '@dforge/ui';

/** alpha 调制常量（几何/权重参数，非设计令牌）。 */
export const CANVAS_ALPHA = {
  /** 悬停描边（比选中更轻）。 */
  hover: 0.6,
  /** 框选/选中底的填充。 */
  fill: 0.08,
  /** 手柄在深/浅底上的描边。 */
  handleBorder: 0.9,
} as const;

/** 画布配色（字段语义固定；值来自令牌）。 */
export interface CanvasPalette {
  /** 画布底（深色基准 canvas 令牌）。 */
  background: string;
  gridLine: string;
  gridDot: string;
  /** 标尺底/文字/刻度/选中区间标记。 */
  rulerBackground: string;
  rulerText: string;
  rulerTick: string;
  rulerMarker: string;
  /** 选中描边（主色令牌）。 */
  selectionOutline: string;
  selectionFill: string;
  hoverOutline: string;
  /** 8 手柄：白/面板底 + 主色描边。 */
  handleFill: string;
  handleBorder: string;
  /** 吸附参考线（红）。 */
  snapGuide: string;
  /** 测量线（红）与标注底/字。 */
  measureLine: string;
  measureLabelBackground: string;
  measureLabelText: string;
  /** 框选（矩形选择）描边与填充。 */
  marqueeStroke: string;
  marqueeFill: string;
  /** 标签（图层名/尺寸）底色与文字。 */
  labelBackground: string;
  labelText: string;
  /** 无填充文本节点的默认文字色（主题正文色）。 */
  textDefault: string;
  /** 网格 dots 的直径（屏幕 px，几何参数）。 */
  gridDotSize: number;
  /** 字号：标尺 / 标签（走令牌字号档）。 */
  fontSize: { ruler: number; label: number };
}

/**
 * 由主题名派生画布配色。
 * 深色主题给编辑器（UI3 基准）；浅色主题给首页族里的画布预览。
 */
export function canvasPalette(theme: ThemeName): CanvasPalette {
  const colors = themeOf(theme).colors;
  const fontSize11 = PRIMITIVES.fontSize[11];
  const borderWidth1 = PRIMITIVES.borderWidth.hairline;
  return {
    background: colors.canvas,
    gridLine: colors.border,
    gridDot: colors.borderStrong,
    rulerBackground: colors.surface,
    rulerText: colors.text.secondary,
    rulerTick: colors.borderStrong,
    rulerMarker: colors.primary,
    selectionOutline: colors.primary,
    selectionFill: colors.selection,
    hoverOutline: colors.primary,
    handleFill: colors.surface,
    handleBorder: colors.primary,
    snapGuide: colors.danger,
    measureLine: colors.danger,
    measureLabelBackground: colors.danger,
    measureLabelText: colors.onDanger,
    marqueeStroke: colors.primary,
    marqueeFill: colors.selection,
    labelBackground: colors.primary,
    labelText: colors.onPrimary,
    textDefault: colors.text.primary,
    gridDotSize: borderWidth1 * 2,
    fontSize: { ruler: fontSize11, label: fontSize11 },
  };
}
