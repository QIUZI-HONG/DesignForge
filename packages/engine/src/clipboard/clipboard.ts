/**
 * 复制 / 粘贴 / 副本（白名单第 7 类）。
 *
 * 设计：剪贴板载荷是**自包含**的（顶层 id + 扁平节点前序快照），因此可跨页面、跨窗口传递
 * （`serializeClipboard` → JSON 字符串，落系统剪贴板由 FE-06 负责）。
 * 粘贴时做 **id 重映射**：所有 id 换新，内部引用（children / 实例主组件 / 覆盖路径）一并改写；
 * 指向载荷之外的引用（如外部主组件）保持原值，语义不变。
 */

import { parentIdOf, siblingIndexOf } from '../commands/helpers';
import type { Command } from '../commands/types';
import type { Point } from '../geometry/types';
import { ID_PREFIX, type IdFactory, systemIdFactory } from '../model/ids';
import type { ComponentId, NodeId, PageId, SceneNode, ScenePage } from '../model/index';
import { childrenOf, isContainer } from '../model/index';
import { domainError } from '../scene/errors';
import { getDescendantIds } from '../scene/query';
import { collectNonFiniteNumbers, type DocumentIssue, validateNodeShape } from '../scene/validate';

/** 载荷格式标识（版本化，便于后续演进）。 */
export const CLIPBOARD_FORMAT = 'dforge.clipboard' as const;

/** 剪贴板版本。 */
export const CLIPBOARD_VERSION = 1;

/** 剪贴板载荷。 */
export interface ClipboardPayload {
  $format: typeof CLIPBOARD_FORMAT;
  $version: number;
  /** 来源页面（溯源；粘贴到别的页面时不影响结构）。 */
  sourcePageId: PageId;
  /** 顶层节点 id（绘制顺序：后者在上）。 */
  rootIds: NodeId[];
  /** 扁平节点快照（前序：父先于子）。 */
  nodes: SceneNode[];
}

/** 默认粘贴偏移（Figma 粘贴手感）。 */
export const PASTE_OFFSET: Point = { x: 10, y: 10 };

/** 取子树节点（前序：父先于子，只含真实节点）。 */
function subtreePreOrder(page: ScenePage, rootId: NodeId): SceneNode[] {
  const root = page.nodes[rootId];
  if (!root) return [];
  const out: SceneNode[] = [root];
  const stack: SceneNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop() as SceneNode;
    for (const childId of childrenOf(current)) {
      const child = page.nodes[childId];
      if (!child) continue;
      out.push(child);
      stack.push(child);
    }
  }
  return out;
}

/** 复制：把选中子树（去重、保序）打成自包含载荷。 */
export function copyNodes(
  page: ScenePage,
  pageId: PageId,
  ids: readonly NodeId[],
): ClipboardPayload {
  const roots: NodeId[] = [];
  const collected = new Set<NodeId>();
  for (const id of ids) {
    if (!page.nodes[id]) continue;
    // 已被前面节点的子树覆盖则跳过
    if (collected.has(id)) continue;
    roots.push(id);
    for (const node of subtreePreOrder(page, id)) collected.add(node.id);
    // 记录后代，避免重复
    for (const descendantId of getDescendantIds(page, id)) collected.add(descendantId);
  }
  const nodes: SceneNode[] = [];
  const seen = new Set<NodeId>();
  for (const rootId of roots) {
    for (const node of subtreePreOrder(page, rootId)) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      nodes.push(node);
    }
  }
  return {
    $format: CLIPBOARD_FORMAT,
    $version: CLIPBOARD_VERSION,
    sourcePageId: pageId,
    rootIds: roots,
    nodes,
  };
}

/** 载荷中的节点数（状态栏/调试）。 */
export function clipboardSize(payload: ClipboardPayload): number {
  return payload.nodes.length;
}

/**
 * 序列化为 JSON 字符串（落系统剪贴板前的一步）。
 *
 * 出站守门（与 B2 文档序列化同口径）：非有限数会被 JSON **静默**折成 null（类型漂移），
 * 落进系统剪贴板后就是畸形载荷（接收端也会拒），故在出站侧直接拒绝并给出路径。
 */
export function serializeClipboard(payload: ClipboardPayload): string {
  const bad = collectNonFiniteNumbers(payload);
  if (bad.length > 0) {
    throw domainError(
      'invalid-argument',
      `剪贴板载荷含非有限数值（NaN/±Infinity），拒绝序列化：${bad
        .map((item) => `${item.path}=${String(item.value)}`)
        .join('、')}`,
    );
  }
  return JSON.stringify(payload);
}

