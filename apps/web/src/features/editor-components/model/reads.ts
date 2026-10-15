/**
 * C17 选中态读取：把「当前选择是什么」翻译成面板可渲染的稳定形状。
 *
 * 为什么单独成模块：组件面板、右键菜单与命令面板（E7）都要问同一个问题
 *（选中是主组件/实例/普通节点？能不能创建组件？），口径必须只有一处——
 * 判定一律走引擎谓词（`isComponentNode` / `isInstanceNode` / `getParentId`），
 * 本模块只做归类与投影，不重复实现引擎语义。
 */

import {
  type ComponentId,
  type ComponentNode,
  countInstancesOf,
  getChildrenIds,
  getParentId,
  isComponentNode,
  isInstanceNode,
  mainComponentOf,
  type NodeId,
  parseVirtualNodeId,
  resolveNode,
  type SceneNode,
  type ScenePage,
  type Selection,
  selectionNodes,
} from '@dforge/engine';

/** 选中态类别（面板据此切换内容）。 */
export type ComponentSelectionKind =
  | 'none'
  | 'plain'
  | 'mixed'
  | 'component'
  | 'component_set'
  | 'instance';

/** 选中态读取结果。 */
export interface ComponentSelectionRead {
  kind: ComponentSelectionKind;
  /** 选中节点数。 */
  count: number;
  /** 单选时的视图节点（覆盖已应用）；多选或空选为 null。 */
  node: SceneNode | null;
  /** 主组件：选中组件自身，或实例指向的主组件（悬空实例为 null）。 */
  mainComponent: ComponentNode | null;
  /** 主组件名（面板提示「实例 · 主组件名」用）。 */
  mainComponentName: string | null;
  /** 实例：主组件缺失（C17 提示「缺失主组件」）。 */
  detached: boolean;
  /** 实例：覆盖表条数（含子路径）。 */
  overrideCount: number;
  /** 变体属性（组件或实例主组件所属变体；非变体为 null）。 */
  variantProperties: Record<string, string> | null;
  /** 所属组件集 id（非变体为 null）。 */
  componentSetId: ComponentId | null;
  /** 组件集：变体数（选中组件集时）。 */
  variantCount: number;
  /** 选中组件时的实例计数（同页面）。 */
  instanceCount: number;
}

/** 「创建组件」不可用的原因（UI 映射为文案；编码稳定供测试断言）。 */
export type CreateComponentBlockedReason =
  | 'empty'
  | 'multiple-parents'
  | 'instance-content'
  | 'contains-component';

/** 「创建组件」可用性判定结果。 */
export type CreateComponentCheck =
  | { ok: true }
  | { ok: false; reason: CreateComponentBlockedReason };

/** 读取选中态（面板 C17 的单一数据入口）。 */
export function readSelectionComponent(
  page: ScenePage,
  selection: Selection,
): ComponentSelectionRead {
  const nodes = selectionNodes(page, selection);
  const base: ComponentSelectionRead = {
    kind: 'none',
    count: selection.ids.length,
    node: null,
    mainComponent: null,
    mainComponentName: null,
    detached: false,
    overrideCount: 0,
    variantProperties: null,
    componentSetId: null,
    variantCount: 0,
    instanceCount: 0,
  };
  if (nodes.length === 0) return base;

  const single = nodes.length === 1 ? (selection.ids[0] as NodeId) : null;
  const singleNode = nodes.length === 1 ? nodes[0] : undefined;

  if (single !== null && singleNode !== undefined) {
    const mainComponent = mainComponentOf(page, single);
    const componentSetId = mainComponent?.componentSetId ?? null;
    const common = {
      count: 1,
      node: singleNode,
      mainComponentName: mainComponent?.name ?? null,
      variantProperties: mainComponent?.variantProperties ?? null,
      componentSetId,
    };
    if (isComponentNode(singleNode)) {
      return {
        ...base,
        ...common,
        kind: 'component',
        mainComponent: singleNode,
        mainComponentName: singleNode.name,
        variantProperties: singleNode.variantProperties,
        componentSetId: singleNode.componentSetId,
        variantCount: 0,
        instanceCount: countInstancesOf(page, singleNode.id),
      };
    }
    if (singleNode.type === 'component_set') {
      return {
        ...base,
        ...common,
        kind: 'component_set',
        variantCount: getChildrenIds(page, singleNode.id).length,
      };
    }
    if (isInstanceNode(singleNode)) {
      return {
        ...base,
        ...common,
        kind: 'instance',
        mainComponent,
        detached: mainComponent === null,
        overrideCount: Object.keys(singleNode.overrides).length,
      };
    }
    return { ...base, ...common, kind: 'plain' };
  }

  const kinds = new Set(nodes.map(classifyNodeKind));
  const uniform = kinds.size === 1;
  return {
    ...base,
    kind: uniform && kinds.has('plain') ? 'plain' : 'mixed',
    count: nodes.length,
    node: null,
  };
}

/** 单个节点的类别称谓（混选判定用；实例与组件视为不同类）。 */
function classifyNodeKind(node: SceneNode): 'plain' | 'component' | 'component_set' | 'instance' {
  if (isComponentNode(node)) return 'component';
  if (node.type === 'component_set') return 'component_set';
  if (isInstanceNode(node)) return 'instance';
  return 'plain';
}

/**
 * 「创建组件」可用性：与引擎 `createComponentCommands` 的前置**同口径**
 *（非空、同父级），另加两条 UI 政策（面板口径）：
 * - 实例内容（虚节点）不可再提升为主组件（引擎的 reparent 只在真实节点上工作，P0 不支持）；
 * - 选中已含组件/实例/组件集时不提供「创建组件」（它们是组件资产本身，不是内容图层）。
 */
export function canCreateComponent(page: ScenePage, selection: Selection): CreateComponentCheck {
  if (selection.ids.length === 0) return { ok: false, reason: 'empty' };
  if (selection.ids.some((id) => parseVirtualNodeId(id) !== null)) {
    return { ok: false, reason: 'instance-content' };
  }
  const nodes = selectionNodes(page, selection);
  if (nodes.some((node) => classifyNodeKind(node) !== 'plain')) {
    return { ok: false, reason: 'contains-component' };
  }
  const parents = new Set(selection.ids.map((id) => getParentId(page, id)));
  if (parents.size > 1) return { ok: false, reason: 'multiple-parents' };
  return { ok: true };
}

/** 取某节点的显示名（面板/覆盖清单的标签）。 */
export function displayNameOf(page: ScenePage, id: NodeId): string {
  return resolveNode(page, id)?.name ?? id;
}
