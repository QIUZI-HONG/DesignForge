/**
 * 场景查询（只读、纯函数）。
 *
 * 索引：`PageIndex` 一次性建立「父 → 子」表；热路径（渲染/命中/图层面板）复用同一份索引，
 * 冷路径（测试、单次查询）用便捷函数按需建索引。
 * 实例的「子节点」是虚节点，统一经 `getChildrenIds` 暴露（`scene/instance.ts` 解析）。
 */

import type { NodeId, SceneNode, ScenePage } from '../model/index';
import { isContainer, isInstanceNode } from '../model/index';
import {
  applyNodePatch,
  overriddenKeysOf,
  overrideAt,
  parseVirtualNodeId,
  resolveInstanceTree,
  resolveVirtualNode,
} from './instance';

/** 页面索引。 */
export interface PageIndex {
  parentOf: Map<NodeId, NodeId | null>;
  childrenOf: Map<NodeId, NodeId[]>;
}

/** 建立页面索引（O(n)）。 */
export function createPageIndex(page: ScenePage): PageIndex {
  const parentOf = new Map<NodeId, NodeId | null>();
  const childrenOf = new Map<NodeId, NodeId[]>();
  for (const id of page.rootIds) {
    parentOf.set(id, null);
  }
  for (const node of Object.values(page.nodes)) {
    if (!isContainer(node)) continue;
    childrenOf.set(node.id, [...node.children]);
    for (const childId of node.children) {
      parentOf.set(childId, node.id);
    }
  }
  return { parentOf, childrenOf };
}

/** 取真实节点（不含实例虚节点）。 */
export function getNode(page: ScenePage, id: NodeId): SceneNode | undefined {
  return page.nodes[id];
}

/** 取真实节点，缺失即抛错（命令处理器的前置校验用）。 */
export function requireNode(page: ScenePage, id: NodeId): SceneNode {
  const node = page.nodes[id];
  if (!node) throw new Error(`节点不存在：${id}`);
  return node;
}

/** 页面里是否存在该真实节点。 */
export function hasNode(page: ScenePage, id: NodeId): boolean {
  return Object.hasOwn(page.nodes, id);
}

/**
 * 解析任意节点 id 为视图节点（覆盖已应用）：
 * 真实 id 直取；虚 id 走实例解析。
 */
export function resolveNode(page: ScenePage, id: NodeId): SceneNode | undefined {
  const real = page.nodes[id];
  if (real) return real;
  const lookup = resolveVirtualNode(page, id);
  if (!lookup) return undefined;
  return lookup.tree.node;
}

/**
 * 取子节点 id 列表：
 * - `parentId === null` → 页面顶层（绘制顺序，后者在上）；
 * - 容器 → `children`；
 * - 实例 → 主组件解析出的虚 id；
 * - 虚节点 → 其虚子 id；叶子 → 空。
 */
export function getChildrenIds(page: ScenePage, parentId: NodeId | null): NodeId[] {
  if (parentId === null) return [...page.rootIds];
  const node = resolveNode(page, parentId);
  if (!node) return [];
  if (isInstanceNode(node)) {
    const tree = resolveInstanceTree(page, node.id);
    return tree ? tree.children.map((child) => child.virtualId) : [];
  }
  if (isContainer(node)) return [...node.children];
  return [];
}

/** 取父 id：顶层为 null；虚节点返回其父虚 id。 */
export function getParentId(page: ScenePage, id: NodeId): NodeId | null {
  if (parseVirtualNodeId(id)) {
    const lookup = resolveVirtualNode(page, id);
    return lookup ? lookup.parentVirtualId : null;
  }
  if (page.rootIds.includes(id)) return null;
  for (const node of Object.values(page.nodes)) {
    if (isContainer(node) && node.children.includes(id)) return node.id;
  }
  return null;
}

/** 从父到根的祖先链（不含自身）。 */
export function getAncestors(page: ScenePage, id: NodeId): NodeId[] {
  const chain: NodeId[] = [];
  let current = getParentId(page, id);
  let guard = 0;
  while (current !== null) {
    chain.push(current);
    current = getParentId(page, current);
    guard += 1;
    if (guard > 100_000) throw new Error('节点树出现环——文档已损坏');
  }
  return chain;
}

/** 顶层祖先（页面根下的那一层；自身为顶层时返回自身）。 */
export function getTopmostAncestor(page: ScenePage, id: NodeId): NodeId {
  const chain = getAncestors(page, id);
  return chain.length > 0 ? (chain[chain.length - 1] as NodeId) : id;
}

/** `id` 是否 `ancestorId` 的后代。 */
export function isDescendantOf(page: ScenePage, id: NodeId, ancestorId: NodeId): boolean {
  return getAncestors(page, id).includes(ancestorId);
}

