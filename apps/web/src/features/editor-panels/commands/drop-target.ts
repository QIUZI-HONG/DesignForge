/**
 * 拖拽落点解析（纯函数，seam：可见行序列 + 指针位置 → 引擎可用的移动目标）。
 *
 * 为什么单独成模块：DnD 的正确性几乎全在手感细节上（行的上/下四分区、放进容器、
 * 不许把自己的子树当作落点、同父下移的 off-by-one），把它们从 DOM 事件里剥出来，
 * 就能用真实夹具逐条断言；组件层只负责量行高、喂指针 Y。
 *
 * 下标坐标空间与 `moveLayerCommands` 一致：**摘除自身之后**的列表下标（引擎 `node.reparent` 语义）。
 */
import {
  getAncestors,
  getChildrenIds,
  type NodeId,
  parentIdOf,
  type ScenePage,
} from '@dforge/engine';

/** 可见行（面板渲染层从 DOM/metrics 提供；顺序 = 自上而下）。 */
export interface DropRow {
  id: NodeId;
  parentId: NodeId | null;
  /** 层级深度（0 = 顶层），仅用于显示缩进与断言。 */
  depth: number;
  /** 是否容器（可「放入」其内部）。 */
  container: boolean;
  /** 行上缘（与 `pointerY` 同一坐标系）。 */
  top: number;
  /** 行下缘。 */
  bottom: number;
}

/** 落点：新父级 + 下标 + 指示器画法。 */
export interface DropTarget {
  /** 新父级（null = 页面顶层）。 */
  parentId: NodeId | null;
  /** 摘除自身后的列表下标（直接交给 `moveLayerCommands`）。 */
  index: number;
  /** 指示器：行的上缘 / 下缘 / 行内（放入容器）。 */
  indicator: { rowId: NodeId; edge: 'top' | 'bottom' | 'inside' };
}

/** 行内的落点分区（相对行高的比例）。 */
const EDGE_RATIO = 0.25;

/**
 * 解析落点。
 *
 * 规则：
 * - 行内上 25% → 插到该行**之前**；下 25% → 插到该行**之后**；中间 50% 且该行是容器 → **放入**；
 * - 指针在首行之上 → 插到首行之前（顶层）；在末行之下 → 插到末行之后；
 * - 落点是否有效：不能落在自身、也不能落在自身的子树里（引擎会拒环，这里提前判掉）；
 * - 本函数是**纯几何**的：落点恰好等于当前位置时也会返回目标，调用方用 `isNoopDrop`
 *   判定「无操作」（不显示指示器、不发命令）。
 */
export function resolveDropTarget(
  rows: readonly DropRow[],
  page: ScenePage,
  dragId: NodeId,
  pointerY: number,
): DropTarget | null {
  if (rows.length === 0) return null;
  const first = rows[0] as DropRow;
  const last = rows[rows.length - 1] as DropRow;

  const row =
    pointerY < first.top
      ? first
      : pointerY > last.bottom
        ? last
        : rows.find((candidate) => pointerY >= candidate.top && pointerY < candidate.bottom);
  if (row === undefined) return null;

  // 自身不可作为落点行（含「插到自己前后」：那是无操作）
  if (row.id === dragId) return null;
  // 子树内不可作为落点行
  if (isInSubtree(page, row.id, dragId)) return null;

  const ratio = row.bottom === row.top ? 0 : (pointerY - row.top) / (row.bottom - row.top);
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  // 首行之上的越界指针按「之前」处理，末行之下按「之后」处理
  const above = pointerY < first.top;
  const below = pointerY > last.bottom;

  if (
    !above &&
    !below &&
    row.container &&
    clampedRatio >= EDGE_RATIO &&
    clampedRatio < 1 - EDGE_RATIO
  ) {
    return guard(target(page, dragId, row.id, 'inside'), page, dragId);
  }
  const edge = above ? 'top' : below ? 'bottom' : clampedRatio < 0.5 ? 'top' : 'bottom';
  return guard(target(page, dragId, row.id, edge), page, dragId);
}

/** 构造落点（before/after 用行的兄弟、inside 用行自身作为父级）。 */
function target(
  page: ScenePage,
  dragId: NodeId,
  rowId: NodeId,
  edge: 'top' | 'bottom' | 'inside',
): DropTarget {
  if (edge === 'inside') {
    const parentId = rowId;
    const children = getChildrenIds(page, parentId).filter((id) => id !== dragId);
    return { parentId, index: children.length, indicator: { rowId, edge: 'inside' } };
  }
  const parentId = parentIdOf(page, rowId);
  const siblings = getChildrenIds(page, parentId).filter((id) => id !== dragId);
  const position = siblings.indexOf(rowId);
  const index = edge === 'top' ? position : position + 1;
  return { parentId, index, indicator: { rowId, edge: edge === 'top' ? 'top' : 'bottom' } };
}

/** 无效落点（自身子树内的父级）→ null。 */
function guard(targetValue: DropTarget, page: ScenePage, dragId: NodeId): DropTarget | null {
  if (targetValue.parentId !== null) {
    if (targetValue.parentId === dragId) return null;
    if (isInSubtree(page, targetValue.parentId, dragId)) return null;
  }
  return targetValue;
}

/** `id` 是否 `rootId` 的后代（不含自身）。 */
function isInSubtree(page: ScenePage, id: NodeId, rootId: NodeId): boolean {
  return getAncestors(page, id).includes(rootId);
}

/** 落点是否为无操作（同父且下标等于摘除后的原位）。 */
export function isNoopDrop(page: ScenePage, dragId: NodeId, targetValue: DropTarget): boolean {
  const currentParent = parentIdOf(page, dragId);
  if (currentParent !== targetValue.parentId) return false;
  const siblings = getChildrenIds(page, currentParent);
  const currentIndex = siblings.indexOf(dragId);
  return currentIndex === targetValue.index;
}
