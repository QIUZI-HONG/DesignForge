/**
 * 图层行模型 —— 引擎层级树 → 面板可渲染的**扁平行序列**（纯函数）。
 *
 * 为什么扁平化：长列表要能用 CSS `content-visibility` 逐行跳过渲染，
 * 嵌套 DOM 会让「跳过」失效；扁平序列同时是拖拽落点计算的输入（`commands/drop-target.ts`）。
 *
 * 顺序口径：**绘制顺序的逆序**——Figma 图层面板把最上层显示在最前面，
 * 因此「上移到顶」在面板上表现为行往上走，两端口径一致。
 */
import type { LayerTreeNode, NodeId, SceneNode, Selection } from '@dforge/engine';
import { isContainer, parseVirtualNodeId } from '@dforge/engine';

/** 一行图层（渲染与拖拽共用）。 */
export interface LayerRowModel {
  id: NodeId;
  /** 视图节点（实例虚节点已应用覆盖）。 */
  node: SceneNode;
  /** 深度（0 = 顶层）。 */
  depth: number;
  /** 有子节点（显示展开箭头）。 */
  container: boolean;
  /** 容器类型且可接收拖入（空画板也接得住；实例虚节点不接——它的子节点不是真实结构）。 */
  droppable: boolean;
  childCount: number;
  /** 当前处于折叠态。 */
  collapsed: boolean;
  selected: boolean;
  /** 主选中（Inspector 的目标；面板加粗显示）。 */
  active: boolean;
  /** 实例虚节点：属性可覆盖，但结构不可编辑（拖拽/删除/编组禁用）。 */
  readOnly: boolean;
  /** 祖先被隐藏（整行置灰）。 */
  hiddenByAncestor: boolean;
  /** 祖先被锁定（显隐/锁定按钮禁用，给出原因）。 */
  lockedByAncestor: boolean;
  /** 该节点在实例内被覆盖过（显示覆盖记号）。 */
  overridden: boolean;
}

/** 构建行序列的输入。 */
export interface BuildLayerRowsOptions {
  /** 折叠的容器 id 集（默认全展开）。 */
  collapsedIds: ReadonlySet<NodeId>;
  /** 选择集（引擎选择模型）。 */
  selection: Selection;
}

/** 构建扁平行序列（自顶向下：先根，再子，同级逆绘制顺序）。 */
export function buildLayerRows(
  tree: readonly LayerTreeNode[],
  options: BuildLayerRowsOptions,
): LayerRowModel[] {
  const rows: LayerRowModel[] = [];
  const visit = (
    node: LayerTreeNode,
    depth: number,
    hiddenByAncestor: boolean,
    lockedByAncestor: boolean,
  ): void => {
    const container = node.children.length > 0;
    const collapsed = container && options.collapsedIds.has(node.id);
    const readOnly = parseVirtualNodeId(node.id) !== null;
    rows.push({
      id: node.id,
      node: node.node,
      depth,
      container,
      droppable: isContainer(node.node) && !readOnly,
      childCount: node.children.length,
      collapsed,
      selected: options.selection.ids.includes(node.id),
      active: options.selection.activeId === node.id,
      readOnly,
      hiddenByAncestor,
      lockedByAncestor,
      overridden: node.overriddenKeys.length > 0,
    });
    if (collapsed) return;
    // 逆绘制顺序：绘制顺序里最后画的（最上层）显示在最前
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      visit(
        node.children[index] as LayerTreeNode,
        depth + 1,
        hiddenByAncestor || !node.node.visible,
        lockedByAncestor || node.node.locked,
      );
    }
  };
  for (let index = tree.length - 1; index >= 0; index -= 1) {
    visit(tree[index] as LayerTreeNode, 0, false, false);
  }
  return rows;
}
