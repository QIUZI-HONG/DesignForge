/**
 * 文档层级树 → Tree 节点规格（RW-13，纯映射、可单测）。
 *
 * 顺序口径沿用图层面板惯例：**绘制顺序的逆序**——Figma 把最上层显示在最前面，
 * 每一级 children 反转后交给 Tree（Tree 按给定顺序渲染）。
 *
 * 行级状态映射（Tree 六态消费，RW-13）：
 * - `disabled` = 实例虚节点（`parseVirtualNodeId` 命中）：结构只读——不可选中/拖拽/重命名，
 *   键盘漫游跳过；其子行同样虚（随实例展开可见）；显隐控件**保留**（可见性覆盖是属性
 *   写入而非结构操作，引擎走 `instance.setOverride` 路由，票 11）；
 * - `loading` / `error` 不映射：同步命令栈文档不产生行级异步态，挂点留给后续异步装载票；
 * - `icon` = 类型图标（组件族落 `data-df-layer-type` 供 editor-panels.css 着色）；
 * - `trailing` = 行内显隐/锁定控件（票 11，C3 缺口④）：状态与可访问名由节点当前值驱动，
 *   点击经 handlers 上报意图——本模块只渲染，不构造命令、不写文档。
 */
import { type LayerTreeNode, type NodeId, parseVirtualNodeId } from '@dforge/engine';
import {
  EyeIcon,
  EyeOffIcon,
  IconButton,
  LockIcon,
  type TreeNodeSpec,
  UnlockIcon,
} from '@dforge/ui';
import type { ReactNode } from 'react';

import { t } from '@/i18n';

import { layerTypeIcon } from './layer-icons';

/** 行级控件的上报意图（面板据此构造命令交给会话）。 */
export interface TreeRowHandlers {
  /** 显隐切换（按当前值取反；写路径在面板侧，基于最新文档构造命令）。 */
  toggleVisibility: (nodeId: NodeId) => void;
  /** 锁定切换。 */
  toggleLock: (nodeId: NodeId) => void;
}

/** 面板树模型：Tree 的节点规格 + 采样挂点需要的派生量。 */
export interface PanelTreeModel {
  /** Tree 节点规格（同级逆绘制顺序）。 */
  nodes: TreeNodeSpec[];
  /** 全量节点数（`data-df-layer-count` 取样挂点；与折叠态无关）。 */
  totalCount: number;
  /** 全部容器 id（受控展开集 = 容器 − 折叠集）。 */
  containerIds: NodeId[];
}

/**
 * 行尾控件（显隐 + 锁定）：DOM 常驻（测试/门禁挂点可查），显现节奏交给 CSS
 * （`.dfg-tree__actions` hover/焦点/选中显现）。点击 stopPropagation——行激活
 * 不叠加（Tree 的 isOwnRowClick 也在 `.dfg-tree__actions` 上双保险）。
 * 数据挂点落在外层 span（`data-df-layer-action` + 状态值），按钮本体保持 IconButton 契约。
 */
function rowControls(entry: LayerTreeNode, handlers: TreeRowHandlers): ReactNode {
  const { node } = entry;
  return (
    <>
      <span
        className="dfg-panels__row-control"
        data-df-layer-action="visibility"
        data-df-layer-visible={node.visible ? 'true' : 'false'}
      >
        <IconButton
          size="sm"
          label={t(node.visible ? 'panels.layers.hide' : 'panels.layers.show', {
            name: node.name,
          })}
          icon={node.visible ? <EyeIcon /> : <EyeOffIcon />}
          pressed={!node.visible}
          onClick={(event) => {
            event.stopPropagation();
            handlers.toggleVisibility(entry.id);
          }}
        />
      </span>
      <span
        className="dfg-panels__row-control"
        data-df-layer-action="lock"
        data-df-layer-locked={node.locked ? 'true' : 'false'}
      >
        <IconButton
          size="sm"
          label={t(node.locked ? 'panels.layers.unlock' : 'panels.layers.lock', {
            name: node.name,
          })}
          icon={node.locked ? <LockIcon /> : <UnlockIcon />}
          pressed={node.locked}
          onClick={(event) => {
            event.stopPropagation();
            handlers.toggleLock(entry.id);
          }}
        />
      </span>
    </>
  );
}

/** 构建面板树模型（一次遍历；折叠交给 Tree 的受控展开集，children 全量携带不在映射里裁剪）。 */
export function buildTreeModel(
  tree: readonly LayerTreeNode[],
  handlers?: TreeRowHandlers,
): PanelTreeModel {
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
      ...(handlers === undefined ? {} : { trailing: rowControls(entry, handlers) }),
      children,
      ...(virtual ? { disabled: true } : {}),
    };
  };
  const nodes = [...tree].reverse().map(visit);
  return { nodes, totalCount, containerIds };
}
