/**
 * 视口映射（世界坐标 ⇄ 屏幕坐标）——**渲染层与 DOM 覆盖层共用的唯一口径**。
 *
 * 为什么必须是共享纯函数：画布上的字形由 `draw-scene` 走 canvas 变换绘制（递归
 * `translate(x, y)` + 祖先链旋转），而文本内联编辑覆盖层是**绝对定位的 DOM**。
 * 两边各算一套换算必然会漂移（帧内文本用局部坐标当世界坐标 → 父级偏移/旋转全丢）。
 * 因此世界 → 屏幕只有这一个实现，两处都调它。
 *
 * 与 drawNode 的等价关系（覆盖层几何的正确性依据）：
 * - 渲染层对节点施加的变换 = `translate(祖先链累计平移) · rotate(累计角, 绕自身中心)`，
 *   作用在节点局部坐标 q 上等价于 `q ↦ R(Σθ)·q + O`，其中 O = 节点局部原点 (0,0) 的世界坐标；
 * - DOM 侧 `left/top = O`、`transform: rotate(Σθ)`、`transform-origin: 0 0`
 *   恰好给出同一个映射 `q ↦ R(Σθ)·q + (left, top)`。
 * （引擎的局部矩阵只含平移与旋转、不含缩放，所以这个等价是**精确**的，不是近似。）
 */

import type { NodeId, Point, ScenePage, Viewport } from '@dforge/engine';
import { localPointToWorld, resolveNode, worldRotation } from '@dforge/engine';

/** 屏幕坐标 → 世界坐标（指针与裁剪换算用）。 */
export function screenToWorldPoint(viewport: Viewport, point: Point): Point {
  return {
    x: (point.x - viewport.panX) / viewport.zoom,
    y: (point.y - viewport.panY) / viewport.zoom,
  };
}

/** 世界坐标 → 屏幕坐标（覆盖层用；渲染层的屏幕空间换算同源）。 */
export function worldToScreenPoint(viewport: Viewport, point: Point): Point {
  return {
    x: point.x * viewport.zoom + viewport.panX,
    y: point.y * viewport.zoom + viewport.panY,
  };
}

/** 覆盖层几何（屏幕 CSS 像素；世界尺寸一并给出，字距/行高按世界单位换算）。 */
export interface OverlayBox {
  /** 节点局部原点（左上角）的世界位置换算到屏幕后的 left/top。 */
  left: number;
  top: number;
  /** 节点自身尺寸 × zoom（屏幕 px）。 */
  width: number;
  height: number;
  /** 祖先链累计旋转（度，含自身）——与 drawNode 的 rotate 同源。 */
  rotation: number;
  /** 节点世界尺寸（未缩放；调用方按 zoom 换算字号/字距）。 */
  worldWidth: number;
  worldHeight: number;
}

/**
 * 节点覆盖盒（世界 → 屏幕）：位置走**祖先链**（父级偏移/旋转都算进来）。
 * 节点不存在（撤销/删除）→ null，调用方据此收摊（不得静默按局部坐标落位）。
 */
export function nodeOverlayBox(page: ScenePage, id: NodeId, viewport: Viewport): OverlayBox | null {
  const node = resolveNode(page, id);
  if (node === undefined) return null;
  const worldOrigin = localPointToWorld(page, id, { x: 0, y: 0 });
  if (worldOrigin === null) return null;
  const screen = worldToScreenPoint(viewport, worldOrigin);
  return {
    left: screen.x,
    top: screen.y,
    width: node.width * viewport.zoom,
    height: node.height * viewport.zoom,
    rotation: worldRotation(page, id),
    worldWidth: node.width,
    worldHeight: node.height,
  };
}
