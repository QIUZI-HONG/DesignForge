/**
 * 图层行的交互命令构造器 —— 面板语义 → 引擎命令。
 *
 * 纪律（briefs/fe-04.md §2）：面板**只构造命令**，由 `CommandStack.dispatch` 施加；
 * 这里不做任何文档写入，也不持有状态——因此每个函数都是纯函数、可逐条断言。
 *
 * 无操作口径：命令列表为空 = UI 侧的操作不可用（已在端位、值未变、不足两个同级节点……）。
 * 会话层对空列表直接跳过 dispatch（不写撤销栈），避免「点了但什么也没发生」污染历史。
 */
import {
  type Command,
  deleteNodesCommands,
  dissolveGroupCommands,
  getChildrenIds,
  groupNodesCommands,
  isContainer,
  isGroupNode,
  type NodeId,
  type PageId,
  parentIdOf,
  parseVirtualNodeId,
  patchNodeCommands,
  reorderNodeCommands,
  reparentPreservingWorldCommands,
  resolveNode,
  type ScenePage,
  siblingIndexOf,
  type ZOrderOp,
} from '@dforge/engine';

/** 显隐：设为给定值（与当前一致 → 无操作）。 */
export function setVisibilityCommands(
  page: ScenePage,
  pageId: PageId,
  nodeId: NodeId,
  visible: boolean,
): Command[] {
  const node = resolveNode(page, nodeId);
  if (!node || node.visible === visible) return [];
  return patchNodeCommands(pageId, nodeId, { visible });
}

/** 显隐：按当前值取反（眼睛按钮）。 */
export function toggleVisibilityCommands(
  page: ScenePage,
  pageId: PageId,
  nodeId: NodeId,
): Command[] {
  const node = resolveNode(page, nodeId);
  if (!node) return [];
  return patchNodeCommands(pageId, nodeId, { visible: !node.visible });
}

/** 锁定：设为给定值（与当前一致 → 无操作）。 */
export function setLockedCommands(
  page: ScenePage,
  pageId: PageId,
  nodeId: NodeId,
  locked: boolean,
): Command[] {
  const node = resolveNode(page, nodeId);
  if (!node || node.locked === locked) return [];
  return patchNodeCommands(pageId, nodeId, { locked });
}

/** 锁定：按当前值取反（锁按钮）。 */
export function toggleLockCommands(page: ScenePage, pageId: PageId, nodeId: NodeId): Command[] {
  const node = resolveNode(page, nodeId);
  if (!node) return [];
  return patchNodeCommands(pageId, nodeId, { locked: !node.locked });
}

/**
 * 重命名：写新名字。
 * 空白名视作取消（不提交）；同名视作无操作——两者都返回空列表，由输入框自行复位。
 */
export function renameLayerCommands(
  page: ScenePage,
  pageId: PageId,
  nodeId: NodeId,
  name: string,
): Command[] {
  const trimmed = name.trim();
  if (trimmed.length === 0) return [];
  const node = resolveNode(page, nodeId);
  if (!node || node.name === trimmed) return [];
  return patchNodeCommands(pageId, nodeId, { name: trimmed });
}

/** 删除（连同子树）；实例虚节点不可结构性删除 → 无操作。 */
export function deleteLayerCommands(page: ScenePage, pageId: PageId, nodeId: NodeId): Command[] {
  if (parseVirtualNodeId(nodeId)) return [];
  if (!resolveNode(page, nodeId)) return [];
  return deleteNodesCommands(page, pageId, [nodeId]);
}

/**
 * 编组：把 ≥2 个同级节点包进新编组（世界形状不变）。
 * 不足两个、跨父级、含实例虚节点 → 无操作（UI 侧对应禁用菜单条目）。
 */
export function groupLayersCommands(
  page: ScenePage,
  pageId: PageId,
  nodeIds: readonly NodeId[],
): Command[] {
  const real = nodeIds.filter(
    (id) => !parseVirtualNodeId(id) && resolveNode(page, id) !== undefined,
  );
  if (real.length < 2) return [];
  const parents = new Set(real.map((id) => parentIdOf(page, id)));
  if (parents.size > 1) return [];
  return groupNodesCommands(page, pageId, real);
}

