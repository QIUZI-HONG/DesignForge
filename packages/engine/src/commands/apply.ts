/**
 * 命令处理器：把命令施加到文档，并产出**逆命令**。
 *
 * 关键约定：
 * - 处理器只调用 `scene/mutate` 的纯函数，绝不就地修改输入文档；
 * - 逆命令由施加时的文档状态推导（旧值/旧父级/旧索引），因此撤销无需调用方配合；
 * - 一个复合命令（如删除子树）的逆可以是**一组**命令，按返回顺序依次施加即可还原。
 */

import type {
  DesignDocument,
  NodeId,
  NodePatch,
  PageId,
  PatchableKey,
  SceneNode,
  ScenePage,
} from '../model/index';
import { childrenOf, isContainer, pickPatch } from '../model/index';
import { domainError } from '../scene/errors';
import {
  addPage,
  getChildrenIds,
  getPage,
  getParentId,
  insertNode,
  moveNodes,
  removeNode,
  removePage,
  renameDocument,
  reorderNode,
  reparentNode,
  replacePage,
  requireNode,
  setDocumentTokens,
  setInstanceOverrides,
  setNodeProps,
  updatePage,
} from '../scene/index';
import {
  clearOverrideAt,
  overrideAt,
  resolveVirtualNode,
  setOverrideAt,
  virtualNodeId,
} from '../scene/instance';
import type { PagePatch } from '../scene/mutate';
import type { Command } from './types';

/** 施加结果：新文档 + 逆命令（按施加顺序）。 */
export interface ApplyResult {
  document: DesignDocument;
  inverse: Command[];
}

/** 从任意对象提取指定键（存在才提取），供逆命令记录旧值。 */
function pickKeys(source: object, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    if (Object.hasOwn(source, key)) out[key] = record[key];
  }
  return out;
}

