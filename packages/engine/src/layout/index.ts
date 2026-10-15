/**
 * 布局层公开面：自动布局子集（轴向堆叠/间距/内边距/对齐/尺寸模式）。
 */

export type { LayoutChild, LayoutResult } from './auto-layout';
export {
  autoLayoutCommands,
  autoLayoutOf,
  canAutoLayout,
  hugDirections,
  initialLayoutSize,
  layoutInputs,
  solveAutoLayout,
} from './auto-layout';
