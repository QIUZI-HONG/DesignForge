/**
 * 命中与手柄判定（指针变换的「几何侧」）。
 *
 * 分工：引擎负责**几何与语义**（点命中、框选、8 手柄点位、旋转区），本模块只做
 * 「屏幕半径 → 世界半径」的换算与选择框（`SelectionFrame`）的构造——
 * 渲染层与指针层共用同一份 `SelectionFrame`，因此手柄的「画」与「拖」不可能漂移。
 */

import type { HandleId, NodeId, Point, Rect, ScenePage } from '@dforge/engine';
import {
  clickSelectionTarget,
  type HandleMode,
  hitTestHandle,
  isCornerHandle,
  marqueeSelect,
  rotatedHandlePoints,
  worldBoundsOfNodes,
} from '@dforge/engine';

import type { SelectionFrame } from '../render/frame';
import { HANDLE_HIT_RADIUS_PX, inRotateZone } from '../render/scale';

/** 手柄命中结果。 */
export interface HandleHit {
  id: HandleId;
  mode: HandleMode;
}

/**
 * 选择框（世界 AABB + 手柄框旋转角）。
 *
 * 旋转角口径**必须与引擎一致**：单选取该节点的**局部** rotation，多选取 0
 * （引擎 `beginInteraction` 就是这么算起始包围盒与旋转的；不一致会让「拖了 A 手柄却从 B 处变形」）。
 */
export function selectionFrameOf(page: ScenePage, ids: readonly NodeId[]): SelectionFrame | null {
  if (ids.length === 0) return null;
  const bounds = worldBoundsOfNodes(page, ids);
  if (bounds === null) return null;
  const rotation = ids.length === 1 ? (page.nodes[ids[0] as NodeId]?.rotation ?? 0) : 0;
  return { bounds, rotation, ids };
}

/** 点是否命中某个手柄（缩放或旋转）。 */
export function handleHitAt(
  page: ScenePage,
  ids: readonly NodeId[],
  worldPoint: Point,
  zoom: number,
): HandleHit | null {
  const frame = selectionFrameOf(page, ids);
  if (frame === null) return null;
  // 屏幕半径 → 世界半径（手感与缩放无关）
  const radius = HANDLE_HIT_RADIUS_PX / (zoom > 0 ? zoom : 1);
  const resize = hitTestHandle(frame.bounds, frame.rotation, worldPoint, radius);
  if (resize !== null) return { id: resize, mode: 'resize' };

  // 旋转区：角手柄**外侧**的环带（Figma：角落上缩放、稍外侧旋转）
  const points = rotatedHandlePoints(frame.bounds, frame.rotation);
  const cornerIds: HandleId[] = ['nw', 'ne', 'se', 'sw'];
  for (const id of cornerIds) {
    if (!isCornerHandle(id)) continue;
    const corner = points[id];
    if (inRotateZone(corner, worldPoint, 12 / (zoom > 0 ? zoom : 1))) {
      return { id, mode: 'rotate' };
    }
  }
  return null;
}

/** 单击选择目标（穿透编组到最外层；`deep` 时取最深命中）。 */
export function clickTargetAt(
  page: ScenePage,
  worldPoint: Point,
  options: { deep?: boolean } = {},
): NodeId | null {
  return clickSelectionTarget(page, worldPoint, options);
}

/** 框选命中集合（引擎规则：容器未被完全包含时向下深入）。 */
export function marqueeHitIds(page: ScenePage, rect: Rect): NodeId[] {
  if (rect.width <= 0 && rect.height <= 0) return [];
  return marqueeSelect(page, rect, { mode: 'intersect' });
}

/** 手柄基础角度（度，顺时针，0 = 正右/东）。 */
const HANDLE_ANGLE: Record<HandleId, number> = {
  e: 0,
  se: 45,
  s: 90,
  sw: 135,
  w: 180,
  nw: 225,
  n: 270,
  ne: 315,
};

/** 45° 刻度的光标环（重复一轮以覆盖 8 档）。 */
const CURSOR_RING = [
  'ew-resize',
  'nwse-resize',
  'ns-resize',
  'nesw-resize',
  'ew-resize',
  'nwse-resize',
  'ns-resize',
  'nesw-resize',
] as const;

/** 光标样式（指针层用来给 DOM 设置 cursor；UI 层不重算几何）。 */
export function cursorForHit(hit: HandleHit | null, rotationDeg: number): string {
  if (hit === null) return 'default';
  if (hit.mode === 'rotate') return 'grabbing';
  const angle = HANDLE_ANGLE[hit.id] + rotationDeg;
  const normalized = ((angle % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % 8;
  return CURSOR_RING[index] as string;
}
