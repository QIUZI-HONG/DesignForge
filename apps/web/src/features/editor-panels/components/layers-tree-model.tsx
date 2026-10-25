/**
 * 文档层级树 → Tree 节点规格（RW-13，纯映射、可单测）。
 *
 * 顺序口径沿用图层面板惯例：**绘制顺序的逆序**——Figma 把最上层显示在最前面，
 * 每一级 children 反转后交给 Tree（Tree 按给定顺序渲染）。
 *
 * 行级状态映射（Tree 六态消费，RW-13）：
 * - `disabled` = 实例虚节点（`parseVirtualNodeId` 命中）：结构只读——不可选中/拖拽/重命名，
 *   键盘漫游跳过；其子行同样虚（随实例展开可见）；
 * - `loading` / `error` 不映射：同步命令栈文档不产生行级异步态，挂点留给后续异步装载票；
 * - `icon` = 类型图标（组件族落 `data-df-layer-type` 供 editor-panels.css 着色）。
 */
import { type LayerTreeNode, type NodeId, parseVirtualNodeId } from '@dforge/engine';
import type { TreeNodeSpec } from '@dforge/ui';

import { layerTypeIcon } from './layer-icons';

/** 面板树模型：Tree 的节点规格 + 采样挂点需要的派生量。 */
export interface PanelTreeModel {
  /** Tree 节点规格（同级逆绘制顺序）。 */
  nodes: TreeNodeSpec[];
  /** 全量节点数（`data-df-layer-count` 取样挂点；与折叠态无关）。 */
  totalCount: number;
  /** 全部容器 id（受控展开集 = 容器 − 折叠集）。 */
  containerIds: NodeId[];
}

/** 构建面板树模型（一次遍历；折叠交给 Tree 的受控展开集，children 全量携带不在映射里裁剪）。 */
export function buildTreeModel(tree: readonly LayerTreeNode[]): PanelTreeModel {
  const containerIds: NodeId[] = [];
  let totalCount = 0;
  const visit = (entry: LayerTreeNode): TreeNodeSpec => {
    totalCount += 1;
    // 逆绘制顺序：绘制顺序里最后画的（最上层）显示在最前
    const children = [...entry.children].reverse().map(visit);
    if (entry.children.length > 0) containerIds.push(entry.id);
    const virtual = parseVirtualNodeId(entry.id) !== null;
    return {
      id: entry.id,
      label: entry.node.name,
      icon: (
        <span className="dfg-panels__layer-type-icon" data-df-layer-type={entry.node.type}>
          {layerTypeIcon(entry.node)}
        </span>
      ),
      children,
      ...(virtual ? { disabled: true } : {}),
    };
  };
  const nodes = [...tree].reverse().map(visit);
  return { nodes, totalCount, containerIds };
}
