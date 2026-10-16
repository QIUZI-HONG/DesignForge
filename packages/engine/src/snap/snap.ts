/**
 * 吸附与对齐参考线（C8 对标要点：吸附参考线（红）、测量（红）、吸附阈值 6px）。
 *
 * 阈值口径（**偏离说明**）：本实现取「距离 ≤ 6px 吸附、> 6px 不吸附」的**闭区间**语义，
 * 与 C8「吸附阈值 6px」一致。任务简报里「5.9px 不吸 / 6.0px 吸」两值在单调阈值下不可同时成立
 * （5.9 不吸 ⇒ 阈值 < 5.9 ⇒ 6.0 必不吸），故按「6.0px 吸」一侧实现，并在测试里钉住三条边界。
 *
 * 阈值是**屏幕像素**：世界阈值 = 6 / zoom（画布缩放后手感恒定，Figma 语义）。
 * 本模块只产出数据（位移建议 + 参考线 + 测量），颜色（红）由渲染层按令牌决定。
 */

import { boundsCenter, unionBounds } from '../geometry/bounds';
import { worldBoundsOfNode } from '../geometry/transform';
import type { Point, Rect } from '../geometry/types';
import type { NodeId, ScenePage } from '../model/index';
import { getChildrenIds, getDescendantIds, resolveNode } from '../scene/query';

/** 屏幕空间吸附阈值（px）。 */
export const SNAP_THRESHOLD_PX = 6;

/** 画布缩放 → 世界空间阈值。 */
export function snapThresholdWorld(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return SNAP_THRESHOLD_PX;
  return SNAP_THRESHOLD_PX / zoom;
}

/** 吸附参考对象。 */
export interface SnapTarget {
  id: string;
  /** 世界 AABB。 */
  bounds: Rect;
  /** 参考线（页面标尺/用户辅助线）用该字段标注来源，节点默认 'node'。 */
  source?: 'node' | 'guide' | 'parent';
}

/** 对齐参考线（渲染为红线）。 */
export interface SnapGuide {
  axis: 'x' | 'y';
  /** 参考线的世界坐标（竖线取 x / 横线取 y）。 */
  position: number;
  /** 线的跨度（世界坐标，另一轴）。 */
  from: number;
  to: number;
  /** 参与对齐的参考对象 id。 */
  refs: string[];
  kind: 'edge' | 'center';
}

/** 测量标注数据（渲染为红色尺寸标注）。 */
export interface Measurement {
  axis: 'x' | 'y';
  /** 起点/终点（沿 axis 的世界坐标）。 */
  from: number;
  to: number;
  value: number;
  /** 标注线所在位置（另一轴的世界坐标）。 */
  at: number;
  /** 标注对象：与哪个参考对象之间。 */
  refs: string[];
  kind: 'distance' | 'spacing';
}

/** 吸附结果。 */
export interface SnapResult {
  /** 建议位移（世界坐标）。 */
  dx: number;
  dy: number;
  guides: SnapGuide[];
  measurements: Measurement[];
}

/** 无吸附。 */
export const NO_SNAP: SnapResult = { dx: 0, dy: 0, guides: [], measurements: [] };

/** 吸附选项。 */
export interface SnapOptions {
  /** 世界空间阈值（默认取 `SNAP_THRESHOLD_PX` 对应 zoom=1）。 */
  threshold?: number;
  /** 参与的轴（默认两轴）。 */
  axes?: 'both' | 'x' | 'y';
  /** 是否同时产出测量数据（默认 true）。 */
  measurements?: boolean;
}

/** 移动体的候选对齐值（左/中/右 或 上/中/下）。 */
function candidatesX(rect: Rect): Array<{ value: number; kind: SnapGuide['kind'] }> {
  return [
    { value: rect.x, kind: 'edge' },
    { value: rect.x + rect.width / 2, kind: 'center' },
    { value: rect.x + rect.width, kind: 'edge' },
  ];
}

function candidatesY(rect: Rect): Array<{ value: number; kind: SnapGuide['kind'] }> {
  return [
    { value: rect.y, kind: 'edge' },
    { value: rect.y + rect.height / 2, kind: 'center' },
    { value: rect.y + rect.height, kind: 'edge' },
  ];
}

/** 某一个轴上的最佳吸附。 */
function bestAxisSnap(
  movingValues: Array<{ value: number; kind: SnapGuide['kind'] }>,
  targets: readonly SnapTarget[],
  axis: 'x' | 'y',
  threshold: number,
): { delta: number; position: number; kind: SnapGuide['kind']; refs: string[] } | null {
  let best: { delta: number; position: number; kind: SnapGuide['kind']; refs: string[] } | null =
    null;
  for (const moving of movingValues) {
    for (const target of targets) {
      const targetValues = axis === 'x' ? candidatesX(target.bounds) : candidatesY(target.bounds);
      for (const targetValue of targetValues) {
        const delta = targetValue.value - moving.value;
        if (Math.abs(delta) > threshold) continue;
        if (best === null || Math.abs(delta) < Math.abs(best.delta)) {
          best = { delta, position: targetValue.value, kind: moving.kind, refs: [target.id] };
        } else if (
          best !== null &&
          Math.abs(delta) === Math.abs(best.delta) &&
          targetValue.value === best.position
        ) {
          best.refs.push(target.id);
        }
      }
    }
  }
  return best;
}

