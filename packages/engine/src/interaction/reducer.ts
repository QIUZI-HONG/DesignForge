/**
 * 交互状态机（pointer 事件无关的纯函数式 reducer）。
 *
 * 白名单第 1/2/3/4/5/6/12 类（选择/移动/缩放/旋转/画布缩放/画布平移/吸附）在此闭环：
 * `beginInteraction` → `updateInteraction` × N → `commitInteraction`（产出命令，交命令栈结算）。
 *
 * 设计要点：
 * - 事件是**普通数据**（不含 DOM 类型），几何全部走 `geometry/`，node 环境可直接测试；
 * - 拖动过程中**不写文档**：状态只保存预览（位移/包围盒/角度），松手才产出命令；
 * - 吸附在 update 内完成，阈值按视口缩放换算（世界阈值 = 6 / zoom）。
 */

import { moveNodesByWorldCommands, parentIdOf } from '../commands/helpers';
import type { Command } from '../commands/types';
import { boundsCenter, normalizeRect, translateRect } from '../geometry/bounds';
import type { HandleId } from '../geometry/handles';
import {
  handlePoint,
  oppositeHandle,
  resizeRotatedNode,
  rotationDeltaDegrees,
  snapAngle,
} from '../geometry/handles';
import { applyToPoint, invert, rotateVector } from '../geometry/matrix';
import { worldBoundsOfNode, worldBoundsOfNodes, worldMatrix } from '../geometry/transform';
import type { Matrix, Point, Rect } from '../geometry/types';
import type { NodeId, PageId, ScenePage } from '../model/index';
import { resolveNode } from '../scene/query';
import type { SnapResult } from '../snap/snap';
import {
  computeSnap,
  NO_SNAP,
  type SnapTarget,
  snapRectToGrid,
  snapTargetsFromPage,
  snapThresholdWorld,
} from '../snap/snap';

