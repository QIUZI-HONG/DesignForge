/**
 * 文档结构校验（不变式检查）。
 *
 * 用途：`serialize/parse` 的入口校验、导入外部文档时的守门、
 * 以及测试里对「任何一次写操作之后文档仍然自洽」的断言。
 * 返回问题列表（不抛错），调用方决定拒绝还是降级修复。
 *
 * 深度守门（修复批次 3 · A1）：校验、序列化前校验与导入解析三条路径共享**显式深度上限**，
 * 超限一律领域错误 / 问题项（含节点路径），不再让原生递归把栈打爆
 * （缺陷原貌：`TypeError: undefined is not a function` / `RangeError: Maximum call stack size exceeded`）。
 *
 * 两个上限的取值与理由（Node 24 默认栈，本机实测）：
 * - `MAX_NESTING_DEPTH = 512`：**节点链**深度（页面根沿 `children` 到该节点的节点数，含自身）。
 *   真实设计文档普遍在 50 层以内；原生递归实测要到 8000–16000 层才溢出，512 留出 16 倍以上余量。
 * - `MAX_VALUE_DEPTH = 2048`：**值结构**深度（对象/数组层数，覆盖未知字段与未来扩展）。
 *   Design IR 在 JSON 里是「节点平表 + id 引用」，节点链并不加深结构；该上限专门拦
 *   「未知字段里的超深对象」这类畸形载荷——实测 `sortKeysDeep` 到 8192 层仍安全（12000 溢出）、
 *   `JSON.stringify` 对文档形状在 8000 层仍安全，2048 已在阈值四分之一以下。
 */

import type { DesignDocument, NodeId, PageId, SceneNode, ScenePage } from '../model/index';
import { isContainer } from '../model/index';
import { domainError } from './errors';

/** 节点链深度上限（页面根沿 children 到该节点的节点数，含自身）。 */
export const MAX_NESTING_DEPTH = 512;

/** 值结构深度上限（对象/数组层数；节点平表下的 JSON 结构远浅于此）。 */
export const MAX_VALUE_DEPTH = 2048;

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
    | 'non-finite-number'
    /** 节点链嵌套超过 `MAX_NESTING_DEPTH`（A1：显式上限，替代原生栈溢出）。 */
    | 'max-depth-exceeded';
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

/** 节点链深度超限（首个越界节点 + 根到它的 id 链）。 */
export interface NodeDepthOverflow {
  nodeId: NodeId;
  /** 根到越界节点的 id 链（含两端）。 */
  chain: NodeId[];
}

/**
 * 节点链深度扫描（**迭代**，无递归）：沿 `rootIds → children` 走，返回首个链长超过
 * `maxDepth` 的节点；未超限返回 null。
 *
 * 为什么迭代：这正是要防的场景——用递归扫描超深输入，扫描器自己先爆栈。
 * 对畸形输入保持宽容（`nodes` 不是对象 / `rootIds` 或 `children` 不是数组 → 返回 null），
 * 让结构校验的其它问题去报，深度守门不抢戏。
 */
function findNodeDepthOverflow(
  page: ScenePage,
  maxDepth = MAX_NESTING_DEPTH,
): NodeDepthOverflow | null {
  const nodes: unknown = (page as { nodes?: unknown }).nodes;
  const rootIds: unknown = (page as { rootIds?: unknown }).rootIds;
  if (nodes === null || typeof nodes !== 'object' || !Array.isArray(rootIds)) return null;
  const table = nodes as Record<string, unknown>;
  const visited = new Set<string>();
  /** 首次到达时的父节点（越界时回溯根链用；只在访问时写入，链因此稳定）。 */
  const parents = new Map<string, string | null>();
  const stack: Array<{ id: string; depth: number; parent: string | null }> = [];
  for (let index = rootIds.length - 1; index >= 0; index -= 1) {
    const id = rootIds[index];
    if (typeof id === 'string') stack.push({ id, depth: 1, parent: null });
  }
  while (stack.length > 0) {
    const entry = stack.pop() as { id: string; depth: number; parent: string | null };
    if (visited.has(entry.id)) continue;
    visited.add(entry.id);
    if (!parents.has(entry.id)) parents.set(entry.id, entry.parent);
    if (entry.depth > maxDepth) {
      const chain: string[] = [];
      let cursor: string | null = entry.id;
      while (cursor !== null) {
        chain.unshift(cursor);
        cursor = parents.get(cursor) ?? null;
      }
      return { nodeId: entry.id, chain };
    }
    if (!Object.hasOwn(table, entry.id)) continue;
    const node = table[entry.id];
    if (!isContainer(node as SceneNode)) continue;
    const children: unknown = (node as { children?: unknown }).children;
    if (!Array.isArray(children)) continue;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const childId = children[index];
      if (typeof childId === 'string') {
        stack.push({ id: childId, depth: entry.depth + 1, parent: entry.id });
      }
    }
  }
  return null;
}

