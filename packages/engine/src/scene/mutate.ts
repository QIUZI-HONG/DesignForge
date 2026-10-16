/**
 * 场景读写（纯函数、不可变）。
 *
 * 约定：所有写函数**返回新文档**，输入文档与其子结构永不被修改；
 * 这些函数是命令栈处理器的实现基础（外部写入必须经 `CommandStack` 这一唯一入口）。
 * 坐标语义：move/reparent 的位移按**父坐标系**表达；世界坐标换算见 `geometry/transform.ts`。
 */

import type {
  DesignDocument,
  NodeId,
  NodePatch,
  PageId,
  SceneNode,
  ScenePage,
} from '../model/index';
import { isContainer } from '../model/index';
import { domainError } from './errors';
import { getParentId, requireNode } from './query';

/** 层级操作（C 区：置顶/置底/上移/下移）。 */
export type ZOrderOp = 'front' | 'back' | 'forward' | 'backward';

/** 取页面；缺失抛错。 */
export function getPage(doc: DesignDocument, pageId: PageId): ScenePage {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) throw domainError('page-not-found', `页面不存在：${pageId}`);
  return page;
}

/** 取页面；缺失返回 undefined。 */
export function findPage(doc: DesignDocument, pageId: PageId): ScenePage | undefined {
  return doc.pages.find((p) => p.id === pageId);
}

/** 用新页面替换同 id 页面（返回新文档）。 */
export function replacePage(doc: DesignDocument, page: ScenePage): DesignDocument {
  let found = false;
  const pages = doc.pages.map((existing) => {
    if (existing.id !== page.id) return existing;
    found = true;
    return page;
  });
  if (!found) throw domainError('page-not-found', `页面不存在：${page.id}`);
  return { ...doc, pages };
}

/** 页面设置补丁。 */
export interface PagePatch {
  name?: string;
  backgroundColor?: string;
  grid?: ScenePage['grid'];
}

/** 修改页面设置。 */
export function updatePage(doc: DesignDocument, pageId: PageId, patch: PagePatch): DesignDocument {
  const page = getPage(doc, pageId);
  return replacePage(doc, { ...page, ...patch });
}

/** 新增页面。 */
export function addPage(doc: DesignDocument, page: ScenePage, index?: number): DesignDocument {
  if (doc.pages.some((p) => p.id === page.id)) {
    throw domainError('duplicate-id', `页面 id 重复：${page.id}`);
  }
  const pages = [...doc.pages];
  pages.splice(index ?? pages.length, 0, page);
  return { ...doc, pages };
}

/** 删除页面（文档至少保留一页）。 */
export function removePage(doc: DesignDocument, pageId: PageId): DesignDocument {
  const page = getPage(doc, pageId);
  void page;
  if (doc.pages.length <= 1) {
    throw domainError('last-page', '文档至少需要一个页面');
  }
  return { ...doc, pages: doc.pages.filter((p) => p.id !== pageId) };
}

/** 重命名文档。 */
export function renameDocument(doc: DesignDocument, name: string): DesignDocument {
  return { ...doc, name };
}

/** 替换文档令牌集。 */
export function setDocumentTokens(
  doc: DesignDocument,
  tokens: DesignDocument['tokens'],
): DesignDocument {
  return { ...doc, tokens };
}

/** 插入节点（`index` 省略时追加到末尾 = 绘制在最上层）。 */
export function insertNode(
  doc: DesignDocument,
  pageId: PageId,
  node: SceneNode,
  parentId: NodeId | null,
  index?: number,
): DesignDocument {
  const page = getPage(doc, pageId);
  if (Object.hasOwn(page.nodes, node.id)) {
    throw domainError('duplicate-id', `节点 id 已存在：${node.id}`);
  }
  if (parentId !== null) {
    const parent = requireNode(page, parentId);
    if (!isContainer(parent)) {
      throw domainError('not-a-container', `父节点不是容器：${parentId}`);
    }
    const children = [...parent.children];
    children.splice(index ?? children.length, 0, node.id);
    return replacePage(doc, {
      ...page,
      nodes: { ...page.nodes, [node.id]: node, [parentId]: { ...parent, children } },
    });
  }
  const rootIds = [...page.rootIds];
  rootIds.splice(index ?? rootIds.length, 0, node.id);
  return replacePage(doc, {
    ...page,
    nodes: { ...page.nodes, [node.id]: node },
    rootIds,
  });
}

