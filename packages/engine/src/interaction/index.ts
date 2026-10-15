/**
 * 交互层公开面：视口（画布缩放/平移）、交互状态机（选择/移动/缩放/旋转/框选/吸附）、文本编辑会话。
 */

export type {
  CancelEvent,
  EditorTool,
  HandleMode,
  IdleInteraction,
  InteractionContext,
  InteractionEvent,
  InteractionState,
  MarqueeInteraction,
  Modifiers,
  MoveInteraction,
  PanInteraction,
  PointerDownEvent,
  PointerMoveEvent,
  PointerUpEvent,
  ResizeInteraction,
  RotateInteraction,
} from './reducer';
export {
  applySnapToMove,
  beginInteraction,
  beginRotate,
  cancelInteraction,
  commitInteraction,
  IDLE,
  marqueeRect,
  marqueeSelectionOf,
  movePreview,
  panDelta,
  rotatePreview,
  updateInteraction,
} from './reducer';
export type { TextEditSession } from './text-edit';
export {
  backspace,
  beginTextEdit,
  cancelTextEdit,
  commitTextEdit,
  deleteForward,
  insertText,
  patchTextContent,
  selectAllText,
  setTextSelection,
} from './text-edit';
export type { Viewport } from './viewport';
export {
  clampZoom,
  createViewport,
  fitBounds,
  isWorldPointVisible,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
  ZOOM_LEVELS,
  zoomAt,
  zoomByFactor,
  zoomByWheel,
  zoomPercent,
  zoomStep,
  zoomTo100,
} from './viewport';