/** 值结构深度超限（首个越界对象/数组 + 其路径）。 */
export interface ValueDepthOverflow {
  path: string;
  depth: number;
}

/**
 * 结构深度扫描（**迭代**）：返回首个对象/数组层数超过 `maxDepth` 的值的路径；未超限返回 null。
 *
 * 去重按 DAG 语义（`WeakSet`）：JSON 解析产物没有共享引用，深度即路径深度；程序化构造的
 * 共享引用/环输入按「首次到达」计深，既终止环也避免共享子图被指数级重扫。
 */
function findValueDepthOverflow(
  value: unknown,
  maxDepth = MAX_VALUE_DEPTH,
): ValueDepthOverflow | null {
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; path: string; depth: number }> = [
    { value, path: '', depth: 1 },
  ];
  while (stack.length > 0) {
    const entry = stack.pop() as { value: unknown; path: string; depth: number };
    const item = entry.value;
    if (item === null || typeof item !== 'object') continue;
    if (entry.depth > maxDepth) {
      return { path: entry.path === '' ? '(根)' : entry.path, depth: entry.depth };
    }
    if (seen.has(item)) continue;
    seen.add(item);
    if (Array.isArray(item)) {
      for (let index = item.length - 1; index >= 0; index -= 1) {
        stack.push({ value: item[index], path: `${entry.path}[${index}]`, depth: entry.depth + 1 });
      }
      continue;
    }
    for (const [key, child] of Object.entries(item)) {
      stack.push({
        value: child,
        path: entry.path === '' ? key : `${entry.path}.${key}`,
        depth: entry.depth + 1,
      });
    }
  }
  return null;
}

/** 节点链的可读呈现：超长时只留首尾（首 = 根、尾 = 越界点），中段省略。 */
function formatNodeChain(chain: readonly NodeId[]): string {
  const head = 8;
  const tail = 4;
  if (chain.length <= head + tail + 1) return chain.join(' → ');
  return `${chain.slice(0, head).join(' → ')} → … → ${chain.slice(-tail).join(' → ')}`;
}

/** 值路径的可读呈现：超过 8 段只留头 5 段与尾 3 段（别把上千段路径灌进错误载荷）。 */
function formatValuePath(path: string): string {
  const parts = path.split('.');
  if (parts.length <= 8) return path;
  return `${parts.slice(0, 5).join('.')} … ${parts.slice(-3).join('.')}（共 ${parts.length} 段）`;
}

/** 深度溢出 → 统一文案（问题项与各入口的领域错误同口径）。 */
function nodeDepthMessage(overflow: NodeDepthOverflow, label: string): string {
  return `${label}节点嵌套超过上限 ${MAX_NESTING_DEPTH} 层：${formatNodeChain(overflow.chain)}`;
}

/**
 * 页面级节点深度守门：超限抛 `DomainError('invalid-argument')`（含根链路径）。
 * 序列化入口（`serializeDocument` / `serializePage`）与导入入口共用。
 */
export function assertPageNodeDepthWithinLimit(page: unknown, label = '文档'): void {
  if (page === null || typeof page !== 'object') return;
  const overflow = findNodeDepthOverflow(page as ScenePage);
  if (overflow) throw domainError('invalid-argument', nodeDepthMessage(overflow, label));
}

/** 文档级节点深度守门（逐页；非数组 `pages` 交给结构校验去报）。 */
export function assertNodeDepthWithinLimit(document: unknown, label = '文档'): void {
  const pages: unknown = (document as { pages?: unknown } | null | undefined)?.pages;
  if (!Array.isArray(pages)) return;
  for (const page of pages) assertPageNodeDepthWithinLimit(page, label);
}

/** 结构深度守门：超限抛 `DomainError('invalid-argument')`（含路径，超长路径省略中段）。 */
export function assertValueDepthWithinLimit(value: unknown, label = '文档'): void {
  const overflow = findValueDepthOverflow(value);
  if (!overflow) return;
  throw domainError(
    'invalid-argument',
    `${label}结构嵌套超过上限 ${MAX_VALUE_DEPTH} 层：${formatValuePath(overflow.path)}`,
  );
}

/** 校验单个页面。 */
export function validatePage(page: ScenePage, options: { path?: string } = {}): DocumentIssue[] {
  const issues: DocumentIssue[] = [];
  const base = options.path ?? `pages[${page.id}]`;
  const parentCount = new Map<NodeId, number>();

  // 0) 深度守门（迭代扫描，先于一切递归）：超限即早退——越界子树不再参与其余检查，
  //    既避免递归 visit 触发原生栈溢出，也避免越界子树被误报成「孤立节点」刷屏。
  const overflow = findNodeDepthOverflow(page);
  if (overflow) {
    issues.push({
      code: 'max-depth-exceeded',
      message: nodeDepthMessage(overflow, ''),
      pageId: page.id,
      nodeId: overflow.nodeId,
      path: `${base}.nodes.${overflow.nodeId}`,
    });
    return issues;
  }

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
