/**
 * 选择层公开面：选择模型（UI 态的数据形状）+ 派生几何/对齐/分布计算。
 */

export type { AlignOp, AlignOptions, AlignRelativeTo, DistributeOp } from './align';
export {
  alignAvailability,
  alignCommands,
  alignDelta,
  alignReference,
  distributeCommands,
} from './align';
export type { Selection } from './selection';
export {
  addToSelection,
  clearSelection,
  clickSelection,
  commonParentId,
  commonValue,
  createSelection,
  EMPTY_SELECTION,
  hasMixedValue,
  isMultiSelection,
  isSelected,
  normalizeNodeSelection,
  removeFromSelection,
  selectionBounds,
  selectionKinds,
  selectionNodes,
  selectionSize,
  selectOnly,
  setSelection,
  toggleSelection,
} from './selection';