/** 计算某个轴的参考线跨度（覆盖移动体与参考对象）。 */
function guideSpan(
  axis: 'x' | 'y',
  moving: Rect,
  targets: readonly SnapTarget[],
  refs: readonly string[],
): { from: number; to: number } {
  const rects = [moving, ...targets.filter((t) => refs.includes(t.id)).map((t) => t.bounds)];
  const union = unionBounds(rects) ?? moving;
  return axis === 'x'
    ? { from: union.y, to: union.y + union.height }
    : { from: union.x, to: union.x + union.width };
}

/**
 * 计算吸附：返回建议位移、对齐参考线与测量数据。
 * 两个轴独立求解（x 轴对齐不影响 y 轴判定）。
 */
export function computeSnap(
  moving: Rect,
  targets: readonly SnapTarget[],
  options: SnapOptions = {},
): SnapResult {
  const threshold = options.threshold ?? SNAP_THRESHOLD_PX;
  const axes = options.axes ?? 'both';
  if (targets.length === 0 || threshold <= 0) return { ...NO_SNAP };

  const result: SnapResult = { dx: 0, dy: 0, guides: [], measurements: [] };

  if (axes === 'both' || axes === 'x') {
    const snap = bestAxisSnap(candidatesX(moving), targets, 'x', threshold);
    if (snap) {
      result.dx = snap.delta;
      const span = guideSpan('x', moving, targets, snap.refs);
      result.guides.push({
        axis: 'x',
        position: snap.position,
        from: span.from,
        to: span.to,
        refs: snap.refs,
        kind: snap.kind,
      });
    }
  }
  if (axes === 'both' || axes === 'y') {
    const snap = bestAxisSnap(candidatesY(moving), targets, 'y', threshold);
    if (snap) {
      result.dy = snap.delta;
      const span = guideSpan('y', moving, targets, snap.refs);
      result.guides.push({
        axis: 'y',
        position: snap.position,
        from: span.from,
        to: span.to,
        refs: snap.refs,
        kind: snap.kind,
      });
    }
  }

  if (options.measurements !== false && (result.dx !== 0 || result.dy !== 0)) {
    const snapped: Rect = {
      x: moving.x + result.dx,
      y: moving.y + result.dy,
      width: moving.width,
      height: moving.height,
    };
    result.measurements = computeMeasurements(snapped, targets);
  }
  return result;
}

/**
 * 测量数据：移动体与最近的参考对象之间的水平/垂直距离（每侧取最近一个）。
 */
export function computeMeasurements(
  moving: Rect,
  targets: readonly SnapTarget[],
  options: { maxDistance?: number } = {},
): Measurement[] {
  const maxDistance = options.maxDistance ?? 1000;
  const out: Measurement[] = [];
  let nearestRight: { gap: number; target: SnapTarget } | null = null;
  let nearestLeft: { gap: number; target: SnapTarget } | null = null;
  let nearestBottom: { gap: number; target: SnapTarget } | null = null;
  let nearestTop: { gap: number; target: SnapTarget } | null = null;

  for (const target of targets) {
    const b = target.bounds;
    const overlapsY = moving.y < b.y + b.height && b.y < moving.y + moving.height;
    const overlapsX = moving.x < b.x + b.width && b.x < moving.x + moving.width;
    if (overlapsY) {
      const gapRight = b.x - (moving.x + moving.width);
      if (
        gapRight >= 0 &&
        gapRight <= maxDistance &&
        (!nearestRight || gapRight < nearestRight.gap)
      ) {
        nearestRight = { gap: gapRight, target };
      }
      const gapLeft = moving.x - (b.x + b.width);
      if (gapLeft >= 0 && gapLeft <= maxDistance && (!nearestLeft || gapLeft < nearestLeft.gap)) {
        nearestLeft = { gap: gapLeft, target };
      }
    }
    if (overlapsX) {
      const gapBottom = b.y - (moving.y + moving.height);
      if (
        gapBottom >= 0 &&
        gapBottom <= maxDistance &&
        (!nearestBottom || gapBottom < nearestBottom.gap)
      ) {
        nearestBottom = { gap: gapBottom, target };
      }
      const gapTop = moving.y - (b.y + b.height);
      if (gapTop >= 0 && gapTop <= maxDistance && (!nearestTop || gapTop < nearestTop.gap)) {
        nearestTop = { gap: gapTop, target };
      }
    }
  }

  const centerY = moving.y + moving.height / 2;
  const centerX = moving.x + moving.width / 2;
  if (nearestLeft) {
    out.push({
      axis: 'x',
      from: nearestLeft.target.bounds.x + nearestLeft.target.bounds.width,
      to: moving.x,
      value: nearestLeft.gap,
      at: centerY,
      refs: [nearestLeft.target.id],
      kind: 'distance',
    });
  }
  if (nearestRight) {
    out.push({
      axis: 'x',
      from: moving.x + moving.width,
      to: nearestRight.target.bounds.x,
      value: nearestRight.gap,
      at: centerY,
      refs: [nearestRight.target.id],
      kind: 'distance',
    });
  }
  if (nearestTop) {
    out.push({
      axis: 'y',
      from: nearestTop.target.bounds.y + nearestTop.target.bounds.height,
      to: moving.y,
      value: nearestTop.gap,
      at: centerX,
      refs: [nearestTop.target.id],
      kind: 'distance',
    });
  }
  if (nearestBottom) {
    out.push({
      axis: 'y',
      from: moving.y + moving.height,
      to: nearestBottom.target.bounds.y,
      value: nearestBottom.gap,
      at: centerX,
      refs: [nearestBottom.target.id],
      kind: 'distance',
    });
  }
  return out;
}

