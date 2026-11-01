/**
 * 意图级命令构造器（helpers）：把「用户/AI 想做的事」翻译成命令列表。
 *
 * 分工：`commands/apply.ts` 是机器（纯结构变更 + 逆命令），
 * 本模块是**语义**（编组、保持世界位置的改父、按世界增量移动、跨实例覆盖路由）。
 * 所有函数都是纯函数：只读文档 + 返回 `Command[]`，由调用方交给 `CommandStack.dispatch`。
 */

import {
  applyToPoint,
  boundsCenter,
  boundsOfPoints,
  identity,
  invert,
  multiply,
  parentFrameRotation,
  parentWorldMatrix,
  translation,
  worldBoundsOfNode,
  worldDeltaToLocal,
  worldMatrix,
  worldQuad,
  worldRotation,
} from '../geometry/index';
import type { Matrix, Point, Rect } from '../geometry/types';
import { ID_PREFIX, type IdFactory, systemIdFactory } from '../model/ids';
import type {
  FrameNode,
  InstanceNode,
  NodeId,
  NodePatch,
  PageId,
  SceneNode,
  ScenePage,
} from '../model/index';
import { childrenOf, createGroup, isContainer } from '../model/index';
import { domainError } from '../scene/errors';
import {
  getDescendantIds,
  requireNode,
  resolveNode,
  sortByZOrder,
  topmostIds,
} from '../scene/index';
import { parseVirtualNodeId } from '../scene/instance';
import type { ZOrderOp } from '../scene/mutate';
import type { Command } from './types';

/** 插入节点。 */
export function insertNodeCommands(
  pageId: PageId,
  node: import('../model/index').SceneNode,
  parentId: NodeId | null,
  index?: number,
): Command[] {
  return [{ type: 'node.insert', pageId, node, parentId, index }];
}

/**
 * 删除节点（自动剔除已被其他待删节点包含者，避免重复删子树）。
 *
 * **依赖者收口（复核 H1 · 票 17 后续）**：删除主组件只发裸 `node.remove` 会把指向它的实例
 * 留在页面上成悬空引用（`validatePage` 报 `missing-component`）；删除组件集同理会把集外变体的
 * `componentSetId` 留成悬空（`missing-component-set`）。票 17 之后写盘前置校验会因此拒绝
 * **整份文档**（⌘S 再也存不了，见 `documents-client` 与 daemon `canvas-integrity`）。
 * 删除侧的修法与粘贴侧同一条口径（`clipboard.settleComponentRefs`：主组件不可证即在落页时
 * 降级为普通帧、悬空组件集引用置 null）：这里把「随删除失效的依赖者」一并收口，并与删除本身
 * **合成同一条事务**——调用方 `CommandStack.dispatch(commands)` 一次成一条历史，
 * 一次撤销同时还原被删节点与被收口的引用（见 `commands/delete-settle.test.ts`）。
 *
 * 收口用既有命令表达（`node.remove` + 同 id 回插）而不是新命令类型：
 * 实例不持有真实子节点（其子是虚节点），删后按原父级原下标插回等价于原地改类型；
 * 变体主组件用 `node.restore` 连同真实子树回灌（快照里只改根节点的 `componentSetId`）。
 * 逆命令由既有处理器推导，撤销/重做语义不必另立一份。
 */
export function deleteNodesCommands(
  page: ScenePage,
  pageId: PageId,
  nodeIds: readonly NodeId[],
): Command[] {
  const roots = topmostIds(page, nodeIds);
  const removed = new Set<NodeId>();
  for (const root of roots) {
    removed.add(root);
    for (const descendantId of getDescendantIds(page, root)) removed.add(descendantId);
  }
  const commands: Command[] = roots.map(
    (nodeId) => ({ type: 'node.remove', pageId, nodeId }) as Command,
  );
  for (const placement of orphanedDependents(page, pageId, removed)) {
    commands.push(...placement.commands);
  }
  return commands;
}

/** 依赖者收口的一条落位（「删—回插」命令对 + 删除生效后的兄弟下标）。 */
interface DependentPlacement {
  index: number;
  commands: Command[];
}

/**
 * 本次删除后**仍留在页面上但引用已失效**的依赖者 → 收口命令对：
 * - 主组件被删的实例 → 降级为普通帧（与粘贴降级同一条规则）；
 * - 组件集被删的变体主组件 → `componentSetId` 置 null（退为独立主组件，子树原样保留）。
 *
 * 下标按**删除生效后**的兄弟序列计算（被删根节点先于收口命令生效，原下标会整体偏位），
 * 并按该下标升序发射：同父多个依赖者逐个插回原位互不推挤。
 */