/** 批量插入（同一父级，按给定顺序）。 */
export function insertNodes(
  doc: DesignDocument,
  pageId: PageId,
  nodes: readonly SceneNode[],
  parentId: NodeId | null,
  index?: number,
): DesignDocument {
  let next = doc;
  let cursor = index;
  for (const node of nodes) {
    next = insertNode(next, pageId, node, parentId, cursor);
    if (cursor !== undefined) cursor += 1;
  }
  return next;
}

/** 删除节点及其子树。 */
export function removeNode(doc: DesignDocument, pageId: PageId, nodeId: NodeId): DesignDocument {
  const page = getPage(doc, pageId);
  if (!Object.hasOwn(page.nodes, nodeId)) {
    throw domainError('node-not-found', `节点不存在：${nodeId}`);
  }
  const toRemove = new Set<NodeId>([nodeId, ...collectRealDescendants(page, nodeId)]);
  const nodes: Record<NodeId, SceneNode> = {};
  for (const [id, node] of Object.entries(page.nodes)) {
    if (toRemove.has(id)) continue;
    nodes[id] = isContainer(node)
      ? { ...node, children: node.children.filter((childId) => !toRemove.has(childId)) }
      : node;
  }
  return replacePage(doc, {
    ...page,
    nodes,
    rootIds: page.rootIds.filter((id) => !toRemove.has(id)),
  });
}

/** 批量删除（父先于子时不重复处理）。 */
export function removeNodes(
  doc: DesignDocument,
  pageId: PageId,
  nodeIds: readonly NodeId[],
): DesignDocument {
  const page = getPage(doc, pageId);
  // 剔除已被其他待删节点包含的 id（避免「先删父再删子」报错）
  const set = new Set(nodeIds);
  const roots = nodeIds.filter((id) => {
    let parent = getParentId(page, id);
    while (parent !== null) {
      if (set.has(parent)) return false;
      parent = getParentId(page, parent);
    }
    return true;
  });
  let next = doc;
  for (const id of roots) {
    next = removeNode(next, pageId, id);
  }
  return next;
}

/** 子树内真实节点 id（不含自身）。 */
function collectRealDescendants(page: ScenePage, nodeId: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const stack: NodeId[] = [nodeId];
  while (stack.length > 0) {
    const current = stack.pop() as NodeId;
    const node = page.nodes[current];
    if (!node || !isContainer(node)) continue;
    for (const childId of node.children) {
      out.push(childId);
      stack.push(childId);
    }
  }
  return out;
}

/** 修改节点属性（局部坐标系内的 x/y/width/height）。 */
export function setNodeProps(
  doc: DesignDocument,
  pageId: PageId,
  nodeId: NodeId,
  patch: NodePatch,
): DesignDocument {
  const page = getPage(doc, pageId);
  const node = requireNode(page, nodeId);
  const next = { ...node } as SceneNode & Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'id' || key === 'type' || key === 'children' || key === 'componentId') continue;
    next[key] = value;
  }
  return replacePage(doc, { ...page, nodes: { ...page.nodes, [nodeId]: next as SceneNode } });
}

/** 批量修改属性。 */
export function setNodesProps(
  doc: DesignDocument,
  pageId: PageId,
  nodeIds: readonly NodeId[],
  patch: NodePatch,
): DesignDocument {
  let next = doc;
  for (const id of nodeIds) next = setNodeProps(next, pageId, id, patch);
  return next;
}