/** 修饰键（Shift/Alt/⌘）。 */
export interface Modifiers {
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/** 手柄拖拽模式：缩放或旋转（C8：8 手柄 + 角外侧旋转区）。 */
export type HandleMode = 'resize' | 'rotate';

/** 工具（C2 工具栏）。 */
export type EditorTool = 'select' | 'hand' | 'marquee';

/** 交互上下文（只读文档视图 + 视口 + 吸附开关）。 */
export interface InteractionContext {
  page: ScenePage;
  pageId: PageId;
  /** 视口缩放（吸附阈值换算与手柄命中半径用）。 */
  zoom: number;
  snapEnabled?: boolean;
  grid?: { size: number; snapToGrid: boolean } | null;
  /** 额外参考对象（页面辅助线等）。 */
  extraTargets?: readonly SnapTarget[];
}

/** 空闲态。 */
export interface IdleInteraction {
  kind: 'idle';
}

/** 空闲态常量。 */
export const IDLE: IdleInteraction = { kind: 'idle' };

/** 移动态。 */
export interface MoveInteraction {
  kind: 'move';
  pageId: PageId;
  nodeIds: NodeId[];
  start: Point;
  current: Point;
  /** 当前世界位移（含吸附修正）。 */
  delta: Point;
  snap: SnapResult;
}

/** 缩放态。 */
export interface ResizeInteraction {
  kind: 'resize';
  pageId: PageId;
  nodeIds: NodeId[];
  handle: HandleId;
  /** 起始世界包围盒（旋转节点为其世界 AABB）。 */
  startBounds: Rect;
  rotation: number;
  start: Point;
  current: Point;
  /** 解算后的世界包围盒（预览）。 */
  nextBounds: Rect;
}

/** 旋转态。 */
export interface RotateInteraction {
  kind: 'rotate';
  pageId: PageId;
  nodeIds: NodeId[];
  center: Point;
  start: Point;
  current: Point;
  /** 累计旋转角（度，含 Shift 吸附）。 */
  rotation: number;
  startRotations: Record<NodeId, number>;
}

/** 框选态。 */
export interface MarqueeInteraction {
  kind: 'marquee';
  pageId: PageId;
  start: Point;
  current: Point;
  additive: boolean;
  baseSelection: NodeId[];
}

/** 画布平移态。 */
export interface PanInteraction {
  kind: 'pan';
  startScreen: Point;
  currentScreen: Point;
}

/** 交互状态联合。 */
export type InteractionState =
  | IdleInteraction
  | MoveInteraction
  | ResizeInteraction
  | RotateInteraction
  | MarqueeInteraction
  | PanInteraction;

/** 指针按下事件（命中信息由调用方用 geometry 求出，本模块不做 DOM 假设）。 */
export interface PointerDownEvent {
  type: 'pointer.down';
  /** 世界坐标。 */
  point: Point;
  /** 屏幕坐标（平移用）。 */
  screen: Point;
  /** 当前选择集。 */
  selection: readonly NodeId[];
  /** 点击目标（`clickSelectionTarget` 结果；点空为 null）。 */
  clickTarget: NodeId | null;
  /** 命中的手柄（选中框上；无则 null）。 */
  handle: { id: HandleId; mode: HandleMode } | null;
  tool?: EditorTool;
  modifiers?: Modifiers;
}

/** 指针移动事件。 */
export interface PointerMoveEvent {
  type: 'pointer.move';
  point: Point;
  screen: Point;
  modifiers?: Modifiers;
}

/** 指针松开事件。 */
export interface PointerUpEvent {
  type: 'pointer.up';
  point: Point;
  screen: Point;
  modifiers?: Modifiers;
}

/** 取消事件（Esc / 失焦）。 */
export interface CancelEvent {
  type: 'cancel';
}

/** 事件联合。 */
export type InteractionEvent = PointerDownEvent | PointerMoveEvent | PointerUpEvent | CancelEvent;

/** 开始交互（空闲态之外原样返回）。 */
export function beginInteraction(
  state: InteractionState,
  event: PointerDownEvent,
  context: InteractionContext,
): InteractionState {
  if (state.kind !== 'idle') return state;
  const { point, screen, selection, clickTarget, handle, tool } = event;

  if (tool === 'hand') {
    return { kind: 'pan', startScreen: screen, currentScreen: screen };
  }
  if (handle) {
    const nodeIds =
      selection.length > 0
        ? selection.filter((id) => resolveNode(context.page, id) !== undefined)
        : [];
    if (nodeIds.length === 0) return IDLE;
    if (handle.mode === 'rotate') return beginRotate(context, nodeIds, point);
    const bounds = worldBoundsOfNodes(context.page, nodeIds);
    if (!bounds) return IDLE;
    const rotation =
      nodeIds.length === 1 ? (resolveNode(context.page, nodeIds[0] as NodeId)?.rotation ?? 0) : 0;
    return {
      kind: 'resize',
      pageId: context.pageId,
      nodeIds,
      handle: handle.id,
      startBounds: bounds,
      rotation,
      start: point,
      current: point,
      nextBounds: bounds,
    };
  }
  if (clickTarget) {
    const nodeIds = selection.includes(clickTarget) ? [...selection] : [clickTarget];
    return {
      kind: 'move',
      pageId: context.pageId,
      nodeIds,
      start: point,
      current: point,
      delta: { x: 0, y: 0 },
      snap: NO_SNAP,
    };
  }
  return {
    kind: 'marquee',
    pageId: context.pageId,
    start: point,
    current: point,
    additive: event.modifiers?.shift === true,
    baseSelection: [...selection],
  };
}

/** 进入旋转态。 */
export function beginRotate(
  context: InteractionContext,
  nodeIds: readonly NodeId[],
  point: Point,
): RotateInteraction {
  const bounds = worldBoundsOfNodes(context.page, nodeIds) ?? { x: 0, y: 0, width: 0, height: 0 };
  const startRotations: Record<NodeId, number> = {};
  for (const id of nodeIds) startRotations[id] = resolveNode(context.page, id)?.rotation ?? 0;
  return {
    kind: 'rotate',
    pageId: context.pageId,
    nodeIds: [...nodeIds],
    center: boundsCenter(bounds),
    start: point,
    current: point,
    rotation: 0,
    startRotations,
  };
}

/** 推进交互。 */
export function updateInteraction(
  state: InteractionState,
  event: PointerMoveEvent | PointerUpEvent,
  context: InteractionContext,
): InteractionState {
  const modifiers = event.modifiers;
  switch (state.kind) {
    case 'idle':
      return state;
    case 'pan':
      return { ...state, currentScreen: event.screen };
    case 'marquee':
      return { ...state, current: event.point };
    case 'move': {
      const raw = { x: event.point.x - state.start.x, y: event.point.y - state.start.y };
      const adjusted = constrainDelta(raw, modifiers);
      const { delta, snap } = applySnapToMove(context, state.nodeIds, adjusted);
      return { ...state, current: event.point, delta, snap };
    }
    case 'resize': {
      const pointer = modifiers?.shift ? aspectLockedPointer(state, event.point) : event.point;
      const nextBounds = resizeRotatedNode(
        { bounds: state.startBounds, rotation: state.rotation },
        state.handle,
        pointer,
        { proportional: modifiers?.shift === true, fromCenter: modifiers?.alt === true },
      );
      return { ...state, current: event.point, nextBounds };
    }
    case 'rotate': {
      const raw = rotationDeltaDegrees(state.center, state.start, event.point);
      return { ...state, current: event.point, rotation: modifiers?.shift ? snapAngle(raw) : raw };
    }
  }
}

/** Shift = 约束单轴移动（取位移较大的轴）。 */
function constrainDelta(raw: Point, modifiers: Modifiers | undefined): Point {
  if (!modifiers?.shift) return raw;
  return Math.abs(raw.x) >= Math.abs(raw.y) ? { x: raw.x, y: 0 } : { x: 0, y: raw.y };
}

/**
 * 按比例缩放的指针锁定：把指针投影到「锚点 → 指针」的方向并按起始宽高比归一，
 * 供 `resizeRotatedNode` 在 proportional 模式下使用（避免两段比例修正叠加）。
 */
function aspectLockedPointer(state: ResizeInteraction, pointer: Point): Point {
  const s = normalizeRect(state.startBounds);
  const anchor = handlePoint(s, oppositeHandle(state.handle));
  const center = boundsCenter(s);
  const localAnchor = addPoints(
    center,
    rotateVector(subtractPoints(anchor, center), -state.rotation),
  );
  const localPointer = addPoints(
    center,
    rotateVector(subtractPoints(pointer, center), -state.rotation),
  );
  const dx = localPointer.x - localAnchor.x;
  const dy = localPointer.y - localAnchor.y;
  if (s.width === 0 || s.height === 0) return pointer;
  const ratio = s.width / s.height;
  const projected =
    Math.abs(dx) / ratio >= Math.abs(dy)
      ? { x: localPointer.x, y: localAnchor.y + (dy < 0 ? -1 : 1) * (Math.abs(dx) / ratio) }
      : { x: localAnchor.x + (dx < 0 ? -1 : 1) * Math.abs(dy) * ratio, y: localPointer.y };
  return addPoints(center, rotateVector(subtractPoints(projected, center), state.rotation));
}

/** 对移动应用吸附（对象对齐 + 网格），返回修正后的位移与参考线数据。 */
export function applySnapToMove(
  context: InteractionContext,
  nodeIds: readonly NodeId[],
  delta: Point,
): { delta: Point; snap: SnapResult } {
  if (context.snapEnabled === false || nodeIds.length === 0) return { delta, snap: NO_SNAP };
  const bounds = worldBoundsOfNodes(context.page, nodeIds);
  if (!bounds) return { delta, snap: NO_SNAP };
  const threshold = snapThresholdWorld(context.zoom);
  const moved = translateRect(bounds, delta.x, delta.y);

  // 网格吸附（C8）：页面开启时优先
  if (context.grid?.snapToGrid === true && context.grid.size > 0) {
    const grid = snapRectToGrid(moved, context.grid.size, threshold);
    if (grid.dx !== 0 || grid.dy !== 0) {
      return {
        delta: { x: delta.x + grid.dx, y: delta.y + grid.dy },
        snap: { dx: grid.dx, dy: grid.dy, guides: [], measurements: [] },
      };
    }
  }

  const targets: SnapTarget[] = [...snapTargetsFromPage(context.page, nodeIds)];
  for (const target of context.extraTargets ?? []) targets.push(target);
  const snap = computeSnap(moved, targets, { threshold });
  return { delta: { x: delta.x + snap.dx, y: delta.y + snap.dy }, snap };
}

/** 结束交互并产出命令（松手提交；无变化返回空数组）。 */
export function commitInteraction(
  state: InteractionState,
  context: InteractionContext,
): { commands: Command[]; state: InteractionState } {
  switch (state.kind) {
    case 'idle':
    case 'pan':
    case 'marquee':
      return { commands: [], state: IDLE };
    case 'move': {
      if (state.delta.x === 0 && state.delta.y === 0) return { commands: [], state: IDLE };
      return {
        commands: moveNodesByWorldCommands(context.page, state.pageId, state.nodeIds, state.delta),
        state: IDLE,
      };
    }
    case 'resize':
      return { commands: resizeCommands(context, state), state: IDLE };
    case 'rotate': {
      if (state.rotation === 0) return { commands: [], state: IDLE };
      const commands: Command[] = state.nodeIds.map((id) => ({
        type: 'node.update',
        pageId: state.pageId,
        nodeId: id,
        patch: { rotation: round6((state.startRotations[id] ?? 0) + state.rotation) },
      }));
      return { commands, state: IDLE };
    }
  }
}

/** 取消交互（Esc/失焦）：丢弃预览。 */
export function cancelInteraction(_state: InteractionState): InteractionState {
  return IDLE;
}

/** 缩放解算 → 命令。 */
function resizeCommands(context: InteractionContext, state: ResizeInteraction): Command[] {
  const start = normalizeRect(state.startBounds);
  const next = normalizeRect(state.nextBounds);
  const scaleX = start.width === 0 ? 1 : next.width / start.width;
  const scaleY = start.height === 0 ? 1 : next.height / start.height;

  if (state.nodeIds.length === 1) {
    const nodeId = state.nodeIds[0] as NodeId;
    const node = resolveNode(context.page, nodeId);
    if (!node) return [];
    const width = round6(node.width * scaleX);
    const height = round6(node.height * scaleY);
    if (
      width === node.width &&
      height === node.height &&
      next.x === start.x &&
      next.y === start.y
    ) {
      return [];
    }
    // 世界中心 → 节点父坐标系中心，再反推左上角（旋转节点同样成立：旋转绕中心）
    const centerWorld = boundsCenter(next);
    const localCenter = applyToPoint(frameMatrixOf(context.page, nodeId), centerWorld);
    return [
      {
        type: 'node.update',
        pageId: state.pageId,
        nodeId,
        patch: {
          width,
          height,
          x: round6(localCenter.x - width / 2),
          y: round6(localCenter.y - height / 2),
        },
      },
    ];
  }

  // 多选：按各自包围盒相对起始集合盒的比例缩放（不含旋转，P0 子集）
  const commands: Command[] = [];
  for (const nodeId of state.nodeIds) {
    const node = resolveNode(context.page, nodeId);
    const bounds = worldBoundsOfNode(context.page, nodeId);
    if (!node || !bounds) continue;
    commands.push({
      type: 'node.update',
      pageId: state.pageId,
      nodeId,
      patch: {
        x: round6(next.x + (bounds.x - start.x) * scaleX),
        y: round6(next.y + (bounds.y - start.y) * scaleY),
        width: round6(node.width * scaleX),
        height: round6(node.height * scaleY),
      },
    });
  }
  return commands;
}

/** 节点父坐标系的逆矩阵。 */
function frameMatrixOf(page: ScenePage, nodeId: NodeId): Matrix {
  const parentId = parentIdOf(page, nodeId);
  const matrix =
    parentId === null ? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } : worldMatrix(page, parentId);
  return invert(matrix);
}