/**
 * 载荷自检：**与文档校验同口径**（`scene/validate` 复用）——节点形状（必填字段与类型）、
 * 非有限数、顶层/子级引用悬空、重复 id/重复引用、多父、环、不可达节点（会被静默插成顶层 → 走私）。
 * 系统剪贴板是不受信输入，任何一处不合法都整包拒绝，而不是把畸形节点写进文档（B5）。
 *
 * 注：实例的**外部**主组件引用是合法载荷的一部分（跨页粘贴靠 `componentRemap` 接手），
 * 故不套用文档校验的 missing-component/missing-component-set。
 */
function validateClipboardPayload(payload: ClipboardPayload): DocumentIssue[] {
  const issues: DocumentIssue[] = [];
  const ids = new Set<NodeId>();
  const childrenById = new Map<NodeId, NodeId[]>();

  payload.nodes.forEach((node, index) => {
    const nodePath = `nodes[${index}]`;
    for (const issue of validateNodeShape(node, nodePath)) {
      issues.push(issue);
    }
    for (const bad of collectNonFiniteNumbers(node, nodePath)) {
      issues.push({
        code: 'non-finite-number',
        message: `${bad.path} 不是有限数：${String(bad.value)}`,
        path: bad.path,
      });
    }
    const raw = node as unknown as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id : null;
    if (id === null) return; // 缺 id 已由形状校验报出
    if (ids.has(id)) {
      issues.push({
        code: 'duplicate-child',
        message: `载荷内节点 id 重复：${id}`,
        nodeId: id,
        path: nodePath,
      });
    }
    ids.add(id);
    childrenById.set(id, childrenOf(node));
  });

  // 顶层引用必须落在载荷内
  payload.rootIds.forEach((rootId, index) => {
    if (typeof rootId !== 'string') {
      issues.push({
        code: 'missing-field',
        message: `rootIds[${index}] 不是字符串：${String(rootId)}`,
        path: `rootIds[${index}]`,
      });
      return;
    }
    if (!ids.has(rootId)) {
      issues.push({
        code: 'missing-root',
        message: `载荷顶层节点不在节点表内：${rootId}`,
        nodeId: rootId,
        path: `rootIds[${index}]`,
      });
    }
  });

  // 子级引用必须落在载荷内（否则粘贴时静默丢子树）；同一父级下重复引用与多父一并拒收：
  // 重复引用会被静默折叠成一次，多父会让粘贴只挂到最后一个父级、另一份子树无声丢失
  const parentIdsByChild = new Map<NodeId, Set<NodeId>>();
  for (const [parentId, childIds] of childrenById) {
    const localSeen = new Set<NodeId>();
    childIds.forEach((childId, index) => {
      if (!ids.has(childId)) {
        issues.push({
          code: 'missing-child',
          message: `载荷内子节点缺失：${childId}（父 ${parentId}）`,
          nodeId: childId,
          path: `nodes.${parentId}.children[${index}]`,
        });
        return;
      }
      if (localSeen.has(childId)) {
        issues.push({
          code: 'duplicate-child',
          message: `同一父级下重复子引用：${childId}（父 ${parentId}）`,
          nodeId: childId,
          path: `nodes.${parentId}.children[${index}]`,
        });
        return;
      }
      localSeen.add(childId);
      const parents = parentIdsByChild.get(childId) ?? new Set<NodeId>();
      parents.add(parentId);
      parentIdsByChild.set(childId, parents);
    });
  }
  for (const [childId, parents] of parentIdsByChild) {
    if (parents.size > 1) {
      issues.push({
        code: 'multiple-parents',
        message: `载荷内节点被多个父级引用：${childId}（${[...parents].join('、')}）`,
        nodeId: childId,
        path: `nodes.${childId}`,
      });
    }
  }

  // 顶层重复引用：同一 id 会被插入两遍（撞 duplicate-id）
  const rootSeen = new Set<NodeId>();
  payload.rootIds.forEach((rootId, index) => {
    if (typeof rootId !== 'string') return; // 非字符串已由上面的必填校验报出
    if (rootSeen.has(rootId)) {
      issues.push({
        code: 'duplicate-child',
        message: `载荷顶层重复引用：${rootId}`,
        nodeId: rootId,
        path: `rootIds[${index}]`,
      });
      return;
    }
    rootSeen.add(rootId);
  });

  // 环：粘贴会产出「节点以自身为父」的命令 → 与文档校验同口径拒收
  const cyclicId = findPayloadCycle(childrenById, ids);
  if (cyclicId !== null) {
    issues.push({
      code: 'cycle',
      message: `载荷内节点树存在环：${cyclicId}`,
      nodeId: cyclicId,
      path: `nodes.${cyclicId}`,
    });
  }

  // 从 rootIds 出发计算可达集：不可达节点会在粘贴时被静默插成顶层 → 拒收
  const reachable = new Set<NodeId>();
  const stack: NodeId[] = [...payload.rootIds];
  while (stack.length > 0) {
    const current = stack.pop() as NodeId;
    if (reachable.has(current) || !childrenById.has(current)) continue;
    reachable.add(current);
    stack.push(...(childrenById.get(current) ?? []));
  }
  for (const id of ids) {
    if (!reachable.has(id)) {
      issues.push({
        code: 'orphan-node',
        message: `载荷内节点不可达（不在 rootIds 之下）：${id}`,
        nodeId: id,
        path: `nodes.${id}`,
      });
    }
  }

  return issues;
}

