/**
 * 实例解析：主组件 → 实例的「虚节点」视图（C17 主 ↔ 实例）。
 *
 * 设计（架构 v1.1 §4.1「实例持有覆盖表，不复制子树」）：
 * - 实例节点只存 `componentId` + `overrides`；子节点**不落盘**；
 * - 子节点以**虚 id** 表达：`${instanceId}::${主组件内节点 id，用 / 连接}`；
 * - 覆盖表键 = 从主组件根向下的路径（主组件内节点 id 连接），值 = `NodePatch`；
 * - 解析出的子节点坐标即**主组件局部坐标**：实例自身的变换（位置/旋转）由渲染层在世界矩阵中合成，
 *   因此整体移动/旋转实例时内容随之而动，解析本身不需要矩阵运算。
 *
 * P0 子集：不做实例缩放（resize 实例不改变内容布局）、不做嵌套实例的内部解析
 * （嵌套实例按不透明叶子处理）。
 */

import type { NodeId, NodePatch, PatchableKey, SceneNode, ScenePage } from '../model/index';
import { isContainer, isInstanceNode } from '../model/index';

/** 虚 id 分隔符。 */
const VIRTUAL_SEPARATOR = '::';

/** 覆盖表键（路径）分隔符。 */
const PATH_SEPARATOR = '/';

/** 解析树节点：真实节点 + 覆盖后的视图。 */
export interface ResolvedNodeTree {
  /** 视图节点（已应用覆盖；`children` 仍为主组件内真实 id）。 */
  node: SceneNode;
  /** 主组件内对应的真实节点 id（实例根即实例自身 id）。 */
  realId: NodeId;
  /** 对外暴露的 id：实例内节点为虚 id，根节点即实例自身 id。 */
  virtualId: NodeId;
  /** 从主组件根向下的路径（根为 `[]`）。 */
  path: NodeId[];
  /** 该节点被覆盖的属性键。 */
  overriddenKeys: PatchableKey[];
  children: ResolvedNodeTree[];
}

/** 虚节点解析结果（含父虚 id；根节点的父为 null）。 */
export interface VirtualNodeLookup {
  tree: ResolvedNodeTree;
  parentVirtualId: NodeId | null;
}

/** 由实例 id 与路径构造虚 id（路径为空即实例自身）。 */
export function virtualNodeId(instanceId: NodeId, path: readonly NodeId[]): NodeId {
  if (path.length === 0) return instanceId;
  return `${instanceId}${VIRTUAL_SEPARATOR}${path.join(PATH_SEPARATOR)}`;
}

/** 解析虚 id；非虚 id 返回 null。 */
export function parseVirtualNodeId(id: NodeId): { instanceId: NodeId; path: NodeId[] } | null {
  const index = id.indexOf(VIRTUAL_SEPARATOR);
  if (index <= 0) return null;
  const instanceId = id.slice(0, index);
  const rest = id.slice(index + VIRTUAL_SEPARATOR.length);
  if (rest.length === 0) return null;
  return { instanceId, path: rest.split(PATH_SEPARATOR) };
}

/** 覆盖表键：路径串联。 */
export function overrideKey(path: readonly NodeId[]): string {
  return path.join(PATH_SEPARATOR);
}

/** 把补丁应用到节点副本上（不改 id / type）。 */
export function applyNodePatch<T extends SceneNode>(node: T, patch: NodePatch): T {
  const next = { ...node } as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'id' || key === 'type') continue; // id/type 不可覆盖
    next[key] = value;
  }
  return next as unknown as T;
}

/** 补丁 → 被覆盖的属性键列表。 */
export function overriddenKeysOf(patch: NodePatch | undefined): PatchableKey[] {
  if (!patch) return [];
  return Object.keys(patch) as PatchableKey[];
}

/** 取某路径上的覆盖补丁。 */
export function overrideAt(
  overrides: Record<string, NodePatch>,
  path: readonly NodeId[],
): NodePatch | undefined {
  return overrides[overrideKey(path)];
}

