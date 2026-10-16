/**
 * 场景层公开面：文档/页面/节点的读写（纯函数、不可变）、查询与结构校验。
 *
 * 写函数（`mutate`）返回新文档，**不修改**输入；对外部调用者而言，
 * 文档变更的唯一入口仍是 `commands/CommandStack`——`mutate` 是它的实现基础。
 */

export type { DomainErrorCode } from './errors';
export { DomainError, domainError, isDomainError } from './errors';
export type {
  ResolvedNodeTree,
  VirtualNodeLookup,
} from './instance';
export {
  applyNodePatch,
  clearOverrideAt,
  getVirtualChildrenIds,
  overriddenKeysOf,
  overrideAt,
  overrideKey,
  parseVirtualNodeId,
  resolveInstanceTree,
  resolveVirtualNode,
  setOverrideAt,
  virtualNodeId,
} from './instance';
export type { PagePatch, ZOrderOp } from './mutate';
export {
  addPage,
  findPage,
  getPage,
  insertNode,
  insertNodes,
  moveNodes,
  removeNode,
  removeNodes,
  removePage,
  renameDocument,
  reorderNode,
  reparentNode,
  replacePage,
  setDocumentTokens,
  setInstanceOverrides,
  setNodeProps,
  setNodesProps,
  updatePage,
} from './mutate';

export type { LayerTreeNode, PageIndex } from './query';
export {
  countNodes,
  createPageIndex,
  findNodes,
  getAncestors,
  getChildrenIds,
  getDescendantIds,
  getNode,
  getParentId,
  getRootNodes,
  getSubtreeIds,
  getTopmostAncestor,
  hasNode,
  isDescendantOf,
  layerTree,
  overriddenKeysOfId,
  requireNode,
  resolveNode,
  sortByZOrder,
  topmostIds,
  viewNodeOf,
  walkSubtree,
} from './query';
export type { DocumentIssue } from './validate';
export {
  assertValidDocument,
  collectNonFiniteNumbers,
  deepFreeze,
  deepFreezeDocument,
  nodeKeys,
  validateDocument,
  validateNodeShape,
  validatePage,
} from './validate';
