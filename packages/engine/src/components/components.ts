/**
 * 组件系统：主组件 ↔ 实例、覆盖与重置、变体（C17）。
 *
 * 子集口径：
 * - 「提升为主组件」= 以选中并集边界创建组件容器并把选中节点移入（世界形状不变）；
 * - 实例**不复制子树**（解析见 `scene/instance.ts`），覆盖走 `instance.*` 命令；
 * - 变体 = 同一组件集（component_set）下的若干主组件，按属性维度笛卡尔积索引。
 */

import { parentIdOf, wrapIntoContainerCommands } from '../commands/helpers';
import type { Command } from '../commands/types';
import { worldBoundsOfNodes } from '../geometry/transform';
import type { IdFactory } from '../model/ids';
import { ID_PREFIX, systemIdFactory } from '../model/ids';
import type {
  ComponentId,
  ComponentNode,
  ComponentSetNode,
  NodeId,
  NodePatch,
  PageId,
  PatchableKey,
  ScenePage,
} from '../model/index';
import { createComponent, createInstance, isComponentNode } from '../model/index';
import { domainError } from '../scene/errors';
import { sortByZOrder, topmostIds } from '../scene/index';
import { parseVirtualNodeId } from '../scene/instance';
import { getChildrenIds } from '../scene/query';

/** 组件清单项（C4 资产面板）。 */
export interface ComponentEntry {
  id: ComponentId;
  node: ComponentNode;
  name: string;
  /** 变体属性（非变体为 null）。 */
  variantProperties: Record<string, string> | null;
  componentSetId: ComponentId | null;
  /** 该主组件的实例数（同页面内统计）。 */
  instanceCount: number;
}

