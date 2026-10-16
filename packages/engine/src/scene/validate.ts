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
    | 'missing-page'
    /** 节点形状缺字段/类型不对（不受信输入的守门，B5）。 */
    | 'missing-field'
    /** NaN / ±Infinity（序列化会静默折成 null → 类型漂移，B2）。 */
    | 'non-finite-number';
  message: string;
  pageId?: PageId;
  nodeId?: NodeId;
  /** 定位到具体字段的路径（如 `pages[0].nodes.r.width`）。 */
  path?: string;
}

/** 已知节点类型（不受信输入的守门用）。 */
const KNOWN_NODE_TYPES: ReadonlySet<string> = new Set([
  'rect',
  'ellipse',
  'text',
  'frame',
  'group',
  'component',
  'component_set',
  'instance',
]);

/** 节点必须携带的数值字段（几何与外观标量）。 */
const REQUIRED_NODE_NUMBERS = ['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const;

/** 节点必须携带的布尔字段。 */
const REQUIRED_NODE_BOOLEANS = ['visible', 'locked'] as const;

/**
 * 递归收集非有限数值（NaN/±Infinity）及其路径。
 *
 * 为什么单独抽出来：Design IR 的数值一旦非有限，稳定序列化会**静默**折成 null
 * （JSON 语义），文档从此类型漂移且校验无感（B2）。命令载荷、文档、剪贴板载荷
 * 三条入口共用这一把尺子。`depth` 上限防止不受信输入用超深嵌套打爆递归栈。
 */
export function collectNonFiniteNumbers(
  value: unknown,
  path = '',
  out: Array<{ path: string; value: number }> = [],
  depth = 0,
): Array<{ path: string; value: number }> {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push({ path: path === '' ? '(根)' : path, value });
    return out;
  }
  if (value === null || typeof value !== 'object' || depth >= 64) return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectNonFiniteNumbers(item, `${path}[${index}]`, out, depth + 1);
    });
    return out;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    collectNonFiniteNumbers(item, path === '' ? key : `${path}.${key}`, out, depth + 1);
  }
  return out;
}

/**
 * 节点形状校验（结构 + 类型，不判数值有限性——后者由 `collectNonFiniteNumbers` 报出）。
 * 文档校验与剪贴板载荷校验（B5）同口径复用。
 */
export function validateNodeShape(node: unknown, path: string): DocumentIssue[] {
  const issues: DocumentIssue[] = [];
  if (node === null || typeof node !== 'object') {
    return [{ code: 'missing-field', message: `${path} 不是节点对象`, path }];
  }
  const record = node as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.length === 0) {
    issues.push({
      code: 'missing-field',
      message: `${path}.id 缺失或不是字符串`,
      path: `${path}.id`,
    });
  }
  if (typeof record.type !== 'string' || !KNOWN_NODE_TYPES.has(record.type)) {
    issues.push({
      code: 'missing-field',
      message: `${path}.type 不是已知节点类型：${String(record.type)}`,
      path: `${path}.type`,
    });
  }
  if (typeof record.name !== 'string') {
    issues.push({
      code: 'missing-field',
      message: `${path}.name 缺失或不是字符串`,
      path: `${path}.name`,
    });
  }
  for (const field of REQUIRED_NODE_NUMBERS) {
    if (typeof record[field] !== 'number') {
      issues.push({
        code: 'missing-field',
        message: `${path}.${field} 缺失或不是数值：${String(record[field])}`,
        path: `${path}.${field}`,
      });
    }
  }
  for (const field of REQUIRED_NODE_BOOLEANS) {
    if (typeof record[field] !== 'boolean') {
      issues.push({
        code: 'missing-field',
        message: `${path}.${field} 缺失或不是布尔值：${String(record[field])}`,
        path: `${path}.${field}`,
      });
    }
  }
  return issues;
}

/** 校验单个页面。 */
export function validatePage(page: ScenePage, options: { path?: string } = {}): DocumentIssue[] {
  const issues: DocumentIssue[] = [];
  const base = options.path ?? `pages[${page.id}]`;
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

  // 6) 节点形状与非有限数（不受信输入/外部构造的文档在这里被打回，B2/B5）
  for (const [nodeId, node] of Object.entries(page.nodes)) {
    const nodePath = `${base}.nodes.${nodeId}`;
    for (const issue of validateNodeShape(node, nodePath)) {
      issues.push({ ...issue, pageId: page.id, nodeId });
    }
    for (const bad of collectNonFiniteNumbers(node, nodePath)) {
      issues.push({
        code: 'non-finite-number',
        message: `${bad.path} 不是有限数：${String(bad.value)}`,
        pageId: page.id,
        nodeId,
        path: bad.path,
      });
    }
  }
  for (const bad of collectNonFiniteNumbers(page.grid, `${base}.grid`)) {
    issues.push({
      code: 'non-finite-number',
      message: `${bad.path} 不是有限数：${String(bad.value)}`,
      pageId: page.id,
      path: bad.path,
    });
  }

  return issues;
}

/** 校验整份文档。 */
export function validateDocument(doc: DesignDocument): DocumentIssue[] {
  const issues: DocumentIssue[] = [];
  const seen = new Set<PageId>();
  for (const [index, page] of doc.pages.entries()) {
    if (seen.has(page.id)) {
      issues.push({ code: 'duplicate-page', message: `页面 id 重复：${page.id}`, pageId: page.id });
    }
    seen.add(page.id);
    issues.push(...validatePage(page, { path: `pages[${index}]` }));
  }
  if (doc.pages.length === 0) {
    issues.push({ code: 'missing-page', message: '文档没有任何页面' });
  }
  for (const bad of collectNonFiniteNumbers(doc.tokens, 'tokens')) {
    issues.push({
      code: 'non-finite-number',
      message: `${bad.path} 不是有限数：${String(bad.value)}`,
      path: bad.path,
    });
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

/** 深冻结任意值（文档/命令载荷的快照语义；任何就地写入立刻暴露）。 */
export function deepFreeze<T>(value: T): T {
  const freeze = (target: unknown): void => {
    if (target === null || typeof target !== 'object' || Object.isFrozen(target)) return;
    Object.freeze(target);
    for (const key of Object.keys(target as object)) {
      freeze((target as Record<string, unknown>)[key]);
    }
  };
  freeze(value);
  return value;
}

/** 深冻结文档（测试用：任何绕过命令栈的直接写入都会立刻暴露）。 */
export function deepFreezeDocument(doc: DesignDocument): DesignDocument {
  return deepFreeze(doc);
}

/** 节点的可枚举属性键（序列化/差异比较用）。 */
export function nodeKeys(node: SceneNode): string[] {
  return Object.keys(node).sort();
}