function orphanedDependents(
  page: ScenePage,
  pageId: PageId,
  removed: ReadonlySet<NodeId>,
): DependentPlacement[] {
  const placements: DependentPlacement[] = [];
  for (const node of Object.values(page.nodes)) {
    if (removed.has(node.id)) continue;
    const danglingSetRef =
      node.type === 'component' && node.componentSetId !== null && removed.has(node.componentSetId);
    if (node.type !== 'instance' && !danglingSetRef) continue;
    const parentId = parentIdOf(page, node.id);
    const index = survivingIndexOf(page, parentId, node.id, removed);
    const removal = { type: 'node.remove', pageId, nodeId: node.id } as Command;
    if (node.type === 'instance' && removed.has(node.componentId)) {
      placements.push({
        index,
        commands: [
          removal,
          {
            type: 'node.insert',
            pageId,
            node: frameFromInstance(node),
            parentId,
            index,
          } as Command,
        ],
      });
      continue;
    }
    if (danglingSetRef) {
      // 快照「父先于子」，只把根的组件集引用改 null，其余节点原样回灌
      const snapshot = realSubtreePreOrder(page, node.id).map((subtreeNode, position) =>
        position === 0 && subtreeNode.type === 'component'
          ? { ...subtreeNode, componentSetId: null }
          : subtreeNode,
      );
      placements.push({
        index,
        commands: [
          removal,
          {
            type: 'node.restore',
            pageId,
            rootId: node.id,
            nodes: snapshot,
            parentId,
            index,
          } as Command,
        ],
      });
    }
  }
  return placements.sort((a, b) => a.index - b.index);
}

/** 子树内的真实节点（前序：父先于子；实例是叶子，其虚子节点不落盘也不进快照）。 */
function realSubtreePreOrder(page: ScenePage, rootId: NodeId): SceneNode[] {
  const root = page.nodes[rootId];
  if (!root) return [];
  const out: SceneNode[] = [root];
  const stack: SceneNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop() as SceneNode;
    if (!isContainer(current)) continue;
    for (const childId of childrenOf(current)) {
      const child = page.nodes[childId];
      if (!child) continue;
      out.push(child);
      stack.push(child);
    }
  }
  return out;
}

/** 节点在「剔除本次被删节点后」的兄弟序列中的下标（顶层用 `rootIds`）。 */
function survivingIndexOf(
  page: ScenePage,
  parentId: NodeId | null,
  nodeId: NodeId,
  removed: ReadonlySet<NodeId>,
): number {
  const siblings =
    parentId === null
      ? page.rootIds
      : ((page.nodes[parentId] as { children?: NodeId[] } | undefined)?.children ?? []);
  return Math.max(0, siblings.filter((id) => !removed.has(id)).indexOf(nodeId));
}

/**
 * 实例降级为普通帧（与粘贴侧同一口径：几何/外观原样保留，
 * 主组件引用与覆盖表随降级丢弃——主组件虚节点本就不随实例落盘）。
 * 字段逐个列出而不做键删除：类型系统保证产出是合法 `FrameNode`，
 * 不依赖断言转形（粘贴侧保留未知自有键的既有行为在 `clipboard.ts` 内另成一路，此处不并轨）。
 */
function frameFromInstance(node: InstanceNode): FrameNode {
  return {
    id: node.id,
    name: node.name,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    visible: node.visible,
    locked: node.locked,
    opacity: node.opacity,
    blendMode: node.blendMode,
    fills: node.fills,
    strokes: node.strokes,
    effects: node.effects,
    cornerRadius: node.cornerRadius,
    type: 'frame',
    children: [],
    clipsContent: true,
    autoLayout: null,
  };
}

/** 按世界增量移动（各节点父坐标系可能不同 → 逐个换算）。 */
export function moveNodesByWorldCommands(
  page: ScenePage,
  pageId: PageId,
  nodeIds: readonly NodeId[],
  worldDelta: Point,
): Command[] {
  return nodeIds.map((nodeId) => {
    const local = worldDeltaToLocal(page, nodeId, worldDelta);
    return { type: 'node.move', pageId, nodeIds: [nodeId], dx: local.x, dy: local.y } as Command;
  });
}

/** 直接设值（局部坐标）。 */
export function setNodePropsCommands(pageId: PageId, nodeId: NodeId, patch: NodePatch): Command[] {
  return [{ type: 'node.update', pageId, nodeId, patch }];
}

/**
 * 属性写入路由：真实节点 → `node.update`；实例内的虚节点 → 写实例覆盖表。
 * FE-05 Inspector 对「选中的实例子节点」改属性时走这里（C17 覆盖）。
 */
