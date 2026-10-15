/**
 * 渲染帧输入（渲染层与状态层的契约）。
 *
 * 约定（`_shared.md` §3 状态边界）：渲染**只消费**引擎状态——
 * 文档是 `CommandStack` 的快照，视口/选择/交互由画布会话提供；
 * 渲染层不持有状态、不写文档、不做命中测试。
 */

import type {
  InteractionState,
  NodeId,
  NodePatch,
  Rect,
  ScenePage,
  Size,
  Viewport,
} from '@dforge/engine';

import type { CanvasPalette } from './palette';

/** 尺度信息（DPR 感知：backing store = CSS 尺寸 × dpr）。 */
export interface FrameScale {
  /** CSS 像素尺寸。 */
  size: Size;
  /** 设备像素比（本机基准 1.5）。 */
  dpr: number;
}

/** 一帧的完整输入。 */
export interface SceneFrame {
  page: ScenePage;
  palette: CanvasPalette;
  viewport: Viewport;
  scale: FrameScale;
  /** 选中集（顺序 = 用户选择顺序）。 */
  selection: readonly NodeId[];
  /** 悬停高亮的节点（无 → null）。 */
  hoverId: NodeId | null;
  /** 当前交互状态（用于绘制框选/缩放预览与测量）。 */
  interaction: InteractionState;
  /** 交互预览补丁（由引擎的 commit 语义提前算出，见 state/preview.ts）。 */
  preview: ReadonlyMap<NodeId, NodePatch>;
  /** 框选矩形（世界坐标；非框选态为 null）。 */
  marquee: Rect | null;
  /** 是否绘制标尺。 */
  rulers: boolean;
  /** 正在做 DOM 覆盖层编辑的文本节点（画布上跳过其字形，避免重影）。 */
  editingNodeId: NodeId | null;
}

/** 8 手柄 + 选择框的绘制数据（渲染与命中测试共用同一份，见 input/handle-hit.ts）。 */
export interface SelectionFrame {
  /** 世界 AABB（旋转节点的 AABB）。 */
  bounds: Rect;
  /** 手柄框的旋转角（度）：单选取节点局部旋转，多选取 0（与引擎一致）。 */
  rotation: number;
  ids: readonly NodeId[];
}
