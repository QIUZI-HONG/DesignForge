/**
 * 几何原语类型。
 *
 * 约定：世界坐标系为「页面坐标」（y 轴向下，与 Canvas/DOM 一致）；
 * 角度一律为**度**、顺时针为正（屏幕坐标下与视觉一致）。
 */

/** 点。 */
export interface Point {
  x: number;
  y: number;
}

/** 轴对齐矩形（x/y 为左上角；width/height 可正可负，必要时用 `normalizeRect` 归正）。 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 2D 仿射矩阵（列主序，与 Canvas 的 `setTransform` 相同）：
 * `x' = a·x + c·y + e`，`y' = b·x + d·y + f`。
 */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** 尺寸。 */
export interface Size {
  width: number;
  height: number;
}
