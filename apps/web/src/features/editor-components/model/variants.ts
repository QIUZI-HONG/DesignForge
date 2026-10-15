/**
 * C17 变体读取：实例 → 所属组件集的属性维度（下拉的选项来源）。
 *
 * 维度与取值一律从**引擎变体索引**推导（`variantIndex`），不在这里另立规则：
 * 面板只负责把维度渲染成下拉并把选择回传给 `switchInstanceVariant`。
 */

import {
  type ComponentId,
  getChildrenIds,
  isComponentNode,
  isInstanceNode,
  type NodeId,
  type ScenePage,
  variantIndex,
} from '@dforge/engine';

/** 单个变体维度的读取。 */
export interface VariantDimensionRead {
  /** 维度名（如 `size`）。 */
  name: string;
  /** 取值（字典序，稳定）。 */
  values: string[];
  /** 当前实例在该维度上的取值（null = 当前主件未声明该维度）。 */
  current: string | null;
}

/** 变体面板读取结果。 */
export interface VariantStateRead {
  setId: ComponentId;
  /** 组件集显示名。 */
  setName: string;
  /** 维度（按名排序）。 */
  dimensions: VariantDimensionRead[];
  /** 当前变体属性。 */
  current: Record<string, string>;
}

/** 读取实例的变体状态；主件不在组件集内（或非实例）返回 null。 */
export function readVariantState(page: ScenePage, instanceId: NodeId): VariantStateRead | null {
  const instance = page.nodes[instanceId];
  if (!instance || !isInstanceNode(instance)) return null;
  const main = page.nodes[instance.componentId];
  if (!main || !isComponentNode(main) || main.componentSetId === null) return null;
  const setId = main.componentSetId;
  const set = page.nodes[setId];
  const current = main.variantProperties ?? {};

  const index = variantIndex(page, setId);
  const dimensions = new Map<string, Set<string>>();
  for (const key of Object.keys(index)) {
    for (const pair of key.split(',')) {
      const [name, value] = pair.split('=');
      if (name === undefined || value === undefined) continue;
      const bucket = dimensions.get(name) ?? new Set<string>();
      bucket.add(value);
      dimensions.set(name, bucket);
    }
  }
  // 变体数为 0 的维度兜底：组件集子节点本身也参与（索引只收录“属性完整”的变体）
  if (dimensions.size === 0) {
    for (const childId of getChildrenIds(page, setId)) {
      const child = page.nodes[childId];
      if (!child || !isComponentNode(child) || child.variantProperties === null) continue;
      for (const [name, value] of Object.entries(child.variantProperties)) {
        const bucket = dimensions.get(name) ?? new Set<string>();
        bucket.add(value);
        dimensions.set(name, bucket);
      }
    }
  }

  return {
    setId,
    setName: set?.name ?? setId,
    dimensions: [...dimensions.entries()]
      .map(([name, values]) => ({
        name,
        values: [...values].sort(),
        current: current[name] ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    current: { ...current },
  };
}
