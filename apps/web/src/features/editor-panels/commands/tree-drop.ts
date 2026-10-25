/**
 * Tree 拖拽落位解析（RW-13 约定，seam：`Tree.onReorder(source, target)` + 指针/行几何 →
 * 引擎可用的移动目标）。
 *
 * **RW-13 落位约定**（兑现 RW-07 在 Tree 接口里声明留给本票的「落位语义」）：
 *
 * 1. **指针细节由消费侧自记**：Tree v1 的 `onReorder` 只上报 `(sourceId, targetId)` 对，
 *    不携带指针位置。图层面板在拖拽期间用 document 级 `dragover` 记录指针 Y，
 *    drop 时量取 target 行矩形（`getBoundingClientRect`），二者合成 `TreeDropPointer`。
 * 2. **上/下各半判定插入位置**：以 target 行垂直中线为界——指针在上半 → 插到 target
 *    **之前**，在下半 → 插到 target **之后**（同一父级的同级序列；中点归下半）。
 *    指针越过行上缘按「之前」、越过下缘按「之后」；无指针信息（几何不可得，如测试环境）
 *    按「之前」降级，保证判定确定性。
 * 3. **跨父拖拽 = reparent**：落点父级恒为 target 的父级，因此 source 与 target 不同父时
 *    本次落点就是改父（引擎 `node.reparent` 族，`moveLayerCommands` 走
 *    `reparentPreservingWorldCommands` 保持世界位置；同父即纯重排）。
 *    「放入容器内部」**不在本约定内**——Tree v1 接口没有 inside 语义；拖入容器 =
 *    展开后落到它的某个子行上，空/折叠容器的拖入走画布拖拽。
 * 4. **无效落点 → null**（调用方不发命令）：source/target 是实例虚节点（结构只读）、
 *    落到自身、target 落在 source 子树内（成环，引擎会拒）、任一节点不存在。
 * 5. **下标坐标空间**：`index` 是「**先摘除 source，再插入**」的列表下标——与引擎
 *    `node.reparent` 语义一致（见 `scene/mutate.ts` 的 `reparentNode`），交给
 *    `moveLayerCommands` 前无需再换算，避免「向下拖一格却少移一位」的 off-by-one。
 * 6. **单事务**：一次 drop 恰好一次 `session.run`（一条 reparentPreservingWorld 命令组，
 *    同一事务内原子生效）；面板不碰 `CommandStack.enqueue` 的微任务合并路径，
 *    其「高频写入合并为一个事务」的语义不受影响。
 */
import {
  getChildrenIds,
  isDescendantOf,
  type NodeId,
  parentIdOf,
  parseVirtualNodeId,
  resolveNode,
  type ScenePage,
} from '@dforge/engine';

/** 拖拽落点的指针证据（消费侧从 document dragover + target 行矩形合成）。 */
export interface TreeDropPointer {
  /** 指针 Y（与行矩形同一坐标系：视口坐标）。 */
  y: number;
  /** target 行上缘。 */
  rowTop: number;
  /** target 行下缘。 */
  rowBottom: number;
}

/** 落点：新父级 + 摘除后下标 + 前后缘（前后缘供日志/断言与后续视觉指示扩展）。 */
export interface TreeDropPlacement {
  /** 新父级（null = 页面顶层）。 */
  parentId: NodeId | null;
  /** 「摘除 source 后」的列表下标（直接交给 `moveLayerCommands`）。 */
  index: number;
  /** 插入缘：target 之前 / 之后。 */
  edge: 'before' | 'after';
}

/**
 * 解析 Tree 拖拽落位（纯函数）。
 *
 * @param page 当前页面快照（写操作必须基于最新文档构造命令，调用方负责取最新）
 * @param sourceId 被拖拽的节点（Tree.onReorder 的 source）
 * @param targetId 落点行节点（Tree.onReorder 的 target）
 * @param pointer 指针证据；缺省/null = 几何不可得，按「之前」降级
 */
export function resolveTreeDropPlacement(
  page: ScenePage,
  sourceId: NodeId,
  targetId: NodeId,
  pointer?: TreeDropPointer | null,
): TreeDropPlacement | null {
  if (sourceId === targetId) return null;
  // 实例虚节点是主组件的影子，不参与结构移动（与 moveLayerCommands 的守卫同口径，提前判掉）
  if (parseVirtualNodeId(sourceId) !== null || parseVirtualNodeId(targetId) !== null) return null;
  if (resolveNode(page, sourceId) === undefined || resolveNode(page, targetId) === undefined) {
    return null;
  }
  // target 在 source 子树内：无论前后缘，新父级都会落进 source 子树（环）→ 拒
  if (isDescendantOf(page, targetId, sourceId)) return null;

  const parentId = parentIdOf(page, targetId);
  // 摘除 source 后的同级序列（坐标空间与 node.reparent 一致）
  const siblingsWithoutSource = getChildrenIds(page, parentId).filter((id) => id !== sourceId);
  const position = siblingsWithoutSource.indexOf(targetId);
  if (position < 0) return null;

  const edge = edgeOf(pointer);
  return { parentId, index: edge === 'before' ? position : position + 1, edge };
}

/** 前后缘判定：上/下各半，中点归下半；无指针按「之前」降级。 */
function edgeOf(pointer?: TreeDropPointer | null): 'before' | 'after' {
  if (!pointer || pointer.rowBottom <= pointer.rowTop) return 'before';
  const ratio = (pointer.y - pointer.rowTop) / (pointer.rowBottom - pointer.rowTop);
  return ratio < 0.5 ? 'before' : 'after';
}
