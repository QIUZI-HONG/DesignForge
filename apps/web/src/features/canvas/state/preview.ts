/**
 * 交互预览补丁（拖动/缩放/旋转的「所见即所得」）。
 *
 * 关键取舍：预览**不重写第二套变换数学**——直接把当前交互状态喂给引擎的
 * `commitInteraction`，取它将要产出的命令翻译成 `NodePatch` 覆盖表，
 * 渲染层按补丁画节点。这样「松手后的结果」与「拖动时看到的」由同一份代码保证一致，
 * 也不会出现「预览与提交漂移」这类只有人眼能发现的缺陷。
 *
 * 纯函数：无副作用、不写文档、不碰 Skia。
 */

import type { NodeId, NodePatch, ScenePage } from '@dforge/engine';
import {
  commitInteraction,
  type InteractionContext,
  type InteractionState,
  marqueeRect,
} from '@dforge/engine';

/** 预览补丁表（节点 → 覆盖属性）。 */
export type PreviewPatches = ReadonlyMap<NodeId, NodePatch>;

/** 空补丁表（复用同一实例，避免空帧分配）。 */
export const EMPTY_PREVIEW: PreviewPatches = new Map();

/** 由交互状态推导预览补丁。 */
export function previewPatchesOf(
  state: InteractionState,
  context: InteractionContext,
): PreviewPatches {
  if (state.kind === 'idle' || state.kind === 'pan' || state.kind === 'marquee')
    return EMPTY_PREVIEW;
  const { commands } = commitInteraction(state, context);
  if (commands.length === 0) return EMPTY_PREVIEW;
  const patches = new Map<NodeId, NodePatch>();
  for (const command of commands) {
    if (command.type === 'node.update') {
      patches.set(command.nodeId, { ...(patches.get(command.nodeId) ?? {}), ...command.patch });
      continue;
    }
    if (command.type === 'node.move') {
      // node.move 的 dx/dy 位于节点父坐标系：换算成 x/y 补丁（渲染层只认绝对几何）
      const node = context.page.nodes[command.nodeIds[0] as NodeId];
      if (node === undefined) continue;
      patches.set(node.id, {
        ...(patches.get(node.id) ?? {}),
        x: node.x + command.dx,
        y: node.y + command.dy,
      });
    }
  }
  return patches;
}

/** 框选时的预览矩形（世界坐标；非框选态为 null）。 */
export function marqueePreview(state: InteractionState) {
  return state.kind === 'marquee' ? marqueeRect(state) : null;
}

/** 交互中的吸附数据（只有移动态有）。 */
export function snapPreviewOf(state: InteractionState) {
  return state.kind === 'move' &&
    (state.snap.dx !== 0 || state.snap.dy !== 0 || state.snap.guides.length > 0)
    ? state.snap
    : null;
}

/** 预览补丁命中的节点 id 集合（HUD/统计用）。 */
export function previewNodeIds(patches: PreviewPatches): NodeId[] {
  return [...patches.keys()];
}

/** 页面是否存在该节点（预览补丁写入前的护栏）。 */
export function hasNode(page: ScenePage, id: NodeId): boolean {
  return Object.hasOwn(page.nodes, id);
}
