/**
 * 吸附层公开面：阈值（6px 屏幕空间）、对齐参考线、测量数据、网格吸附。
 */

export type {
  Measurement,
  SnapGuide,
  SnapOptions,
  SnapResult,
  SnapTarget,
} from './snap';
export {
  computeMeasurements,
  computeSnap,
  isCenterAligned,
  NO_SNAP,
  SNAP_THRESHOLD_PX,
  snapPointToGrid,
  snapRectToGrid,
  snapTargetsFromBounds,
  snapTargetsFromPage,
  snapThresholdWorld,
  snapValueToGrid,
} from './snap';