/** 设置某路径的覆盖补丁（浅合并到既有补丁上）。 */
export function setOverrideAt(
  overrides: Record<string, NodePatch>,
  path: readonly NodeId[],
  patch: NodePatch,
): Record<string, NodePatch> {
  const key = overrideKey(path);
  const previous = overrides[key];
  return { ...overrides, [key]: previous ? { ...previous, ...patch } : { ...patch } };
}

/** 删除某路径的覆盖（`keys` 为空 = 整段重置，C17「覆盖重置」）。 */
export function clearOverrideAt(
  overrides: Record<string, NodePatch>,
  path: readonly NodeId[],
  keys?: readonly PatchableKey[],
): Record<string, NodePatch> {
  const key = overrideKey(path);
  const previous = overrides[key];
  if (!previous) return overrides;
  if (!keys || keys.length === 0) {
    const next = { ...overrides };
    delete next[key];
    return next;
  }
  const remaining: Record<string, unknown> = { ...previous };
  for (const k of keys) delete remaining[k];
  const next = { ...overrides };
  if (Object.keys(remaining).length === 0) {
    delete next[key];
  } else {
    next[key] = remaining as NodePatch;
  }
  return next;
}

/**
 * 由实例解析出完整虚子树（覆盖已应用）。
 * 实例的 componentId 悬空（主组件被删）时返回 null——图层与渲染据此显示「缺失主组件」。
 */
export function resolveInstanceTree(page: ScenePage, instanceId: NodeId): ResolvedNodeTree | null {
  const instance = page.nodes[instanceId];
  if (!instance || !isInstanceNode(instance)) return null;
  const component = page.nodes[instance.componentId];
  if (component?.type !== 'component') return null;

  const root: ResolvedNodeTree = {
    node: instance,
    realId: instanceId,
    virtualId: instanceId,
    path: [],
    overriddenKeys: [],
    children: [],
  };
  root.children = buildChildren(page, component, [], instanceId, instance.overrides);
  return root;
}

/** 递归构造子节点（路径随层数增长，覆盖按路径取）。 */
function buildChildren(
  page: ScenePage,
  container: SceneNode,
  parentPath: readonly NodeId[],
  instanceId: NodeId,
  overrides: Record<string, NodePatch>,
): ResolvedNodeTree[] {
  if (!isContainer(container)) return [];
  const out: ResolvedNodeTree[] = [];
  for (const childId of container.children) {
    const child = page.nodes[childId];
    if (!child) continue; // 主组件内的悬空引用：解析跳过（`validatePage` 会报结构问题）
    const path = [...parentPath, childId];
    const patch = overrideAt(overrides, path);
    const node = patch ? applyNodePatch(child, patch) : child;
    out.push({
      node,
      realId: childId,
      virtualId: virtualNodeId(instanceId, path),
      path,
      overriddenKeys: overriddenKeysOf(patch),
      children: buildChildren(page, node, path, instanceId, overrides),
    });
  }
  return out;
}

/** 按虚 id 精确解析（返回该节点 + 其父虚 id）。 */
export function resolveVirtualNode(page: ScenePage, virtualId: NodeId): VirtualNodeLookup | null {
  const parsed = parseVirtualNodeId(virtualId);
  if (!parsed) return null;
  const root = resolveInstanceTree(page, parsed.instanceId);
  if (!root) return null;
  let current: ResolvedNodeTree = root;
  let parentVirtualId: NodeId | null = null;
  for (const segment of parsed.path) {
    const next = current.children.find((child) => child.realId === segment);
    if (!next) return null;
    parentVirtualId = current.virtualId;
    current = next;
  }
  return { tree: current, parentVirtualId };
}

/** 实例虚节点的子节点 id 列表（子节点为虚 id）。 */
export function getVirtualChildrenIds(page: ScenePage, virtualId: NodeId): NodeId[] {
  const lookup = resolveVirtualNode(page, virtualId);
  if (!lookup) return [];
  return lookup.tree.children.map((child) => child.virtualId);
}
