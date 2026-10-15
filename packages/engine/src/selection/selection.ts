/**
 * 选择模型（单选/多选/混选）。
 *
 * 口径（briefs/_shared.md §3）：**选中集是 UI 态**（归宿在 Zustand 侧），
 * 但选择模型与**其派生几何/对齐计算在本包**——本模块因此是纯数据结构 + 纯函数，
 * 不持有任何全局状态，也不写文档（写路径一律经命令栈）。
 */

import { unionBounds } from '../geometry/bounds';
import { worldBoundsOfNode } from '../geometry/transform';
import type { Rect } from '../geometry/types';
import type { NodeId, SceneNode, ScenePage } from '../model/index';
import { isContainer } from '../model/index';
import { resolveNode, topmostIds } from '../scene/query';

/** 选择集。 */
export interface Selection {
  /** 选中 id（顺序 = 用户选择顺序；渲染高亮用）。 */
  ids: NodeId[];
  /** 主选中（Inspector 显示的对象）。 */
  activeId: NodeId | null;
}

/** 空选择。 */
export const EMPTY_SELECTION: Selection = { ids: [], activeId: null };

/** 构造选择集。 */
export function createSelection(ids: readonly NodeId[] = [], activeId?: NodeId): Selection {
  const unique = [...new Set(ids)];
  const active = activeId ?? unique[unique.length - 1] ?? null;
  return { ids: unique, activeId: active };
}

/** 单选。 */
export function selectOnly(id: NodeId | null): Selection {
  return id === null ? EMPTY_SELECTION : { ids: [id], activeId: id };
}

/** 追加（已存在则忽略）。 */
export function addToSelection(selection: Selection, id: NodeId): Selection {
  if (selection.ids.includes(id)) return { ...selection, activeId: id };
  return { ids: [...selection.ids, id], activeId: id };
}

/** 移除。 */
export function removeFromSelection(selection: Selection, id: NodeId): Selection {
  const ids = selection.ids.filter((existing) => existing !== id);
  const activeId = selection.activeId === id ? (ids[ids.length - 1] ?? null) : selection.activeId;
  return { ids, activeId };
}

/** 切换（Shift 点击）。 */
export function toggleSelection(selection: Selection, id: NodeId): Selection {
  return selection.ids.includes(id)
    ? removeFromSelection(selection, id)
    : addToSelection(selection, id);
}

/** 整体替换（框选）。 */
export function setSelection(selection: Selection, ids: readonly NodeId[]): Selection {
  void selection;
  return createSelection(ids);
}

/** 清空。 */
export function clearSelection(): Selection {
  return EMPTY_SELECTION;
}

/** 是否选中。 */
export function isSelected(selection: Selection, id: NodeId): boolean {
  return selection.ids.includes(id);
}

/** 选中数量。 */
export function selectionSize(selection: Selection): number {
  return selection.ids.length;
}

/** 是否多选。 */
export function isMultiSelection(selection: Selection): boolean {
  return selection.ids.length > 1;
}

/** 选择集的世界包围盒（并集）。 */
export function selectionBounds(page: ScenePage, selection: Selection): Rect | null {
  const rects: Rect[] = [];
  for (const id of selection.ids) {
    const bounds = worldBoundsOfNode(page, id);
    if (bounds) rects.push(bounds);
  }
  return unionBounds(rects);
}

/** 选择集的视图节点（虚 id 走实例解析）。 */
export function selectionNodes(page: ScenePage, selection: Selection): SceneNode[] {
  const out: SceneNode[] = [];
  for (const id of selection.ids) {
    const node = resolveNode(page, id);
    if (node) out.push(node);
  }
  return out;
}

/**
 * 单选规则（点击）：
 * - 点空白 → 清空；
 * - Shift → 切换；其它 → 单选（若已选中的集合被点到，保持集合以便整体拖动）。
 */
export function clickSelection(
  selection: Selection,
  hitTarget: NodeId | null,
  modifiers: { shift?: boolean; meta?: boolean } = {},
): Selection {
  if (hitTarget === null) return modifiers.shift ? selection : EMPTY_SELECTION;
  if (modifiers.shift) return toggleSelection(selection, hitTarget);
  if (selection.ids.includes(hitTarget)) return { ...selection, activeId: hitTarget };
  return selectOnly(hitTarget);
}

/** 规范化选择集：剔除不存在节点，并把「父子同时选中」规约成上层。 */
export function normalizeNodeSelection(page: ScenePage, ids: readonly NodeId[]): NodeId[] {
  const existing = ids.filter((id) => resolveNode(page, id) !== undefined);
  return topmostIds(page, existing);
}

/**
 * 混选取值（C6「混选『—』」）：所有选中节点的该属性一致 → 返回值；不一致 → undefined。
 */
export function commonValue<T>(
  page: ScenePage,
  selection: Selection,
  read: (node: SceneNode) => T,
): T | undefined {
  const nodes = selectionNodes(page, selection);
  if (nodes.length === 0) return undefined;
  const first = read(nodes[0] as SceneNode);
  for (const node of nodes.slice(1)) {
    if (read(node) !== first) return undefined;
  }
  return first;
}

/** 是否存在混合值（Inspector 显示「—」）。 */
export function hasMixedValue<T>(
  page: ScenePage,
  selection: Selection,
  read: (node: SceneNode) => T,
): boolean {
  return (
    selectionNodes(page, selection).length > 1 && commonValue(page, selection, read) === undefined
  );
}

/** 选择集内的类型分布（Inspector 分区显隐用）。 */
export function selectionKinds(page: ScenePage, selection: Selection): string[] {
  return [...new Set(selectionNodes(page, selection).map((node) => node.type))];
}

/** 选择集共同父级（多选且同父时返回该父；否则 null）。 */
export function commonParentId(page: ScenePage, selection: Selection): NodeId | null | undefined {
  if (selection.ids.length === 0) return undefined;
  const parents = new Set<string | null>();
  for (const id of selection.ids) {
    parents.add(parentIdOfSelection(page, id));
  }
  return parents.size === 1 ? ([...parents][0] as NodeId | null) : undefined;
}

function parentIdOfSelection(page: ScenePage, id: NodeId): NodeId | null {
  if (page.rootIds.includes(id)) return null;
  for (const node of Object.values(page.nodes)) {
    if (isContainer(node) && node.children.includes(id)) return node.id;
  }
  return null;
}
