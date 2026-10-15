/**
 * 节点变换：局部/世界矩阵合成、世界 AABB/OBB、世界↔局部换算。
 *
 * 变换模型（与 Design IR 的约定一致）：节点局部矩阵 = `T(x, y) · R(rotation, 绕自身中心)`；
 * 世界矩阵 = 祖先链局部矩阵依次右乘。实例的虚子节点坐标位于**主组件局部空间**，
 * 其祖先链上的实例节点贡献自身变换，因此整体移动/旋转实例时内容随之而动。
 */

import type { NodeId, SceneNode, ScenePage } from '../model/index';
import { getAncestors, resolveNode } from '../scene/query';
import {
  boundsOfPoints,
  normalizeRect,
  quadContainsPoint,
  quadIntersectsRect,
  rectContainsRect,
} from './bounds';
import {
  applyToPoint,
  identity,
  invert,
  multiply,
  rotateVector,
  rotation,
  translation,
} from './matrix';
import type { Matrix, Point, Rect } from './types';

/** 节点局部矩阵。 */
export function localMatrix(node: SceneNode): Matrix {
  const center = { x: node.width / 2, y: node.height / 2 };
  return multiply(
    translation(node.x, node.y),
    multiply(
      translation(center.x, center.y),
      multiply(rotation(node.rotation), translation(-center.x, -center.y)),
    ),
  );
}

/** 节点的节点自身包围盒（局部、未旋转）。 */
export function localBounds(node: SceneNode): Rect {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

/** 世界矩阵（含祖先链；解析不到节点时返回单位阵）。 */
export function worldMatrix(page: ScenePage, id: NodeId): Matrix {
  const node = resolveNode(page, id);
  if (!node) return identity();
  let matrix = identity();
  const ancestors = getAncestors(page, id).reverse(); // 根 → 父
  for (const ancestorId of ancestors) {
    const ancestor = resolveNode(page, ancestorId);
    if (ancestor) matrix = multiply(matrix, localMatrix(ancestor));
  }
  return multiply(matrix, localMatrix(node));
}

/** 父坐标系的世界矩阵（顶层节点的父 = 页面原点）。 */
export function parentWorldMatrix(page: ScenePage, id: NodeId): Matrix {
  let matrix = identity();
  const ancestors = getAncestors(page, id).reverse();
  for (const ancestorId of ancestors) {
    const ancestor = resolveNode(page, ancestorId);
    if (ancestor) matrix = multiply(matrix, localMatrix(ancestor));
  }
  return matrix;
}

/** 节点及其祖先的旋转累计（度）。 */
export function worldRotation(page: ScenePage, id: NodeId): number {
  let total = 0;
  for (const ancestorId of getAncestors(page, id)) {
    total += resolveNode(page, ancestorId)?.rotation ?? 0;
  }
  const self = resolveNode(page, id);
  return total + (self?.rotation ?? 0);
}

/** 父坐标系的旋转累计（度）——世界增量 → 父局部增量换算用。 */
export function parentFrameRotation(page: ScenePage, id: NodeId): number {
  let total = 0;
  for (const ancestorId of getAncestors(page, id)) {
    total += resolveNode(page, ancestorId)?.rotation ?? 0;
  }
  return total;
}

/** 世界增量 → 节点父坐标系增量（父坐标系被旋转了时，增量需反向旋转）。 */
export function worldDeltaToLocal(page: ScenePage, id: NodeId, delta: Point): Point {
  return rotateVector(delta, -parentFrameRotation(page, id));
}

/** 节点的世界四角（顺序：左上 → 右上 → 右下 → 左下）。 */
export function worldQuad(page: ScenePage, id: NodeId): Point[] | null {
  const node = resolveNode(page, id);
  if (!node) return null;
  const matrix = worldMatrix(page, id);
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: node.width, y: 0 },
    { x: node.width, y: node.height },
    { x: 0, y: node.height },
  ];
  return corners.map((p) => applyToPoint(matrix, p));
}

/** 节点世界 AABB（旋转后的轴对齐包围盒）。 */
export function worldBoundsOfNode(page: ScenePage, id: NodeId): Rect | null {
  const quad = worldQuad(page, id);
  if (!quad) return null;
  return boundsOfPoints(quad);
}

/** 多个节点世界 AABB 的并集。 */
export function worldBoundsOfNodes(page: ScenePage, ids: readonly NodeId[]): Rect | null {
  const rects: Rect[] = [];
  for (const id of ids) {
    const rect = worldBoundsOfNode(page, id);
    if (rect) rects.push(rect);
  }
  if (rects.length === 0) return null;
  return boundsOfPoints(
    rects.flatMap((r) => [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y + r.height },
    ]),
  );
}

/** 世界点 → 节点局部（未旋转）坐标。 */
export function worldPointToLocal(page: ScenePage, id: NodeId, point: Point): Point | null {
  const node = resolveNode(page, id);
  if (!node) return null;
  return applyToPoint(invert(worldMatrix(page, id)), point);
}

/** 节点局部点 → 世界坐标。 */
export function localPointToWorld(page: ScenePage, id: NodeId, point: Point): Point | null {
  const node = resolveNode(page, id);
  if (!node) return null;
  return applyToPoint(worldMatrix(page, id), point);
}

/** 点是否落在节点自身形状内（矩形/椭圆/文本按包围盒；编组不参与）。 */
export function nodeContainsLocalPoint(node: SceneNode, localPoint: Point): boolean {
  if (node.type === 'group') return false;
  const r = normalizeRect({ x: 0, y: 0, width: node.width, height: node.height });
  if (node.type === 'ellipse') {
    const rx = r.width / 2;
    const ry = r.height / 2;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (localPoint.x - rx) / rx;
    const ny = (localPoint.y - ry) / ry;
    return nx * nx + ny * ny <= 1;
  }
  return quadContainsPoint(
    [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y },
      { x: r.x + r.width, y: r.y + r.height },
      { x: r.x, y: r.y + r.height },
    ],
    localPoint,
  );
}

/**
 * 节点世界 OBB 与矩形的关系：
 * - `intersect`：相交（含相切）；
 * - `contain`：节点完全落在矩形内。
 */
export function nodeQuadInRect(
  page: ScenePage,
  id: NodeId,
  rect: Rect,
  mode: 'intersect' | 'contain',
): boolean {
  const quad = worldQuad(page, id);
  if (!quad) return false;
  if (mode === 'contain') return rectContainsRect(rect, boundsOfPoints(quad));
  return quadIntersectsRect(quad, rect);
}
