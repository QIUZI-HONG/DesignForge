/**
 * 自动布局配置（Inspector「布局」分区 / `layout/` 算法的输入形状）。
 *
 * 类型归 model（属 Design IR 的节点属性），求解算法归 `layout/`。
 * P0 子集：轴向堆叠 + 间距 + 内边距 + 主轴对齐 + 交叉轴对齐 + 尺寸模式（固定/包裹/填充）。
 */

/** 主轴方向。 */
export type AutoLayoutDirection = 'horizontal' | 'vertical';

/** 交叉轴对齐（start/center/end/stretch）。 */
export type LayoutAlign = 'start' | 'center' | 'end' | 'stretch';

/** 主轴对齐。 */
export type LayoutJustify = 'start' | 'center' | 'end';

/** 尺寸模式：固定（fixed）/ 包裹内容（hug）/ 填充父容器（fill）。 */
export type LayoutSizing = 'fixed' | 'hug' | 'fill';

/** 内边距（四向）。 */
export interface LayoutPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 自动布局配置。 */
export interface AutoLayoutConfig {
  direction: AutoLayoutDirection;
  /** 主轴项间距。 */
  spacing: number;
  padding: LayoutPadding;
  primaryAxisAlign: LayoutJustify;
  counterAxisAlign: LayoutAlign;
  /** 换行（P0 仅 horizontal 支持；vertical 一律视为不换行）。 */
  wrap: boolean;
  /** 包裹时行距。 */
  counterAxisSpacing: number;
  /** 容器自身尺寸模式。 */
  widthSizing: LayoutSizing;
  heightSizing: LayoutSizing;
}

/** 默认自动布局（Figma 新建自动布局的近似值：垂直、间距 10、内边距 10）。 */
export function defaultAutoLayout(direction: AutoLayoutDirection = 'vertical'): AutoLayoutConfig {
  return {
    direction,
    spacing: 10,
    padding: { top: 10, right: 10, bottom: 10, left: 10 },
    primaryAxisAlign: 'start',
    counterAxisAlign: 'start',
    wrap: false,
    counterAxisSpacing: 10,
    widthSizing: 'fixed',
    heightSizing: 'hug',
  };
}

/** 内边距的简写构造。 */
export function padding(all: number): LayoutPadding {
  return { top: all, right: all, bottom: all, left: all };
}

/** 主轴已用长度（内边距 + 所有项 + 间距），不含交叉轴。 */
export function paddingAlongAxis(pad: LayoutPadding, direction: AutoLayoutDirection): number {
  return direction === 'horizontal' ? pad.left + pad.right : pad.top + pad.bottom;
}