/** 列出页面内全部主组件（按名称排序，稳定输出）。 */
export function listComponents(page: ScenePage): ComponentEntry[] {
  const entries: ComponentEntry[] = [];
  for (const node of Object.values(page.nodes)) {
    if (!isComponentNode(node)) continue;
    entries.push({
      id: node.id,
      node,
      name: node.name,
      variantProperties: node.variantProperties,
      componentSetId: node.componentSetId,
      instanceCount: countInstancesOf(page, node.id),
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** 列出组件集。 */
export function listComponentSets(page: ScenePage): ComponentSetNode[] {
  return Object.values(page.nodes).filter(
    (node): node is ComponentSetNode => node.type === 'component_set',
  );
}

/** 某主组件的实例数量。 */
export function countInstancesOf(page: ScenePage, componentId: ComponentId): number {
  let count = 0;
  for (const node of Object.values(page.nodes)) {
    if (node.type === 'instance' && node.componentId === componentId) count += 1;
  }
  return count;
}

/**
 * 提升为主组件：以选中节点并集为边界创建组件容器，并把选中节点移入（世界形状不变）。
 * 与编组同构，只是容器类型为 `component`（C17「创建组件」）。
 */
export function createComponentCommands(
  page: ScenePage,
  pageId: PageId,
  nodeIds: readonly NodeId[],
  options: {
    componentId?: ComponentId;
    name?: string;
    variantProperties?: Record<string, string>;
    componentSetId?: ComponentId;
    ids?: IdFactory;
  } = {},
): Command[] {
  const roots = sortByZOrder(page, topmostIds(page, nodeIds));
  if (roots.length === 0) return [];
  const bounds = worldBoundsOfNodes(page, roots);
  if (!bounds) return [];
  const parents = new Set(roots.map((id) => parentIdOf(page, id)));
  if (parents.size > 1) {
    throw domainError('invalid-argument', '创建组件要求所选节点处于同一父级');
  }

  const ids = options.ids ?? systemIdFactory;
  const componentId = options.componentId ?? ids.next(ID_PREFIX.component);
  const component = createComponent({
    id: componentId,
    name: options.name ?? '组件',
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    variantProperties: options.variantProperties ?? null,
    componentSetId: options.componentSetId ?? null,
  });
  return wrapIntoContainerCommands(page, pageId, roots, component);
}

/** 创建实例（C17：拖主组件到画布/右键创建）。 */
export function instantiateComponentCommands(
  page: ScenePage,
  pageId: PageId,
  componentId: ComponentId,
  options: {
    instanceId?: NodeId;
    parentId?: NodeId | null;
    index?: number;
    x?: number;
    y?: number;
    ids?: IdFactory;
  } = {},
): Command[] {
  const component = page.nodes[componentId];
  if (!component || !isComponentNode(component)) {
    throw domainError('not-a-component', `主组件不存在：${componentId}`);
  }
  const ids = options.ids ?? systemIdFactory;
  const instanceId = options.instanceId ?? ids.next(ID_PREFIX.instance);
  const parentId = options.parentId ?? null;
  const x = options.x ?? component.x + component.width + 40;
  const y = options.y ?? component.y;
  const instance = createInstance({
    id: instanceId,
    name: component.name,
    x,
    y,
    width: component.width,
    height: component.height,
    rotation: component.rotation,
    visible: component.visible,
    locked: component.locked,
    opacity: component.opacity,
    fills: component.fills,
    strokes: component.strokes,
    effects: component.effects,
    cornerRadius: component.cornerRadius,
    componentId: component.id,
  });
  return [{ type: 'node.insert', pageId, node: instance, parentId, index: options.index }];
}

/** 实例覆盖表（虚路径 → 补丁）。 */
export function instanceOverrides(page: ScenePage, instanceId: NodeId): Record<string, NodePatch> {
  const node = page.nodes[instanceId];
  if (node?.type !== 'instance') {
    throw domainError('not-an-instance', `节点不是实例：${instanceId}`);
  }
  return node.overrides;
}

/** 重置实例的（部分）覆盖：`paths` 省略则清空全部。 */
export function resetOverrideCommands(
  pageId: PageId,
  instanceId: NodeId,
  paths?: readonly NodeId[][],
): Command[] {
  const commands: Command[] = [];
  for (const path of paths ?? [[]]) {
    commands.push({ type: 'instance.resetOverride', pageId, instanceId, path: [...path] });
  }
  return commands;
}

/** 某虚节点的属性覆盖键（C17「覆盖重置」按钮的可用性）。 */
export function overrideKeysOf(page: ScenePage, virtualId: NodeId): PatchableKey[] {
  const parsed = parseVirtualNodeId(virtualId);
  if (!parsed) return [];
  const instance = page.nodes[parsed.instanceId];
  if (instance?.type !== 'instance') return [];
  const patch = instance.overrides[parsed.path.join('/')];
  return patch ? (Object.keys(patch) as PatchableKey[]) : [];
}

/**
 * 变体索引：组件集下所有变体的属性组合 → 组件 id。
 * 键为属性对排序后的稳定串（`size=large,state=hover`）。
 */
export function variantIndex(page: ScenePage, setId: ComponentId): Record<string, ComponentId> {
  const set = page.nodes[setId];
  if (set?.type !== 'component_set') {
    throw domainError('invalid-argument', `组件集不存在：${setId}`);
  }
  const index: Record<string, ComponentId> = {};
  for (const childId of getChildrenIds(page, setId)) {
    const child = page.nodes[childId];
    if (!child || !isComponentNode(child) || child.variantProperties === null) continue;
    index[variantKey(child.variantProperties)] = child.id;
  }
  return index;
}

/** 变体属性 → 稳定键。 */
export function variantKey(properties: Record<string, string>): string {
  return Object.keys(properties)
    .sort()
    .map((key) => `${key}=${properties[key]}`)
    .join(',');
}

/** 在组件集内按属性查找变体组件。 */
export function findVariant(
  page: ScenePage,
  setId: ComponentId,
  properties: Record<string, string>,
): ComponentId | null {
  const index = variantIndex(page, setId);
  const key = variantKey(properties);
  if (index[key]) return index[key] as ComponentId;
  // 属性不完全匹配时，退化为「包含所选属性」的第一个变体（Figma 的部分匹配手感）
  for (const [candidateKey, candidateId] of Object.entries(index)) {
    const parts = new Set(candidateKey.split(','));
    if (Object.entries(properties).every(([k, v]) => parts.has(`${k}=${v}`))) return candidateId;
  }
  return null;
}

/** 切换变体（实例指向新的主组件），覆盖表保留。 */
export function switchVariantCommands(
  page: ScenePage,
  pageId: PageId,
  instanceId: NodeId,
  setId: ComponentId,
  properties: Record<string, string>,
): Command[] {
  const target = findVariant(page, setId, properties);
  if (!target) {
    throw domainError('not-a-component', `组件集内没有匹配的变体：${variantKey(properties)}`);
  }
  const instance = page.nodes[instanceId];
  if (instance?.type !== 'instance') {
    throw domainError('not-an-instance', `节点不是实例：${instanceId}`);
  }
  return [{ type: 'instance.switchVariant', pageId, instanceId, componentId: target }];
}

/** 实例当前指向的主组件。 */
export function mainComponentOf(page: ScenePage, instanceId: NodeId): ComponentNode | null {
  const instance = page.nodes[instanceId];
  if (instance?.type !== 'instance') return null;
  const component = page.nodes[instance.componentId];
  return component && isComponentNode(component) ? component : null;
}

/** 实例是否为「缺失主组件」状态（C17 提示）。 */
export function isDetached(page: ScenePage, instanceId: NodeId): boolean {
  return mainComponentOf(page, instanceId) === null;
}