/** 解组：仅对真实编组节点有效（其余无操作）。 */
export function ungroupLayerCommands(page: ScenePage, pageId: PageId, nodeId: NodeId): Command[] {
  if (parseVirtualNodeId(nodeId)) return [];
  const node = resolveNode(page, nodeId);
  if (!node || !isGroupNode(node)) return [];
  return dissolveGroupCommands(page, pageId, nodeId);
}

/** 上移到顶：同级最上层（已在顶 → 无操作）。 */
export function bringToFrontCommands(page: ScenePage, pageId: PageId, nodeId: NodeId): Command[] {
  return reorderCommands(page, pageId, nodeId, 'front');
}

/** 下移到底：同级最下层（已在底 → 无操作）。 */
export function sendToBackCommands(page: ScenePage, pageId: PageId, nodeId: NodeId): Command[] {
  return reorderCommands(page, pageId, nodeId, 'back');
}

/** 层级调整的公共路径：端位判定在 UI 侧完成，端位时返回空列表。 */
function reorderCommands(page: ScenePage, pageId: PageId, nodeId: NodeId, op: ZOrderOp): Command[] {
  if (parseVirtualNodeId(nodeId)) return [];
  const node = resolveNode(page, nodeId);
  if (!node) return [];
  const siblings = getChildrenIds(page, parentIdOf(page, nodeId));
  const index = siblings.indexOf(nodeId);
  if (index < 0) return [];
  if (op === 'front' && index === siblings.length - 1) return [];
  if (op === 'back' && index === 0) return [];
  return reorderNodeCommands(pageId, nodeId, op);
}

/**
 * 改父（拖拽排序/跨容器）：保持世界位置不变，落到新父级的指定下标。
 *
 * **下标坐标空间**：`index` 是「**先从原父级摘除，再插入新位置的列表**」中的下标——
 * 与引擎 `node.reparent` 的语义一致（见 `scene/mutate.ts`）。同级拖动请把落点交给
 * `commands/drop-target.ts` 的 `resolveDropTarget` 计算，它直接产出这一坐标空间的下标，
 * 避免「向下拖一格却少移一位」的经典 off-by-one。
 *
 * 目标父级为自身或自身后代、或无实际位移 → 无操作（返回空列表）。
 */
export function moveLayerCommands(
  page: ScenePage,
  pageId: PageId,
  nodeId: NodeId,
  newParentId: NodeId | null,
  index: number,
): Command[] {
  if (parseVirtualNodeId(nodeId) || !resolveNode(page, nodeId)) return [];
  if (newParentId !== null) {
    // 虚 id 不是真实容器：reparent 到虚父级会被引擎拒（node-not-found），这里提前判掉
    if (parseVirtualNodeId(newParentId)) return [];
    const parent = resolveNode(page, newParentId);
    // 实例内部不可作为拖拽父级（其子是虚节点，不是真实容器）
    if (!parent || !isContainer(parent)) return [];
    if (newParentId === nodeId) return [];
    if (isDescendantOrSelf(page, newParentId, nodeId)) return [];
  }

  const currentParent = parentIdOf(page, nodeId);
  const siblings = getChildrenIds(page, currentParent);
  const currentIndex = siblings.indexOf(nodeId);
  const limit =
    newParentId === null ? page.rootIds.length : getChildrenIds(page, newParentId).length;
  const target = Math.max(0, Math.min(limit, index));
  // 同父同下标 = 没有位移；同父时的合法下标上界是「摘除自身后的列表长度」
  if (currentParent === newParentId) {
    if (target === currentIndex || (currentIndex < 0 && target === limit)) return [];
  }
  return reparentPreservingWorldCommands(page, pageId, nodeId, newParentId, target);
}

/** `candidate` 是否 `nodeId` 自身或其后代（父级自身 → 环，引擎会拒；UI 侧提前判掉）。 */
function isDescendantOrSelf(page: ScenePage, candidate: NodeId, nodeId: NodeId): boolean {
  if (candidate === nodeId) return true;
  let current: NodeId | null = candidate;
  let guard = 0;
  while (current !== null) {
    current = parentIdOf(page, current);
    if (current === nodeId) return true;
    guard += 1;
    if (guard > 100_000) return true;
  }
  return false;
}

/** 同级下标（右键菜单/落点计算共用；不在同级 → -1）。 */
export function siblingIndex(page: ScenePage, nodeId: NodeId): number {
  return siblingIndexOf(page, nodeId);
}
