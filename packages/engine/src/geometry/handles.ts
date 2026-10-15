/**
 * 8 手柄语义与缩放/旋转解算（C8 对标要点：8 手柄）。
 *
 * 手柄命名与 Figma 一致（nw/n/ne/e/se/s/sw/w）。解算统一按「**对侧不动**」原则：
 * 拖角手柄时对角固定，拖边手柄时对边固定；旋转节点时对侧锚点在世界空间中保持不动。
 * 一切角度为度、顺时针为正。
 */

import {
  boundsCenter,
  normalizeRect,
  rectContainsPoint,
  rectCorners,
  rotatePointsAround,
} from './bounds';
import { nearlyEqual, rotateVector } from './matrix';
import type { Point, Rect } from './types';

/** 手柄 id（8 个）。 */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** 手柄顺序（Inspector/渲染遍历顺序，顺时针）。 */
export const HANDLE_IDS: readonly HandleId[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
] as const;

/** 角手柄。 */
export const CORNER_HANDLES: readonly HandleId[] = ['nw', 'ne', 'se', 'sw'] as const;

/** 边手柄。 */
export const EDGE_HANDLES: readonly HandleId[] = ['n', 'e', 's', 'w'] as const;

/** 是否角手柄。 */
export function isCornerHandle(handle: HandleId): boolean {
  return (CORNER_HANDLES as readonly string[]).includes(handle);
}

/** 对侧手柄（缩放锚点所在的手柄）。 */
export function oppositeHandle(handle: HandleId): HandleId {
  const map: Record<HandleId, HandleId> = {
    nw: 'se',
    n: 's',
    ne: 'sw',
    e: 'w',
    se: 'nw',
    s: 'n',
    sw: 'ne',
    w: 'e',
  };
  return map[handle];
}

/** 手柄在（未旋转）包围盒上的位置。 */
export function handlePoint(bounds: Rect, handle: HandleId): Point {
  const r = normalizeRect(bounds);
  const left = r.x;
  const right = r.x + r.width;
  const top = r.y;
  const bottom = r.y + r.height;
  const centerX = r.x + r.width / 2;
  const centerY = r.y + r.height / 2;
  switch (handle) {
    case 'nw':
      return { x: left, y: top };
    case 'n':
      return { x: centerX, y: top };
    case 'ne':
      return { x: right, y: top };
    case 'e':
      return { x: right, y: centerY };
    case 'se':
      return { x: right, y: bottom };
    case 's':
      return { x: centerX, y: bottom };
    case 'sw':
      return { x: left, y: bottom };
    case 'w':
      return { x: left, y: centerY };
  }
}

/**
 * 节点（可旋转）的世界手柄位置：先取未旋转包围盒上的手柄点，再绕包围盒中心旋转。
 * 注意 `bounds` 为**世界坐标下的未旋转包围盒**（即节点中心 + 尺寸）。
 */
export function rotatedHandlePoints(bounds: Rect, rotationDeg: number): Record<HandleId, Point> {
  const center = boundsCenter(bounds);
  const raw = rectCorners(bounds);
  const corners = rotatePointsAround(raw, center, rotationDeg);
  const midpoints: Record<string, Point> = {};
  for (const handle of EDGE_HANDLES) {
    const point = handlePoint(bounds, handle);
    const [rotated] = rotatePointsAround([point], center, rotationDeg);
    midpoints[handle] = rotated as Point;
  }
  const result = {
    nw: corners[0] as Point,
    ne: corners[1] as Point,
    se: corners[2] as Point,
    sw: corners[3] as Point,
  } as Record<HandleId, Point>;
  for (const handle of EDGE_HANDLES) {
    result[handle] = midpoints[handle] as Point;
  }
  return result;
}

/** 命中测试：世界点落在哪个手柄上（可直接用于 8 手柄拖拽起点判定）。 */
export function hitTestHandle(
  bounds: Rect,
  rotationDeg: number,
  point: Point,
  radius = 4,
): HandleId | null {
  const points = rotatedHandlePoints(bounds, rotationDeg);
  for (const handle of HANDLE_IDS) {
    const p = points[handle];
    if (Math.abs(p.x - point.x) <= radius && Math.abs(p.y - point.y) <= radius) return handle;
  }
  return null;
}

/** 缩放选项。 */
export interface ResizeOptions {
  /** 角手柄按比例缩放（Shift）。 */
  proportional?: boolean;
  /** 以中心为锚点（Alt/Option）。 */
  fromCenter?: boolean;
  /** 最小边长（防止翻转成 0 尺寸）。 */
  minSize?: number;
}

/**
 * 由「起始包围盒 + 手柄 + 指针位置」解算新包围盒（未旋转坐标系内）。
 * 默认对侧不动；`fromCenter` 时以中心为锚点对称缩放；`proportional` 时保持宽高比。
 */
