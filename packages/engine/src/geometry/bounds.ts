/**
 * 包围盒与矩形几何（纯函数）。
 *
 * 术语：AABB = 轴对齐包围盒；OBB = 旋转包围盒（用四角四边形表示）。
 */

import { rotateVector } from './matrix';
import type { Point, Rect } from './types';

/** 由矩形取四角（左上 → 右上 → 右下 → 左下）。 */
export function rectCorners(rect: Rect): [Point, Point, Point, Point] {
  const r = normalizeRect(rect);
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

/** 负宽高归正。 */
export function normalizeRect(rect: Rect): Rect {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

/** 由点集求 AABB。 */
export function boundsOfPoints(points: readonly Point[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const first = points[0] as Point;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 合并多个矩形；空集返回 null。 */
export function unionBounds(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    const r = normalizeRect(rect);
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 外扩（负值内缩）。 */
export function inflateRect(rect: Rect, amount: number): Rect {
  const r = normalizeRect(rect);
  return {
    x: r.x - amount,
    y: r.y - amount,
    width: r.width + amount * 2,
    height: r.height + amount * 2,
  };
}

/** 平移。 */
export function translateRect(rect: Rect, dx: number, dy: number): Rect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

/** 中心点。 */
export function boundsCenter(rect: Rect): Point {
  const r = normalizeRect(rect);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** 点是否落在矩形内（含边界）。 */
export function rectContainsPoint(rect: Rect, point: Point): boolean {
  const r = normalizeRect(rect);
  return point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height;
}

/** `inner` 是否完全落在 `outer` 内（含边界）。 */
export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  const o = normalizeRect(outer);
  const i = normalizeRect(inner);
  return (
    i.x >= o.x - 1e-9 &&
    i.y >= o.y - 1e-9 &&
    i.x + i.width <= o.x + o.width + 1e-9 &&
    i.y + i.height <= o.y + o.height + 1e-9
  );
}

/** 两 AABB 是否相交（含相切）。 */
export function rectIntersectsRect(a: Rect, b: Rect): boolean {
  const r1 = normalizeRect(a);
  const r2 = normalizeRect(b);
  return (
    r1.x <= r2.x + r2.width &&
    r2.x <= r1.x + r1.width &&
    r1.y <= r2.y + r2.height &&
    r2.y <= r1.y + r1.height
  );
}

/** 绕中心旋转点集。 */
export function rotatePointsAround(
  points: readonly Point[],
  center: Point,
  degrees: number,
): Point[] {
  return points.map((p) => {
    const v = rotateVector({ x: p.x - center.x, y: p.y - center.y }, degrees);
    return { x: center.x + v.x, y: center.y + v.y };
  });
}

/** OBB（四角）→ AABB。 */
export function quadBounds(quad: readonly Point[]): Rect {
  return boundsOfPoints(quad);
}

/** 点在四边形内（射线法，支持凸/凹；边界视为在内）。 */
export function quadContainsPoint(quad: readonly Point[], point: Point): boolean {
  let inside = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i, i += 1) {
    const pi = quad[i] as Point;
    const pj = quad[j] as Point;
    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersects) inside = !inside;
  }
  if (inside) return true;
  // 边界上：任一条边的点在矩形内即视为包含
  for (let i = 0; i < quad.length; i += 1) {
    const a = quad[i] as Point;
    const b = quad[(i + 1) % quad.length] as Point;
    if (pointOnSegment(a, b, point)) return true;
  }
  return false;
}

/** 点是否在线段上（含端点，容差 1e-9 相对量）。 */
export function pointOnSegment(a: Point, b: Point, p: Point, epsilon = 1e-9): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > epsilon * Math.max(1, Math.abs(b.x - a.x) + Math.abs(b.y - a.y))) {
    return false;
  }
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  const lenSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot >= -epsilon && dot <= lenSq + epsilon;
}

/** 分离轴测试：凸四边形与 AABB 是否相交（用于框选旋转节点）。 */
export function quadIntersectsRect(quad: readonly Point[], rect: Rect): boolean {
  const rectQuad = rectCorners(rect);
  // 若任一方顶点落在另一方内 → 相交
  if (rectQuad.some((p) => quadContainsPoint(quad, p))) return true;
  if (quad.some((p) => rectContainsPoint(rect, p))) return true;
  // 否则检查边是否相交
  for (let i = 0; i < quad.length; i += 1) {
    const a = quad[i] as Point;
    const b = quad[(i + 1) % quad.length] as Point;
    for (let j = 0; j < rectQuad.length; j += 1) {
      const c = rectQuad[j] as Point;
      const d = rectQuad[(j + 1) % rectQuad.length] as Point;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

/** 线段相交判定（含共线重叠）。 */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const orientation = (p: Point, q: Point, r: Point): number =>
    (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (Math.abs(o1) < 1e-9 && pointOnSegment(a, b, c)) return true;
  if (Math.abs(o2) < 1e-9 && pointOnSegment(a, b, d)) return true;
  if (Math.abs(o3) < 1e-9 && pointOnSegment(c, d, a)) return true;
  if (Math.abs(o4) < 1e-9 && pointOnSegment(c, d, b)) return true;
  return false;
}