/**
 * 载荷环检测（迭代 DFS，返回构成回边的节点 id；无环为 null）。
 *
 * 显式栈而非递归：不受信载荷可能有极深嵌套，递归会在解析/悬挂阶段爆栈
 * （对照 serialize-edges 记录的深嵌套证据）。父 id 会被跳过——环靠「回边」判定。
 */
function findPayloadCycle(
  childrenById: ReadonlyMap<NodeId, NodeId[]>,
  ids: ReadonlySet<NodeId>,
): NodeId | null {
  /** 0/缺省 = 未访问；1 = 在当前 DFS 路径上；2 = 已完成。 */
  const state = new Map<NodeId, 1 | 2>();
  for (const startId of ids) {
    if (state.has(startId)) continue;
    const stack: Array<{ id: NodeId; next: number }> = [{ id: startId, next: 0 }];
    state.set(startId, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as { id: NodeId; next: number };
      const children = (childrenById.get(frame.id) ?? []).filter((childId) => ids.has(childId));
      if (frame.next >= children.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const childId = children[frame.next] as NodeId;
      frame.next += 1;
      const childState = state.get(childId);
      if (childState === 1) return childId; // 回边 → 环
      if (childState === 2) continue; // 多父 DAG：已完成的子树无需重走
      state.set(childId, 1);
      stack.push({ id: childId, next: 0 });
    }
  }
  return null;
}

/** 解析剪贴板字符串（校验信封 + 载荷自检；不合法的载荷整包拒绝）。 */
export function parseClipboard(input: string | unknown): ClipboardPayload {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      throw domainError('invalid-argument', '剪贴板内容不是合法 JSON');
    }
  }
  const payload = raw as Partial<ClipboardPayload> | null;
  if (
    !payload ||
    payload.$format !== CLIPBOARD_FORMAT ||
    typeof payload.$version !== 'number' ||
    typeof payload.sourcePageId !== 'string' ||
    !Array.isArray(payload.rootIds) ||
    !Array.isArray(payload.nodes)
  ) {
    throw domainError(
      'invalid-argument',
      '剪贴板内容格式不合法（缺少 dforge.clipboard 标识或字段缺失）',
    );
  }
  const issues = validateClipboardPayload(payload as ClipboardPayload);
  if (issues.length > 0) {
    throw domainError(
      'invalid-argument',
      `剪贴板载荷非法：${issues.map((issue) => `${issue.code}:${issue.message}`).join('；')}`,
    );
  }
  return payload as ClipboardPayload;
}

/** 载荷内的全部 id。 */
export function clipboardIds(payload: ClipboardPayload): NodeId[] {
  return payload.nodes.map((node) => node.id);
}

/** 重映射选项。 */
export interface PasteOptions {
  pageId: PageId;
  /** 目标父级（null = 页面顶层）。 */
  parentId?: NodeId | null;
  index?: number | undefined;
  /** 世界偏移（相对坐标，父坐标系）。 */
  offset?: Point;
  /** id 工厂（测试注入确定性工厂）。 */
  ids?: IdFactory;
  /** 载荷内引用的**外部主组件**替换表（跨页面粘贴时使用）。 */
  componentRemap?: Record<ComponentId, ComponentId>;
}

/** 建立旧 id → 新 id 映射。 */
export function remapIds(payload: ClipboardPayload, ids: IdFactory): Map<NodeId, NodeId> {
  const map = new Map<NodeId, NodeId>();
  for (const node of payload.nodes) {
    const prefix =
      node.type === 'group'
        ? ID_PREFIX.group
        : node.type === 'component'
          ? ID_PREFIX.component
          : node.type === 'instance'
            ? ID_PREFIX.instance
            : ID_PREFIX.node;
    map.set(node.id, ids.next(prefix));
  }
  return map;
}

