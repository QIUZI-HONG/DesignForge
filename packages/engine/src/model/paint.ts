/**
 * 绘制属性（填充/描边/效果）——Design IR 的「外观」分区。
 *
 * P0 子集：纯色填充与线性渐变、描边、三种效果（投影/内阴影/层模糊）。
 * 颜色一律为 `#RRGGBB` 或 `#RRGGBBAA` 字符串：文档真值不引用 UI 令牌
 * （令牌是设计资产，节点引用令牌由 `tokens/` 解析，最终落到这里的字面值）。
 */

/** 颜色字面量（`#RRGGBB` / `#RRGGBBAA`）。 */
export type ColorLiteral = string;

/** 渐变停靠点：位置 0–1。 */
export interface GradientStop {
  position: number;
  color: ColorLiteral;
}

/** 纯色填充。 */
export interface SolidPaint {
  type: 'solid';
  color: ColorLiteral;
  /** 独立于节点 opacity 的填充透明度（0–1）。 */
  opacity: number;
  visible: boolean;
}

/** 线性渐变填充（起点/终点为 0–1 归一化坐标）。 */
export interface LinearGradientPaint {
  type: 'linear_gradient';
  stops: readonly GradientStop[];
  start: { x: number; y: number };
  end: { x: number; y: number };
  opacity: number;
  visible: boolean;
}

/** 填充/描边画刷。 */
export type Paint = SolidPaint | LinearGradientPaint;

/** 描边（画刷 + 宽度 + 对齐方式）。 */
export interface Stroke {
  paint: Paint;
  width: number;
  align: 'inside' | 'center' | 'outside';
}

/** 效果（外观分区「高级」）。 */
export interface Effect {
  type: 'drop_shadow' | 'inner_shadow' | 'layer_blur';
  color: ColorLiteral;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  visible: boolean;
}

/** 构造纯色填充。 */
export function solidPaint(color: ColorLiteral, opacity = 1): SolidPaint {
  return { type: 'solid', color, opacity, visible: true };
}

/** 构造描边。 */
export function strokeOf(paint: Paint, width = 1, align: Stroke['align'] = 'inside'): Stroke {
  return { paint, width, align };
}

/** 构造投影。 */
export function dropShadow(
  color: ColorLiteral,
  offsetX: number,
  offsetY: number,
  blur: number,
  spread = 0,
): Effect {
  return { type: 'drop_shadow', color, offsetX, offsetY, blur, spread, visible: true };
}

/** 填充是否为「可见且非全透明」——命中测试与渲染都关心。 */
export function isPaintVisible(paint: Paint): boolean {
  return paint.visible && paint.opacity > 0;
}

/** 取填充的可比色值（渐变取首停靠点），供序列化与差异比较。 */
export function paintKeyColor(paint: Paint): ColorLiteral {
  return paint.type === 'solid' ? paint.color : (paint.stops[0]?.color ?? '#00000000');
}