/** 改变父级（`index` 省略时追加到末尾）。 */
export function reparentNode(
  doc: DesignDocument,
  pageId: PageId,
  nodeId: NodeId,
  parentId: NodeId | null,
  index?: number,
): DesignDocument {
  const page = getPage(doc, pageId);
  requireNode(page, nodeId);
  if (parentId === nodeId) {
    throw domainError('cycle', '不能把节点放进自身');
  }
  if (parentId !== null) {
    const parent = requireNode(page, parentId);
    if (!isContainer(parent)) throw domainError('not-a-container', `父节点不是容器：${parentId}`);
    if (isSelfOrDescendant(page, parentId, nodeId)) {
      throw domainError('cycle', '不能把节点放进自己的子树');
    }
  }

  const oldParentId = getParentId(page, nodeId);
  const nodes: Record<NodeId, SceneNode> = { ...page.nodes };
  let rootIds = [...page.rootIds];

  // 1) 从旧父级摘除
  if (oldParentId === null) {
    rootIds = rootIds.filter((id) => id !== nodeId);
  } else {
    const oldParent = nodes[oldParentId];
    if (oldParent && isContainer(oldParent)) {
      nodes[oldParentId] = {
        ...oldParent,
        children: oldParent.children.filter((id) => id !== nodeId),
      };
    }
  }

  // 2) 挂到新父级
  if (parentId === null) {
    rootIds.splice(index ?? rootIds.length, 0, nodeId);
  } else {
    const parent = nodes[parentId] as SceneNode;
    if (isContainer(parent)) {
      const children = [...parent.children];
      children.splice(index ?? children.length, 0, nodeId);
      nodes[parentId] = { ...parent, children };
    }
  }

  return replacePage(doc, { ...page, nodes, rootIds });
}

/** `candidateId` 是否为 `nodeId` 的后代（含自身）。 */
function isSelfOrDescendant(page: ScenePage, candidateId: NodeId, nodeId: NodeId): boolean {
  if (candidateId === nodeId) return true;
  return collectRealDescendants(page, nodeId).includes(candidateId);
}

/** 平移节点（`delta` 位于节点父坐标系）。 */
export function moveNodes(
  doc: DesignDocument,
  pageId: PageId,
  moves: readonly { id: NodeId; dx: number; dy: number }[],
): DesignDocument {
  const page = getPage(doc, pageId);
  const nodes: Record<NodeId, SceneNode> = { ...page.nodes };
  for (const { id, dx, dy } of moves) {
    const node = nodes[id];
    if (!node) throw domainError('node-not-found', `节点不存在：${id}`);
    nodes[id] = { ...node, x: node.x + dx, y: node.y + dy };
  }
  return replacePage(doc, { ...page, nodes });
}

/** 层级调整（同级内）。 */
export function reorderNode(
  doc: DesignDocument,
  pageId: PageId,
  nodeId: NodeId,
  op: ZOrderOp,
): DesignDocument {
  const page = getPage(doc, pageId);
  requireNode(page, nodeId);
  const parentId = getParentId(page, nodeId);
  const siblings =
    parentId === null
      ? [...page.rootIds]
      : [...(requireNode(page, parentId) as SceneNode & { children: NodeId[] }).children];
  const currentIndex = siblings.indexOf(nodeId);
  if (currentIndex < 0) throw domainError('node-not-found', `节点不在其父级子列表中：${nodeId}`);

  const targetIndex = ((): number => {
    switch (op) {
      case 'front':
        return siblings.length - 1;
      case 'back':
        return 0;
      case 'forward':
        return Math.min(siblings.length - 1, currentIndex + 1);
      case 'backward':
        return Math.max(0, currentIndex - 1);
    }
  })();

  if (targetIndex === currentIndex) return doc;
  const nextSiblings = [...siblings];
  nextSiblings.splice(currentIndex, 1);
  nextSiblings.splice(targetIndex, 0, nodeId);

  if (parentId === null) {
    return replacePage(doc, { ...page, rootIds: nextSiblings });
  }
  const parent = requireNode(page, parentId);
  return replacePage(doc, {
    ...page,
    nodes: { ...page.nodes, [parentId]: { ...parent, children: nextSiblings } as SceneNode },
  });
}

/** 整体替换覆盖表（实例）。 */
export function setInstanceOverrides(
  doc: DesignDocument,
  pageId: PageId,
  instanceId: NodeId,
  overrides: Record<string, NodePatch>,
): DesignDocument {
  const page = getPage(doc, pageId);
  const node = requireNode(page, instanceId);
  if (node.type !== 'instance') {
    throw domainError('not-an-instance', `节点不是实例：${instanceId}`);
  }
  return replacePage(doc, {
    ...page,
    nodes: { ...page.nodes, [instanceId]: { ...node, overrides } },
  });
}