/** 网格吸附：取「离网格线最近的值」，超出阈值则不动。 */
export function snapValueToGrid(
  value: number,
  gridSize: number,
  threshold: number,
): { value: number; delta: number } | null {
  if (gridSize <= 0 || threshold <= 0) return null;
  const nearest = Math.round(value / gridSize) * gridSize;
  const delta = nearest - value;
  if (Math.abs(delta) > threshold) return null;
  return { value: nearest, delta };
}

/** 矩形按左上角吸附到网格。 */
export function snapRectToGrid(
  rect: Rect,
  gridSize: number,
  threshold: number,
): { dx: number; dy: number } {
  const x = snapValueToGrid(rect.x, gridSize, threshold);
  const y = snapValueToGrid(rect.y, gridSize, threshold);
  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0 };
}

/** 点吸附到网格。 */
export function snapPointToGrid(point: Point, gridSize: number, threshold: number): Point {
  const x = snapValueToGrid(point.x, gridSize, threshold);
  const y = snapValueToGrid(point.y, gridSize, threshold);
  return { x: x?.value ?? point.x, y: y?.value ?? point.y };
}

/** 判断两个矩形是否「中心对齐」（画出中心参考线的情境）。 */
export function isCenterAligned(a: Rect, b: Rect, tolerance = 0): boolean {
  const ca = boundsCenter(a);
  const cb = boundsCenter(b);
  return Math.abs(ca.x - cb.x) <= tolerance || Math.abs(ca.y - cb.y) <= tolerance;
}

/** 构造参考对象（由 id + 世界 AABB 组成）。 */
export function snapTargetsFromBounds(
  entries: ReadonlyArray<{ id: string; bounds: Rect | null; source?: SnapTarget['source'] }>,
): SnapTarget[] {
  const out: SnapTarget[] = [];
  for (const entry of entries) {
    if (!entry.bounds) continue;
    out.push(
      entry.source === undefined
        ? { id: entry.id, bounds: entry.bounds }
        : { id: entry.id, bounds: entry.bounds, source: entry.source },
    );
  }
  return out;
}

/**
 * 从页面收集吸附参考对象（供拖动时使用）：
 * 排除移动节点自身及其子树，纳入父容器、同层兄弟、页面顶层其他对象与父容器内的兄弟。
 */
export function snapTargetsFromPage(
  page: ScenePage,
  movingIds: readonly NodeId[],
  options: { includeHidden?: boolean; extra?: readonly SnapTarget[] } = {},
): SnapTarget[] {
  const excluded = new Set<NodeId>(movingIds);
  for (const id of movingIds) {
    for (const descendantId of getDescendantIds(page, id)) excluded.add(descendantId);
  }

  const movingParents = new Set<string | null>();
  for (const id of movingIds) {
    movingParents.add(parentOf(page, id));
  }

  const targets: SnapTarget[] = [];
  const seen = new Set<NodeId>();
  const consider = (id: NodeId): void => {
    if (excluded.has(id) || seen.has(id)) return;
    const node = resolveNode(page, id);
    if (!node) return;
    if (!options.includeHidden && !node.visible) return;
    const bounds = worldBoundsOfNode(page, id);
    if (!bounds) return;
    seen.add(id);
    targets.push({ id, bounds });
  };

  // 页面顶层
  for (const id of page.rootIds) consider(id);
  // 沿父链纳入：各级父容器与其同级兄弟（移动节点自身子树已排除）
  for (const parentId of movingParents) {
    let current = parentId;
    while (current !== null) {
      consider(current);
      for (const siblingId of getChildrenIds(page, current)) consider(siblingId);
      current = parentOf(page, current);
    }
  }
  for (const target of options.extra ?? []) targets.push(target);
  return targets;
}

/** 节点的父 id（内部用；避免与 helpers 循环依赖）。 */
function parentOf(page: ScenePage, nodeId: NodeId): NodeId | null {
  if (page.rootIds.includes(nodeId)) return null;
  for (const node of Object.values(page.nodes)) {
    if (
      (node.type === 'frame' ||
        node.type === 'group' ||
        node.type === 'component' ||
        node.type === 'component_set') &&
      node.children.includes(nodeId)
    ) {
      return node.id;
    }
  }
  return null;
}