export function resizeRect(
  start: Rect,
  handle: HandleId,
  pointer: Point,
  options: ResizeOptions = {},
): Rect {
  const minSize = options.minSize ?? 1;
  const s = normalizeRect(start);
  const anchor = options.fromCenter ? boundsCenter(s) : handlePoint(s, oppositeHandle(handle));
  let left = s.x;
  let top = s.y;
  let right = s.x + s.width;
  let bottom = s.y + s.height;

  const affectsX = handle !== 'n' && handle !== 's';
  const affectsY = handle !== 'e' && handle !== 'w';

  if (affectsX) {
    if (handle === 'nw' || handle === 'w' || handle === 'sw') {
      left = Math.min(pointer.x, right - minSize);
    } else {
      right = Math.max(pointer.x, left + minSize);
    }
  }
  if (affectsY) {
    if (handle === 'nw' || handle === 'n' || handle === 'ne') {
      top = Math.min(pointer.y, bottom - minSize);
    } else {
      bottom = Math.max(pointer.y, top + minSize);
    }
  }

  if (options.fromCenter) {
    if (affectsX) {
      const half = Math.abs(
        anchor.x - (handle === 'nw' || handle === 'w' || handle === 'sw' ? left : right),
      );
      left = anchor.x - half;
      right = anchor.x + half;
    }
    if (affectsY) {
      const half = Math.abs(
        anchor.y - (handle === 'nw' || handle === 'n' || handle === 'ne' ? top : bottom),
      );
      top = anchor.y - half;
      bottom = anchor.y + half;
    }
  }

  let width = right - left;
  let height = bottom - top;

  if (options.proportional && isCornerHandle(handle) && s.width > 0 && s.height > 0) {
    const ratio = s.width / s.height;
    // 取较大变化方向为主，另一方向按比例推导（保持锚点不动）
    if (Math.abs(width - s.width) >= Math.abs(height - s.height)) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
    const horizontalSign = handle === 'nw' || handle === 'sw' ? -1 : 1;
    const verticalSign = handle === 'nw' || handle === 'ne' ? -1 : 1;
    if (options.fromCenter) {
      left = anchor.x - width / 2;
      right = anchor.x + width / 2;
      top = anchor.y - height / 2;
      bottom = anchor.y + height / 2;
    } else {
      left = horizontalSign < 0 ? anchor.x - width : anchor.x;
      right = horizontalSign < 0 ? anchor.x : anchor.x + width;
      top = verticalSign < 0 ? anchor.y - height : anchor.y;
      bottom = verticalSign < 0 ? anchor.y : anchor.y + height;
    }
  }

  return normalizeRect({ x: left, y: top, width, height });
}

/** 可旋转节点的缩放输入。 */
export interface RotatedBounds {
  bounds: Rect;
  rotation: number;
}

/**
 * 旋转节点的缩解放算：把世界指针换算到节点未旋转坐标系内求解，再反向修正位置，
 * 使**对侧锚点在世界空间中保持不动**（Figma 手感）。
 */
export function resizeRotatedNode(
  start: RotatedBounds,
  handle: HandleId,
  pointerWorld: Point,
  options: ResizeOptions = {},
): Rect {
  const s = normalizeRect(start.bounds);
  const center = boundsCenter(s);
  // 世界 → 未旋转坐标系（同一中心）
  const pointerLocal = addPoints(
    center,
    rotateVector(subtractPoints(pointerWorld, center), -start.rotation),
  );
  const nextLocal = resizeRect(s, handle, pointerLocal, options);
  const anchorLocal = handlePoint(s, oppositeHandle(handle));
  const anchorWorld = addPoints(
    center,
    rotateVector(subtractPoints(anchorLocal, center), start.rotation),
  );
  return alignLocalRectToWorldAnchor(nextLocal, start.rotation, anchorLocal, anchorWorld);
}

/** 把「未旋转坐标系中的矩形」平移，使局部锚点落在指定世界点上。 */
export function alignLocalRectToWorldAnchor(
  rectLocal: Rect,
  rotationDeg: number,
  anchorLocal: Point,
  anchorWorld: Point,
): Rect {
  const center = boundsCenter(rectLocal);
  const anchorInWorldNow = addPoints(
    center,
    rotateVector(subtractPoints(anchorLocal, center), rotationDeg),
  );
  const shift = subtractPoints(anchorWorld, anchorInWorldNow);
  const r = normalizeRect(rectLocal);
  return { x: r.x + shift.x, y: r.y + shift.y, width: r.width, height: r.height };
}

/** 由两个向量求旋转角（度，顺时针为正）。 */
export function rotationDeltaDegrees(center: Point, from: Point, to: Point): number {
  const a = Math.atan2(from.y - center.y, from.x - center.x);
  const b = Math.atan2(to.y - center.y, to.x - center.x);
  return ((b - a) * 180) / Math.PI;
}

/** 角度吸附（Shift 旋转到最近刻度，默认 15°）。 */
export function snapAngle(degrees: number, step = 15): number {
  if (step <= 0) return degrees;
  return Math.round(degrees / step) * step;
}

/** 归一化角度到 (-180, 180]。 */
export function normalizeAngle(degrees: number): number {
  let value = degrees % 360;
  if (value > 180) value -= 360;
  if (value <= -180) value += 360;
  return value;
}

/** 旋转后包围盒的中心是否保持（用于断言旋转不改变中心）。 */
export function rotationKeepsCenter(before: Rect, after: Rect): boolean {
  const a = boundsCenter(before);
  const b = boundsCenter(after);
  return nearlyEqual(a.x, b.x) && nearlyEqual(a.y, b.y);
}

/** 点是否在包围盒内（含边界）。 */
export function boundsContainsPoint(bounds: Rect, point: Point): boolean {
  return rectContainsPoint(bounds, point);
}

function addPoints(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtractPoints(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}