/** 按映射改写单个节点（id / children / 实例主组件 / 覆盖路径）。 */
export function remapNode(
  node: SceneNode,
  map: Map<NodeId, NodeId>,
  componentRemap: Record<ComponentId, ComponentId> = {},
): SceneNode {
  const next: Record<string, unknown> = { ...node } as unknown as Record<string, unknown>;
  next.id = map.get(node.id) ?? node.id;

  if (
    node.type === 'frame' ||
    node.type === 'group' ||
    node.type === 'component' ||
    node.type === 'component_set'
  ) {
    next.children = node.children.map((childId) => map.get(childId) ?? childId);
  }
  if (node.type === 'component' && node.componentSetId !== null) {
    next.componentSetId =
      map.get(node.componentSetId) ?? componentRemap[node.componentSetId] ?? node.componentSetId;
  }
  if (node.type === 'instance') {
    next.componentId =
      map.get(node.componentId) ?? componentRemap[node.componentId] ?? node.componentId;
    const overrides: Record<string, unknown> = {};
    for (const [key, patch] of Object.entries(node.overrides)) {
      const remappedKey = key
        .split('/')
        .map((segment) => map.get(segment) ?? segment)
        .join('/');
      overrides[remappedKey] = patch;
    }
    next.overrides = overrides;
  }
  return next as unknown as SceneNode;
}

/**
 * 把载荷翻译成粘贴命令。
 *
 * 结构还原方式：每个节点都以**空 children** 插入，子节点按「原父级 children 下标」依次插入，
 * 这样 `scene/mutate.insertNode` 会精确重建树形与绘制顺序。
 */
export function pasteCommands(payload: ClipboardPayload, options: PasteOptions): Command[] {
  const ids = options.ids ?? systemIdFactory;
  const offset = options.offset ?? PASTE_OFFSET;
  const targetParentId = options.parentId ?? null;
  const map = remapIds(payload, ids);

  // 原始父子关系与下标（载荷自带前序，故插入顺序天然「父先于子」）
  const oldParentOf = new Map<NodeId, NodeId | null>();
  const indexInParent = new Map<NodeId, number>();
  for (const rootId of payload.rootIds) oldParentOf.set(rootId, null);
  for (const node of payload.nodes) {
    childrenOf(node).forEach((childId, index) => {
      oldParentOf.set(childId, node.id);
      indexInParent.set(childId, index);
    });
  }

  const commands: Command[] = [];
  for (const node of payload.nodes) {
    const newId = map.get(node.id);
    if (!newId) continue;
    const oldParent = oldParentOf.get(node.id) ?? null;
    const remapped = remapNode(node, map, options.componentRemap ?? {});
    // 容器插入时清空 children，交由子节点的插入重建（叶子节点不带 children 字段）
    const insertNodeValue: SceneNode = isContainer(remapped)
      ? { ...remapped, children: [] }
      : remapped;
    const isRoot = oldParent === null;
    const withOffset = isRoot
      ? { ...insertNodeValue, x: insertNodeValue.x + offset.x, y: insertNodeValue.y + offset.y }
      : insertNodeValue;
    const command: Command = {
      type: 'node.insert',
      pageId: options.pageId,
      node: withOffset,
      parentId: isRoot ? targetParentId : (map.get(oldParent) ?? targetParentId),
    };
    const index = isRoot
      ? options.index === undefined
        ? undefined
        : options.index +
          (payload.rootIds.indexOf(node.id) >= 0 ? payload.rootIds.indexOf(node.id) : 0)
      : indexInParent.get(node.id);
    commands.push(index === undefined ? command : { ...command, index });
  }
  return commands;
}

/** 复制一份并偏移（Cmd+D）。 */
export function duplicateCommands(
  page: ScenePage,
  pageId: PageId,
  nodeIds: readonly NodeId[],
  options: { offset?: Point; ids?: IdFactory } = {},
): Command[] {
  if (nodeIds.length === 0) return [];
  const payload = copyNodes(page, pageId, nodeIds);
  const first = nodeIds[0] as NodeId;
  const offset = options.offset ?? { x: 0, y: 0 };
  const parentId = parentIdOf(page, first);
  const index = siblingIndexOf(page, first) + 1;
  const commandOptions: PasteOptions = { pageId, parentId, index, offset };
  if (options.ids) commandOptions.ids = options.ids;
  return pasteCommands(payload, commandOptions);
}
