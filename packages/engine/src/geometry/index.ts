/**
 * 几何层公开面：矩阵/包围盒（纯数学）+ 变换合成/手柄/命中测试（依赖场景只读遍历）。
 *
 * 依赖方向：`geometry → scene（只读查询）→ model`。几何层**不写文档**，
 * 写路径一律经 `commands/`（命令栈）。
 */

export {
  boundsCenter,
  boundsOfPoints,
  inflateRect,
  normalizeRect,
  pointOnSegment,
  quadBounds,
  quadContainsPoint,
  quadIntersectsRect,
  rectContainsPoint,
  rectContainsRect,
  rectCorners,
  rectIntersectsRect,
  rotatePointsAround,
  segmentsIntersect,
  translateRect,
  unionBounds,
} from './bounds';
export type { HandleId, ResizeOptions, RotatedBounds } from './handles';
export {
  alignLocalRectToWorldAnchor,
  boundsContainsPoint,
  CORNER_HANDLES,
  EDGE_HANDLES,
  HANDLE_IDS,
  handlePoint,
  hitTestHandle,
  isCornerHandle,
  normalizeAngle,
  oppositeHandle,
  resizeRect,
  resizeRotatedNode,
  rotatedHandlePoints,
  rotationDeltaDegrees,
  snapAngle,
} from './handles';
export type { HitOptions, HitResult, MarqueeMode, MarqueeOptions } from './hit-test';
export {
  clickSelectionTarget,
  findPath,
  hitTestAll,
  hitTestNode,
  hitTestPoint,
  marqueeSelect,
} from './hit-test';
export {
  applyToPoint,
  applyToVector,
  aroundPoint,
  decomposeRotation,
  distance,
  IDENTITY,
  identity,
  invert,
  isIdentity,
  midpoint,
  multiply,
  nearlyEqual,
  rotateVector,
  rotation,
  scaling,
  translation,
} from './matrix';
export {
  localBounds,
  localMatrix,
  localPointToWorld,
  nodeContainsLocalPoint,
  nodeQuadInRect,
  parentFrameRotation,
  parentWorldMatrix,
  worldBoundsOfNode,
  worldBoundsOfNodes,
  worldDeltaToLocal,
  worldMatrix,
  worldPointToLocal,
  worldQuad,
  worldRotation,
} from './transform';
export type { Matrix, Point, Rect, Size } from './types';
