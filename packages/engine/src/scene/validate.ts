/**
 * 文档结构校验（不变式检查）。
 *
 * 用途：`serialize/parse` 的入口校验、导入外部文档时的守门、
 * 以及测试里对「任何一次写操作之后文档仍然自洽」的断言。
 * 返回问题列表（不抛错），调用方决定拒绝还是降级修复。
 */

import type { DesignDocument, NodeId, PageId, SceneNode, ScenePage } from '../model/index';
import { isContainer } from '../model/index';

/** 结构问题。 */
export interface DocumentIssue {
  code:
    | 'missing-root'
    | 'missing-child'
    | 'duplicate-child'
    | 'multiple-parents'
    | 'orphan-node'
    | 'cycle'
    | 'missing-component'
    | 'missing-component-set'
    | 'duplicate-page'
    | 'missing-page';
  message: string;
  pageId?: PageId;
  nodeId?: NodeId;
}

/** 校验单个页面。 */
export function validatePage(page: ScenePage): DocumentIssue[] {
  const issues: DocumentIssue[] = [];
  const parentCount = new Map<NodeId, number>();

  // 1) 收集父子关系（顶层 + 各容器的子列表），并计数「被引用次数」
  const bump = (id: NodeId): void => {
    parentCount.set(id, (parentCount.get(id) ?? 0) + 1);
  };
  const rootSeen = new Set<NodeId>();
  for (const id of page.rootIds) {
    if (!Object.hasOwn(page.nodes, id)) {
      issues.push({
        code: 'missing-root',
        message: `顶层节点不存在：${id}`,
        pageId: page.id,
        nodeId: id,
      });
      continue;
    }
    if (rootSeen.has(id)) {
      issues.push({
        code: 'duplicate-child',
        message: `节点在顶层列表中出现多次：${id}`,
        pageId: page.id,
        nodeId: id,
      });
      continue;
    }
    rootSeen.add(id);
    bump(id);
  }

  // 2) 各容器的子列表
  for (const node of Object.values(page.nodes)) {
    if (!isContainer(node)) continue;
    const localSeen = new Set<NodeId>();
    for (const childId of node.children) {
      if (!Object.hasOwn(page.nodes, childId)) {
        issues.push({
          code: 'missing-child',
          message: `子节点不存在：${childId}（父 ${node.id}）`,
          pageId: page.id,
          nodeId: childId,
        });
        continue;
      }
      if (localSeen.has(childId)) {
        issues.push({
          code: 'duplicate-child',
          message: `同一父节点下重复子节点：${childId}`,
          pageId: page.id,
          nodeId: childId,
        });
        continue;
      }
      localSeen.add(childId);
      bump(childId);
    }
  }

  // 3) 单父约束
  for (const [nodeId, count] of parentCount) {
    if (count > 1) {
      issues.push({
        code: 'multiple-parents',
        message: `节点被多个父级引用：${nodeId}`,
        pageId: page.id,
        nodeId,
      });
    }
  }

  // 4) 环与孤儿
  const reachable = new Set<NodeId>();
  const visit = (id: NodeId, stack: Set<NodeId>): void => {
    if (stack.has(id)) {
      issues.push({ code: 'cycle', message: `节点树存在环：${id}`, pageId: page.id, nodeId: id });
      return;
    }
    if (reachable.has(id)) return;
    reachable.add(id);
    stack.add(id);
    const node = page.nodes[id];
    if (node && isContainer(node)) {
      for (const childId of node.children) {
        if (Object.hasOwn(page.nodes, childId)) visit(childId, stack);
      }
    }
    stack.delete(id);
  };
  for (const id of page.rootIds) {
    if (Object.hasOwn(page.nodes, id)) visit(id, new Set());
  }
  for (const id of Object.keys(page.nodes)) {
    if (!reachable.has(id)) {
      issues.push({
        code: 'orphan-node',
        message: `孤立节点（不可达）：${id}`,
        pageId: page.id,
        nodeId: id,
      });
    }
  }

  // 5) 组件/组件集引用
  for (const node of Object.values(page.nodes)) {
    if (node.type === 'instance') {
      const component = page.nodes[node.componentId];
      if (component?.type !== 'component') {
        issues.push({
          code: 'missing-component',
          message: `实例的主组件缺失：${node.componentId}`,
          pageId: page.id,
          nodeId: node.id,
        });
      }
    }
    if (node.type === 'component' && node.componentSetId !== null) {
      const set = page.nodes[node.componentSetId];
      if (set?.type !== 'component_set') {
        issues.push({
          code: 'missing-component-set',
          message: `组件集缺失：${node.componentSetId}`,
          pageId: page.id,
          nodeId: node.id,
        });
      }
    }
  }

  return issues;
}

/** 校验整份文档。 */
export function validateDocument(doc: DesignDocument): DocumentIssue[] {
  const issues: DocumentIssue[] = [];
  const seen = new Set<PageId>();
  for (const page of doc.pages) {
    if (seen.has(page.id)) {
      issues.push({ code: 'duplicate-page', message: `页面 id 重复：${page.id}`, pageId: page.id });
    }
    seen.add(page.id);
    issues.push(...validatePage(page));
  }
  if (doc.pages.length === 0) {
    issues.push({ code: 'missing-page', message: '文档没有任何页面' });
  }
  return issues;
}

/** 断言文档自洽（测试与导入守门用）。 */
export function assertValidDocument(doc: DesignDocument): void {
  const issues = validateDocument(doc);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.code}:${issue.message}`).join('；');
    throw new Error(`文档结构非法：${detail}`);
  }
}

/** 深冻结文档（测试用：任何绕过命令栈的直接写入都会立刻暴露）。 */
export function deepFreezeDocument(doc: DesignDocument): DesignDocument {
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      freeze((value as Record<string, unknown>)[key]);
    }
  };
  freeze(doc);
  return doc;
}

/** 节点的可枚举属性键（序列化/差异比较用）。 */
export function nodeKeys(node: SceneNode): string[] {
  return Object.keys(node).sort();
}
