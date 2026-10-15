/**
 * 页面网格设置（C7 空选态「画布设置」）。
 *
 * 网格是文档数据（随文档保存、可 Git diff），视口缩放不改变网格的世界单位尺寸。
 */

/** 网格样式（C8：网格/标尺/参考线）。 */
export type GridStyle = 'lines' | 'grid' | 'dots';

/** 网格设置。 */
export interface GridSettings {
  /** 网格边长（世界单位 px）。 */
  size: number;
  visible: boolean;
  /** 是否参与吸附（C8「网格吸附」）。 */
  snapToGrid: boolean;
  style: GridStyle;
}

/** 默认网格（10px 细网格，默认不显示）。 */
export function defaultGridSettings(): GridSettings {
  return { size: 10, visible: false, snapToGrid: false, style: 'grid' };
}