/** 子树内所有**真实**节点 id（前序；实例视为叶子，不展开虚子树）。 */
export function getDescendantIds(page: ScenePage, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const stack: NodeId[] = [id];
  while (stack.length > 0) {
    const current = stack.pop() as NodeId;
    const node = page.nodes[current];
    if (!node || !isContainer(node)) continue;
    for (const childId of node.children) {
      out.push(childId);
      stack.push(childId);
    }
  }
  return out;
}

/** 子树内所有节点 id（含实例虚 id，前序）。 */
export function getSubtreeIds(page: ScenePage, id: NodeId): NodeId[] {
  const out: NodeId[] = [id];
  const stack: NodeId[] = [...getChildrenIds(page, id)].reverse();
  while (stack.length > 0) {
    const current = stack.pop() as NodeId;
    out.push(current);
    const children = getChildrenIds(page, current);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i] as NodeId);
    }
  }
  return out;
}

/** 深度优先遍历子树（含视图节点）。 */
export function walkSubtree(
  page: ScenePage,
  id: NodeId,
  visit: (node: SceneNode, id: NodeId) => void,
): void {
  for (const current of getSubtreeIds(page, id)) {
    const node = resolveNode(page, current);
    if (node) visit(node, current);
  }
}

/** 该 id 上的覆盖键（虚节点专属；真实节点为空表）。 */
export function overriddenKeysOfId(page: ScenePage, id: NodeId): string[] {
  const parsed = parseVirtualNodeId(id);
  if (!parsed) return [];
  const instance = page.nodes[parsed.instanceId];
  if (!instance || !isInstanceNode(instance)) return [];
  return overriddenKeysOf(overrideAt(instance.overrides, parsed.path));
}

/** 取虚节点应用覆盖后的视图（真实节点返回自身）。 */
export function viewNodeOf(page: ScenePage, id: NodeId): SceneNode | undefined {
  const parsed = parseVirtualNodeId(id);
  if (!parsed) return page.nodes[id];
  const lookup = resolveVirtualNode(page, id);
  if (!lookup) return undefined;
  const instance = page.nodes[parsed.instanceId];
  if (instance && isInstanceNode(instance)) {
    const patch = overrideAt(instance.overrides, parsed.path);
    if (patch) return applyNodePatch(lookup.tree.node, patch);
  }
  return lookup.tree.node;
}

/**
 * 从候选集合中剔除「已被集合内其他节点包含」的节点，保留最上层者。
 * 框选与编组都用它把「父子同时命中」规约成顶层集合。
 */
export function topmostIds(page: ScenePage, ids: readonly NodeId[]): NodeId[] {
  const unique = [...new Set(ids)];
  return unique.filter((id) => {
    const ancestors = getAncestors(page, id);
    return !ancestors.some((ancestorId) => unique.includes(ancestorId));
  });
}

/** 按绘制顺序（页面顶层顺序）排序 id。 */
export function sortByZOrder(page: ScenePage, ids: readonly NodeId[]): NodeId[] {
  const order = new Map<NodeId, number>();
  page.rootIds.forEach((id, i) => {
    order.set(id, i);
  });
  const rank = (id: NodeId): number => {
    const topmost = getTopmostAncestor(page, id);
    return order.get(topmost) ?? Number.MAX_SAFE_INTEGER;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b));
}

/** 图层面板用的层级树节点。 */
export interface LayerTreeNode {
  id: NodeId;
  node: SceneNode;
  overriddenKeys: string[];
  children: LayerTreeNode[];
}

/** 构造层级树（不给 `rootId` 则返回页面顶层；顺序与绘制顺序一致）。 */
export function layerTree(page: ScenePage, rootId?: NodeId): LayerTreeNode[] {
  const build = (id: NodeId): LayerTreeNode => {
    const node = resolveNode(page, id) as SceneNode;
    return {
      id,
      node,
      overriddenKeys: overriddenKeysOfId(page, id),
      children: getChildrenIds(page, id).map(build),
    };
  };
  const roots = rootId === undefined ? page.rootIds : getChildrenIds(page, rootId);
  return roots.map(build);
}

/** 按条件查找真实节点（图层面板搜索、命令面板用）。 */
export function findNodes(
  page: ScenePage,
  predicate: (node: SceneNode, id: NodeId) => boolean,
): Array<{ id: NodeId; node: SceneNode }> {
  const out: Array<{ id: NodeId; node: SceneNode }> = [];
  for (const id of Object.keys(page.nodes)) {
    const node = page.nodes[id];
    if (node && predicate(node, id)) out.push({ id, node });
  }
  return out;
}

/** 页面顶层节点（按绘制顺序）。 */
export function getRootNodes(page: ScenePage): SceneNode[] {
  return page.rootIds
    .map((id) => page.nodes[id])
    .filter((node): node is SceneNode => node !== undefined);
}

/** 节点总数（含实例虚子树；状态栏/性能基线用）。 */
export function countNodes(page: ScenePage): number {
  let count = 0;
  for (const id of page.rootIds) count += getSubtreeIds(page, id).length;
  return count;
}