/** 框选矩形（世界坐标，已归一化）。 */
export function marqueeRect(state: MarqueeInteraction): Rect {
  return normalizeRect({
    x: state.start.x,
    y: state.start.y,
    width: state.current.x - state.start.x,
    height: state.current.y - state.start.y,
  });
}

/** 框选结果 → 新选择集（调用方传入命中测试函数，保持依赖单向）。 */
export function marqueeSelectionOf(
  state: InteractionState,
  context: InteractionContext,
  hitTest: (page: ScenePage, rect: Rect, mode: 'intersect' | 'contain') => NodeId[],
): NodeId[] {
  if (state.kind !== 'marquee') return [];
  const rect = marqueeRect(state);
  if (rect.width === 0 && rect.height === 0) return [];
  const hits = hitTest(context.page, rect, 'intersect');
  if (!state.additive) return hits;
  return [...new Set([...state.baseSelection, ...hits])];
}

/** 旋转预览：节点 → 预览角度。 */
export function rotatePreview(state: RotateInteraction): Record<NodeId, number> {
  const out: Record<NodeId, number> = {};
  for (const id of state.nodeIds) out[id] = (state.startRotations[id] ?? 0) + state.rotation;
  return out;
}

/** 拖动预览：节点 → 世界位移。 */
export function movePreview(state: MoveInteraction): Record<NodeId, Point> {
  const out: Record<NodeId, Point> = {};
  for (const id of state.nodeIds) out[id] = state.delta;
  return out;
}

/** 平移预览：视口应施加的屏幕增量。 */
export function panDelta(state: PanInteraction): Point {
  return {
    x: state.currentScreen.x - state.startScreen.x,
    y: state.currentScreen.y - state.startScreen.y,
  };
}

function addPoints(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtractPoints(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