export function patchNodeCommands(pageId: PageId, nodeId: NodeId, patch: NodePatch): Command[] {
  const virtual = parseVirtualNodeId(nodeId);
  if (virtual) {
    return [
      {
        type: 'instance.setOverride',
        pageId,
        instanceId: virtual.instanceId,
        path: virtual.path,
        patch,
      },
    ];
  }
  return [{ type: 'node.update', pageId, nodeId, patch }];
}

/** 层级调整。 */
export function reorderNodeCommands(pageId: PageId, nodeId: NodeId, op: ZOrderOp): Command[] {
  return [{ type: 'node.reorder', pageId, nodeId, op }];
}

/**
 * 换算原语（改父 / 解组 / 编组 / 建组件共用）：把节点换算进「以 `frameMatrix` 为世界矩阵、
 * 累计旋转为 `frameRotation` 的父坐标系」的属性补丁，使其**世界形状保持不变**
 * （位置 = 世界中心在新父坐标系中的落点；旋转 = 世界旋转 − 新父系旋转）。
 * 新父级尚未入树时（编组 / 建组件的容器），由调用方手工合成其世界矩阵后传入同一原语，
 * 保证「进入任何父坐标系」只有一套换算语义。
 */
function patchToKeepWorldShape(
  page: ScenePage,
  nodeId: NodeId,
  frameMatrix: Matrix,
  frameRotation: number,
): NodePatch | null {
  const node = resolveNode(page, nodeId);
  if (!node) return null;
  const quad = worldBoundsOfNode(page, nodeId);
  if (!quad) return null;
  const center = boundsCenter(quad);
  const localCenter = applyToPoint(invert(frameMatrix), center);
  return {
    x: localCenter.x - node.width / 2,
    y: localCenter.y - node.height / 2,
    rotation: worldRotation(page, nodeId) - frameRotation,
  };
}

/**
 * 把节点换算到「新父级坐标系」的属性补丁，使其**世界形状保持不变**
 * （位置 = 世界中心在新父坐标系中的落点；旋转 = 世界旋转 − 新父坐标系旋转）。
 * 返回 null 表示节点不存在。
 */
export function frameTransformPatch(
  page: ScenePage,
  nodeId: NodeId,
  newParentId: NodeId | null,
): NodePatch | null {
  const frameMatrix = newParentId === null ? identity() : worldMatrix(page, newParentId);
  const frameRotation = newParentId === null ? 0 : worldRotation(page, newParentId);
  return patchToKeepWorldShape(page, nodeId, frameMatrix, frameRotation);
}

/** 保持世界位置的改父（图层面板拖拽的语义）。 */
export function reparentPreservingWorldCommands(
  page: ScenePage,
  pageId: PageId,
  nodeId: NodeId,
  newParentId: NodeId | null,
  index?: number,
): Command[] {
  const patch = frameTransformPatch(page, nodeId, newParentId);
  if (!patch) throw domainError('node-not-found', `节点不存在：${nodeId}`);
  return [
    { type: 'node.update', pageId, nodeId, patch },
    { type: 'node.reparent', pageId, nodeId, parentId: newParentId, index },
  ];
}

/** 编组：组包围盒 = 选中节点并集在**父坐标系**中的 AABB；子节点坐标改为相对组，世界形状不变。 */
export function groupNodesCommands(
  page: ScenePage,
  pageId: PageId,
  nodeIds: readonly NodeId[],
  options: { groupId?: NodeId; name?: string; ids?: IdFactory } = {},
): Command[] {
  const roots = sortByZOrder(page, topmostIds(page, nodeIds));
  if (roots.length === 0) return [];

  // 编组要求同层（Figma 的编组也是同层操作）：跨父级会改变层级语义
  const parents = new Set(roots.map((id) => parentIdOf(page, id)));
  if (parents.size > 1) {
    throw domainError('invalid-argument', '编组要求所选节点处于同一父级');
  }

  const ids = options.ids ?? systemIdFactory;
  const groupId = options.groupId ?? ids.next(ID_PREFIX.group);
  const group = createGroup({ id: groupId, name: options.name ?? '编组' });
  // 容器几何由 wrapIntoContainerCommands 统一经父坐标系逆换算落位
  return wrapIntoContainerCommands(page, pageId, roots, group);
}

/**
 * 把选中节点包进**给定容器**，并使各子节点世界形状不变。
 * 编组与「提升为主组件」共用这条路径。
 *
 * 容器定位与子项补丁一律经**父坐标系逆换算**（与解组路径 `frameTransformPatch` 同一原语）：
 * - 容器 x/y 语义为相对父容器，落位取选中并集在父坐标系中的 AABB——
 *   世界 AABB 直接当父相对坐标会让整组瞬移一个父偏移，父级带旋转时再错一层旋转；
 * - 容器相对父级无旋转（编组/组件容器构造时 rotation 为 0），其世界矩阵 = 父世界矩阵 ∘ 局部平移；
 * - 传入容器的几何字段仅作占位，落位几何以本函数计算为准。
 */