/** 施加单条命令。命令非法时抛领域错误（调用方保证事务原子性）。 */
export function applyCommand(doc: DesignDocument, command: Command): ApplyResult {
  switch (command.type) {
    case 'node.insert': {
      const next = insertNode(doc, command.pageId, command.node, command.parentId, command.index);
      return {
        document: next,
        inverse: [{ type: 'node.remove', pageId: command.pageId, nodeId: command.node.id }],
      };
    }

    case 'node.remove': {
      const page = getPage(doc, command.pageId);
      const node = requireNode(page, command.nodeId);
      const parentId = getParentId(page, command.nodeId);
      const index = Math.max(0, getChildrenIds(page, parentId).indexOf(command.nodeId));
      const subtree = collectSubtreePreOrder(page, node);
      const next = removeNode(doc, command.pageId, command.nodeId);
      return {
        document: next,
        inverse: [
          {
            type: 'node.restore',
            pageId: command.pageId,
            rootId: command.nodeId,
            nodes: subtree,
            parentId,
            index,
          },
        ],
      };
    }

    case 'node.restore': {
      const page = getPage(doc, command.pageId);
      if (Object.hasOwn(page.nodes, command.rootId)) {
        throw domainError('duplicate-id', `节点 id 已存在：${command.rootId}`);
      }
      const nodes: Record<NodeId, SceneNode> = { ...page.nodes };
      for (const node of command.nodes) {
        if (Object.hasOwn(nodes, node.id)) {
          throw domainError('duplicate-id', `节点 id 已存在：${node.id}`);
        }
        nodes[node.id] = node;
      }
      // 快照里各父节点的 children 已含子引用 → 只需把根挂回父级/顶层的原位置
      const restored = reparentNode(
        replacePage(doc, { ...page, nodes }),
        command.pageId,
        command.rootId,
        command.parentId,
        command.index,
      );
      return {
        document: restored,
        inverse: [{ type: 'node.remove', pageId: command.pageId, nodeId: command.rootId }],
      };
    }

    case 'node.update': {
      const page = getPage(doc, command.pageId);
      const node = requireNode(page, command.nodeId);
      const previous = pickPatch(node, Object.keys(command.patch) as PatchableKey[]);
      const next = setNodeProps(doc, command.pageId, command.nodeId, command.patch);
      return {
        document: next,
        inverse: [
          { type: 'node.update', pageId: command.pageId, nodeId: command.nodeId, patch: previous },
        ],
      };
    }

    case 'node.move': {
      const moves = command.nodeIds.map((id) => ({ id, dx: command.dx, dy: command.dy }));
      const next = moveNodes(doc, command.pageId, moves);
      return {
        document: next,
        inverse: [
          {
            type: 'node.move',
            pageId: command.pageId,
            nodeIds: [...command.nodeIds],
            dx: -command.dx,
            dy: -command.dy,
          },
        ],
      };
    }

    case 'node.reparent': {
      const page = getPage(doc, command.pageId);
      requireNode(page, command.nodeId);
      const oldParentId = getParentId(page, command.nodeId);
      const oldIndex = Math.max(0, getChildrenIds(page, oldParentId).indexOf(command.nodeId));
      const next = reparentNode(
        doc,
        command.pageId,
        command.nodeId,
        command.parentId,
        command.index,
      );
      return {
        document: next,
        inverse: [
          {
            type: 'node.reparent',
            pageId: command.pageId,
            nodeId: command.nodeId,
            parentId: oldParentId,
            index: oldIndex,
          },
        ],
      };
    }

    case 'node.reorder': {
      const page = getPage(doc, command.pageId);
      requireNode(page, command.nodeId);
      const parentId = getParentId(page, command.nodeId);
      const oldIndex = Math.max(0, getChildrenIds(page, parentId).indexOf(command.nodeId));
      const next = reorderNode(doc, command.pageId, command.nodeId, command.op);
      return {
        document: next,
        inverse: [
          {
            type: 'node.reparent',
            pageId: command.pageId,
            nodeId: command.nodeId,
            parentId,
            index: oldIndex,
          },
        ],
      };
    }

    case 'instance.setOverride': {
      const page = getPage(doc, command.pageId);
      const instance = requireNode(page, command.instanceId);
      if (instance.type !== 'instance') {
        throw domainError('not-an-instance', `节点不是实例：${command.instanceId}`);
      }
      const previous = overrideAt(instance.overrides, command.path) ?? {};
      const newKeys = Object.keys(command.patch) as PatchableKey[];
      const restoredValues = pickKeys(previous, newKeys) as NodePatch;
      const restoredKeys = Object.keys(restoredValues) as PatchableKey[];
      const newlyAddedKeys = newKeys.filter((key) => !Object.hasOwn(previous, key));

      const overrides = setOverrideAt(instance.overrides, command.path, command.patch);
      const next = setInstanceOverrides(doc, command.pageId, command.instanceId, overrides);

      // 逆命令：原本就有的键 → 还原旧值；原本没有的键 → 重置掉
      const inverse: Command[] = [];
      if (newlyAddedKeys.length > 0) {
        inverse.push({
          type: 'instance.resetOverride',
          pageId: command.pageId,
          instanceId: command.instanceId,
          path: [...command.path],
          keys: newlyAddedKeys,
        });
      }
      if (restoredKeys.length > 0) {
        inverse.push({
          type: 'instance.setOverride',
          pageId: command.pageId,
          instanceId: command.instanceId,
          path: [...command.path],
          patch: restoredValues,
        });
      }
      return { document: next, inverse };
    }

    case 'instance.resetOverride': {
      const page = getPage(doc, command.pageId);
      const instance = requireNode(page, command.instanceId);
      if (instance.type !== 'instance') {
        throw domainError('not-an-instance', `节点不是实例：${command.instanceId}`);
      }
      const previous = overrideAt(instance.overrides, command.path);
      if (!previous) {
        throw domainError('invalid-argument', `该路径没有覆盖：${command.path.join('/')}`);
      }
      const keys = command.keys ?? (Object.keys(previous) as PatchableKey[]);
      const restoredValues = pickKeys(previous, keys) as NodePatch;
      const overrides = clearOverrideAt(instance.overrides, command.path, keys);
      const next = setInstanceOverrides(doc, command.pageId, command.instanceId, overrides);
      return {
        document: next,
        inverse:
          Object.keys(restoredValues).length > 0
            ? [
                {
                  type: 'instance.setOverride',
                  pageId: command.pageId,
                  instanceId: command.instanceId,
                  path: [...command.path],
                  patch: restoredValues,
                },
              ]
            : [],
      };
    }

    case 'instance.switchVariant': {
      const page = getPage(doc, command.pageId);
      const instance = requireNode(page, command.instanceId);
      if (instance.type !== 'instance') {
        throw domainError('not-an-instance', `节点不是实例：${command.instanceId}`);
      }
      const component = requireNode(page, command.componentId);
      if (component.type !== 'component') {
        throw domainError('not-a-component', `目标不是主组件：${command.componentId}`);
      }
      const next = replacePage(doc, {
        ...page,
        nodes: {
          ...page.nodes,
          [command.instanceId]: { ...instance, componentId: command.componentId },
        },
      });
      return {
        document: next,
        inverse: [
          {
            type: 'instance.switchVariant',
            pageId: command.pageId,
            instanceId: command.instanceId,
            componentId: instance.componentId,
          },
        ],
      };
    }

    case 'page.add': {
      const next = addPage(doc, command.page, command.index);
      return { document: next, inverse: [{ type: 'page.remove', pageId: command.page.id }] };
    }

    case 'page.remove': {
      const index = doc.pages.findIndex((page) => page.id === command.pageId);
      const page = getPage(doc, command.pageId);
      const next = removePage(doc, command.pageId);
      return {
        document: next,
        inverse: [{ type: 'page.add', page, index: Math.max(0, index) }],
      };
    }

    case 'page.update': {
      const page = getPage(doc, command.pageId);
      const previous: PagePatch = {};
      if (command.patch.name !== undefined) previous.name = page.name;
      if (command.patch.backgroundColor !== undefined)
        previous.backgroundColor = page.backgroundColor;
      if (command.patch.grid !== undefined) previous.grid = page.grid;
      const next = updatePage(doc, command.pageId, command.patch);
      return {
        document: next,
        inverse: [{ type: 'page.update', pageId: command.pageId, patch: previous }],
      };
    }

    case 'document.rename': {
      const previous = doc.name;
      return {
        document: renameDocument(doc, command.name),
        inverse: [{ type: 'document.rename', name: previous }],
      };
    }

    case 'document.setTokens': {
      const previous = doc.tokens;
      return {
        document: setDocumentTokens(doc, command.tokens),
        inverse: [{ type: 'document.setTokens', tokens: previous }],
      };
    }
  }
}

/** 从节点自身开始的子树快照（前序：父先于子），只含真实节点。 */
function collectSubtreePreOrder(page: ScenePage, root: SceneNode): SceneNode[] {
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

/** 校验实例内虚路径存在（实例覆盖类命令的前置检查）。 */
export function assertVirtualPath(
  doc: DesignDocument,
  pageId: PageId,
  instanceId: NodeId,
  path: readonly NodeId[],
): void {
  const page = getPage(doc, pageId);
  if (!resolveVirtualNode(page, virtualNodeId(instanceId, path))) {
    throw domainError('node-not-found', `实例内路径不存在：${virtualNodeId(instanceId, path)}`);
  }
}