export function wrapIntoContainerCommands(
  page: ScenePage,
  pageId: PageId,
  roots: readonly NodeId[],
  container: ContainerLike,
): Command[] {
  const first = roots[0] as NodeId;
  const parentId = parentIdOf(page, first);
  const index = siblingIndexOf(page, first);
  const parentMatrix = parentId === null ? identity() : parentWorldMatrix(page, first);
  const localBounds = selectionBoundsInParentSpace(page, roots, parentMatrix);
  if (!localBounds) return [];
  const placed: ContainerLike = {
    ...container,
    x: localBounds.x,
    y: localBounds.y,
    width: localBounds.width,
    height: localBounds.height,
  };
  const containerMatrix = multiply(parentMatrix, translation(localBounds.x, localBounds.y));
  const frameRotation = parentId === null ? 0 : parentFrameRotation(page, first);
  const patches = roots.map((id) => ({
    id,
    patch: patchToKeepWorldShape(page, id, containerMatrix, frameRotation),
  }));

  const commands: Command[] = [{ type: 'node.insert', pageId, node: placed, parentId, index }];
  patches.forEach(({ id, patch }, order) => {
    if (!patch) return;
    commands.push({ type: 'node.update', pageId, nodeId: id, patch });
    commands.push({
      type: 'node.reparent',
      pageId,
      nodeId: id,
      parentId: container.id,
      index: order,
    });
  });
  return commands;
}

/** 可作为容器包裹选中节点的节点（编组/组件/画板）；几何字段仅作占位，落位由 `wrapIntoContainerCommands` 统一经父坐标系逆换算确定。 */
export type ContainerLike = SceneNode & {
  id: NodeId;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * 选中并集在父坐标系中的 AABB：各节点世界四角经父矩阵逆映射后取并集。
 * 父级带旋转时这才是「紧包裹」——节点的父局部脚印本就是其在父坐标系中的真实形状。
 */
function selectionBoundsInParentSpace(
  page: ScenePage,
  roots: readonly NodeId[],
  parentMatrix: Matrix,
): Rect | null {
  const inverse = invert(parentMatrix);
  const points: Point[] = [];
  for (const id of roots) {
    const quad = worldQuad(page, id);
    if (!quad) return null;
    for (const point of quad) points.push(applyToPoint(inverse, point));
  }
  if (points.length === 0) return null;
  return boundsOfPoints(points);
}

/** 解组：子节点升到组的父级、保持在组中的绘制顺序，世界形状不变。 */
export function dissolveGroupCommands(page: ScenePage, pageId: PageId, groupId: NodeId): Command[] {
  const group = requireNode(page, groupId);
  if (group.type !== 'group') {
    throw domainError('invalid-argument', `节点不是编组：${groupId}`);
  }
  const newParentId = parentIdOf(page, groupId);
  const baseIndex = siblingIndexOf(page, groupId);
  const commands: Command[] = [];
  const children = [...group.children];
  const patches = children.map((childId) => ({
    id: childId,
    patch: frameTransformPatch(page, childId, newParentId),
  }));
  patches.forEach(({ id, patch }, order) => {
    if (patch) commands.push({ type: 'node.update', pageId, nodeId: id, patch });
    commands.push({
      type: 'node.reparent',
      pageId,
      nodeId: id,
      parentId: newParentId,
      index: baseIndex + order,
    });
  });
  commands.push({ type: 'node.remove', pageId, nodeId: groupId });
  return commands;
}

/** 取节点的父 id（页面顶层为 null）。 */
export function parentIdOf(page: ScenePage, nodeId: NodeId): NodeId | null {
  if (page.rootIds.includes(nodeId)) return null;
  for (const node of Object.values(page.nodes)) {
    if (
      node.type === 'frame' ||
      node.type === 'group' ||
      node.type === 'component' ||
      node.type === 'component_set'
    ) {
      if (node.children.includes(nodeId)) return node.id;
    }
  }
  return null;
}

/** 取节点在其父级中的下标（找不到返回 0）。 */
export function siblingIndexOf(page: ScenePage, nodeId: NodeId): number {
  const parentId = parentIdOf(page, nodeId);
  const siblings =
    parentId === null
      ? page.rootIds
      : ((page.nodes[parentId] as { children: NodeId[] } | undefined)?.children ?? []);
  return Math.max(0, siblings.indexOf(nodeId));
}

/** 页面内节点的世界中心（对齐/分布计算共用）。 */
export function worldCenterOf(page: ScenePage, nodeId: NodeId): Point | null {
  const bounds = worldBoundsOfNode(page, nodeId);
  return bounds ? boundsCenter(bounds) : null;
}
