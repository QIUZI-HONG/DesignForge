/**
 * 复制 / 粘贴 / 副本（白名单第 7 类）。
 *
 * 设计：剪贴板载荷是**自包含**的（顶层 id + 扁平节点前序快照），因此可跨页面、跨窗口传递
 * （`serializeClipboard` → JSON 字符串，落系统剪贴板由 FE-06 负责）。
 * 粘贴时做 **id 重映射**：所有 id 换新，内部引用（children / 实例主组件 / 覆盖路径）一并改写；
 * 指向载荷之外的引用（如外部主组件）由 `componentRemap` 接手或经目标页快照确认仍在位；
 * 两者都不成立时**粘贴即降级**（实例 → 普通帧）——
 * 悬空引用不得进页面（票 17：写不校验、读全校验会让整份文档不可重开）。
 */

import { parentIdOf, siblingIndexOf } from '../commands/helpers';
import type { Command } from '../commands/types';
import {
  applyToPoint,
  identity,
  invert,
  rotateVector,
  worldMatrix,
  worldRotation,
} from '../geometry/index';
import type { Matrix, Point } from '../geometry/types';
import { ID_PREFIX, type IdFactory, systemIdFactory } from '../model/ids';
import type { ComponentId, NodeId, PageId, SceneNode, ScenePage } from '../model/index';
import { childrenOf, isContainer } from '../model/index';
import { domainError } from '../scene/errors';
import { getDescendantIds } from '../scene/query';
import { collectNonFiniteNumbers, type DocumentIssue, validateNodeShape } from '../scene/validate';

/** 载荷格式标识（版本化，便于后续演进）。 */
export const CLIPBOARD_FORMAT = 'dforge.clipboard' as const;

/**
 * 剪贴板版本。
 *
 * v2：新增可选 `rootOrigins`（顶层节点的复制时原级快照）——跨父级选区的再制/同文档粘贴
 * 据此「各归各父级」。字段可选，v1 载荷照常解析（走单目标旧路径）。
 */
export const CLIPBOARD_VERSION = 2;

/** 顶层节点的复制时原级信息（v2+）：各归各父级与跨父级回退换算的依据。 */
export interface ClipboardRootOrigin {
  /** 对应 rootIds 中的顶层节点 id。 */
  id: NodeId;
  /** 复制时的原父级（页面顶层为 null）。 */
  parentId: NodeId | null;
  /** 复制时父级坐标系（其子节点 x/y 所处坐标系）的世界矩阵快照。 */
  frame: Matrix;
  /** 复制时父级坐标系的旋转累计（度；与 frame 同源 worldRotation，避免从矩阵反解的三角误差）。 */
  frameRotation: number;
}

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
  /** 顶层节点的复制时原级信息（v2+；与 rootIds 一一对应）。 */
  rootOrigins?: ClipboardRootOrigin[];
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
  // 顶层节点的复制时原级快照：原父级 + 其坐标系的世界矩阵/旋转
  // （再制/同文档粘贴据此各归各父级；父级不在时据此把局部坐标换算回世界位置——B4）
  const rootOrigins: ClipboardRootOrigin[] = roots.map((rootId) => {
    const parentId = parentIdOf(page, rootId);
    return {
      id: rootId,
      parentId,
      frame: parentId === null ? identity() : worldMatrix(page, parentId),
      frameRotation: parentId === null ? 0 : worldRotation(page, parentId),
    };
  });
  return {
    $format: CLIPBOARD_FORMAT,
    $version: CLIPBOARD_VERSION,
    sourcePageId: pageId,
    rootIds: roots,
    nodes,
    rootOrigins,
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
 * 注：实例的**外部**主组件引用是合法载荷的一部分（粘贴时由 `componentRemap` 接手，或经
 * 目标页快照确认主组件仍在位；两者都不成立时 `pasteCommands` 把实例降级为普通帧），
 * 故载荷自检不套用文档校验的 missing-component/missing-component-set——降级口径见
 * `pasteCommands`（票 17：粘贴不得留下悬空引用）。
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

  // rootOrigins（v2+ 可选）：参与粘贴时的坐标换算，形状/非有限数同样整包拒收；
  // id 不在节点表内的条目无害（粘贴时按缺省回退处理），不做强校验
  if (payload.rootOrigins !== undefined) {
    const origins = payload.rootOrigins;
    if (!Array.isArray(origins)) {
      issues.push({
        code: 'missing-field',
        message: 'rootOrigins 不是数组',
        path: 'rootOrigins',
      });
    } else {
      origins.forEach((origin, index) => {
        const path = `rootOrigins[${index}]`;
        if (
          !origin ||
          typeof origin.id !== 'string' ||
          (origin.parentId !== null && typeof origin.parentId !== 'string')
        ) {
          issues.push({ code: 'missing-field', message: `${path} 形状不合法`, path });
          return;
        }
        const frame = (origin as { frame?: unknown }).frame;
        if (!frame || typeof frame !== 'object') {
          issues.push({
            code: 'missing-field',
            message: `${path}.frame 缺失`,
            path: `${path}.frame`,
          });
          return;
        }
        const matrix = frame as Record<string, unknown>;
        for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
          const value = matrix[key];
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            issues.push({
              code: 'non-finite-number',
              message: `${path}.frame.${key} 不是有限数：${String(value)}`,
              path: `${path}.frame.${key}`,
            });
          }
        }
        const frameRotation = (origin as { frameRotation?: unknown }).frameRotation;
        if (typeof frameRotation !== 'number' || !Number.isFinite(frameRotation)) {
          issues.push({
            code: 'non-finite-number',
            message: `${path}.frameRotation 不是有限数：${String(frameRotation)}`,
            path: `${path}.frameRotation`,
          });
        }
      });
    }
  }

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
  /**
   * 目标父级（null = 页面顶层）。**显式给定（非空）时优先于 restoreParents**：
   * 所有根节点经世界位置换算落入该容器（「粘贴进容器」语义）。
   */
  parentId?: NodeId | null;
  index?: number | undefined;
  /** 世界偏移（世界增量；父坐标系被旋转时按各父级坐标系换算，未旋转父级下与旧局部语义一致）。 */
  offset?: Point;
  /** id 工厂（测试注入确定性工厂）。 */
  ids?: IdFactory;
  /** 载荷内引用的**外部主组件**替换表（跨页面粘贴时使用）。 */
  componentRemap?: Record<ComponentId, ComponentId>;
  /** 目标页面快照（同文档粘贴/再制时传入）：判定记录的原父级是否仍在、换算目标父级坐标系。 */
  page?: ScenePage;
  /** 恢复各根节点的复制时原父级（再制 / 同文档粘贴语义，B4）；缺省 false = 单目标旧行为。 */
  restoreParents?: boolean;
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
 * 悬空组件引用降级（票 17）：remap 后的**外部**引用若无人接手——既不在载荷内（未被 id
 * 重映射改写）、也没有显式 `componentRemap` 接手、目标页快照里又不存在被引用节点——
 * 就地把实例降级为普通帧（几何/样式保持载荷原值；主组件虚节点不随复制），
 * 绝不把悬空引用写进页面。无目标页快照（跨文档粘贴）时存在性不可证 → 同样降级；
 * 显式给出 `componentRemap` 则视为调用方断言目标引用有效，原样放行。
 */
function settleComponentRefs(
  remapped: SceneNode,
  original: SceneNode,
  map: Map<NodeId, NodeId>,
  componentRemap: Record<ComponentId, ComponentId>,
  page: ScenePage | undefined,
): SceneNode {
  if (remapped.type === 'instance' && original.type === 'instance') {
    const targetId = remapped.componentId;
    // 载荷内主组件随复制（id 重映射接手）或显式 componentRemap 接手 → 引用有效
    if (map.has(original.componentId) || original.componentId in componentRemap) return remapped;
    if (page !== undefined && page.nodes[targetId]?.type === 'component') return remapped;
    const next: Record<string, unknown> = { ...remapped };
    delete next.componentId;
    delete next.overrides;
    next.type = 'frame';
    next.children = [];
    next.clipsContent = true;
    next.autoLayout = null;
    return next as unknown as SceneNode;
  }
  return remapped;
}

/** 单个根节点的落位决策（粘贴/再制共用的中间表示）。 */
interface RootPlacement {
  parentId: NodeId | null;
  index: number | undefined;
  x: number;
  y: number;
  /** undefined = 保持载荷原值（坐标未跨坐标系，无需改写）。 */
  rotation?: number | undefined;
  /** 恢复原父级且原节点仍在位：其在父级中的现下标（位移记账用）；undefined = 追加。 */
  anchorIndex?: number | undefined;
}

/**
 * 把载荷翻译成粘贴命令。
 *
 * 结构还原方式：每个节点都以**空 children** 插入，子节点按「原父级 children 下标」依次插入，
 * 这样 `scene/mutate.insertNode` 会精确重建树形与绘制顺序。
 *
 * 根节点落位（B4 跨父级选区）分三条路径：
 * - **各归各父级**（`restoreParents` 且记录的原父级仍在目标页面）：坐标保持原父级局部语义
 *   （副本与原节点同位），世界偏移按各父级坐标系的旋转换算；原节点仍在位时紧随其后插入。
 * - **跨父级回退**（restore 开启但记录的原父级已不在 / 显式 `parentId` 容器）：以复制时
 *   记录的父级坐标系快照换算出世界中心，再落入实际插入父级的坐标系——世界位置保持语义
 *   （与 `frameTransformPatch` 保世界坐标重挂同一套数学）。
 * - **单目标旧行为**（未开 restore / 旧载荷无原级记录）：全部根节点落 `parentId`，
 *   坐标原样 + 偏移（跨文档粘贴路径）。
 */
export function pasteCommands(payload: ClipboardPayload, options: PasteOptions): Command[] {
  const ids = options.ids ?? systemIdFactory;
  const offset = options.offset ?? PASTE_OFFSET;
  const targetParentId = options.parentId ?? null;
  const map = remapIds(payload, ids);
  const page = options.page;

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

  // 复制时原级信息（旧载荷没有 → 全部走单目标路径）
  const originOf = new Map<NodeId, ClipboardRootOrigin>();
  if (options.restoreParents) {
    for (const origin of payload.rootOrigins ?? []) {
      if (!originOf.has(origin.id)) originOf.set(origin.id, origin);
    }
  }

  const nodeById = new Map(payload.nodes.map((node) => [node.id, node]));

  /** 父级坐标系的旋转累计（页面顶层为 0；无页面快照时按 0 处理）。 */
  const frameRotationOf = (parentId: NodeId | null): number =>
    parentId === null || page === undefined ? 0 : worldRotation(page, parentId);

  /** 父级坐标系的世界矩阵（页面顶层 / 无页面快照为单位阵）。 */
  const frameMatrixOf = (parentId: NodeId | null): Matrix =>
    parentId === null || page === undefined ? identity() : worldMatrix(page, parentId);

  /** 世界偏移 → 父级局部偏移（父坐标系被旋转时增量需反向旋转）。 */
  const localOffsetInto = (parentId: NodeId | null): Point =>
    rotateVector(offset, -frameRotationOf(parentId));

  /** 旧行为的根节点下标（显式 index + 载荷内序）。 */
  const legacyRootIndex = (rootId: NodeId): number | undefined =>
    options.index === undefined
      ? undefined
      : options.index + Math.max(0, payload.rootIds.indexOf(rootId));

  // 能否做世界位置换算：目标是页面顶层（单位阵）或持有目标页面快照
  const canConvert = targetParentId === null || page !== undefined;

  const placements = new Map<NodeId, RootPlacement>();
  for (const rootId of payload.rootIds) {
    const node = nodeById.get(rootId);
    if (!node) continue;
    const origin = originOf.get(rootId);
    const restoreHit =
      origin !== undefined &&
      targetParentId === null &&
      (origin.parentId === null ||
        (page !== undefined && page.nodes[origin.parentId] !== undefined));
    if (restoreHit && origin) {
      // 各归各父级：坐标保持原父级局部语义（副本与原节点同位），偏移按该父级坐标系换算
      const local = localOffsetInto(origin.parentId);
      const anchored =
        origin.parentId !== null &&
        page !== undefined &&
        page.nodes[origin.parentId] !== undefined &&
        parentIdOf(page, rootId) === origin.parentId;
      placements.set(rootId, {
        parentId: origin.parentId,
        index: undefined,
        x: node.x + local.x,
        y: node.y + local.y,
        anchorIndex: anchored ? siblingIndexOf(page as ScenePage, rootId) : undefined,
      });
      continue;
    }
    if (origin && canConvert) {
      // 跨父级回退 / 显式容器：经复制时父级坐标系快照换算世界中心，再落入实际插入父级
      const worldCenter = applyToPoint(origin.frame, {
        x: node.x + node.width / 2,
        y: node.y + node.height / 2,
      });
      const localCenter = applyToPoint(invert(frameMatrixOf(targetParentId)), {
        x: worldCenter.x + offset.x,
        y: worldCenter.y + offset.y,
      });
      placements.set(rootId, {
        parentId: targetParentId,
        index: legacyRootIndex(rootId),
        x: localCenter.x - node.width / 2,
        y: localCenter.y - node.height / 2,
        rotation: node.rotation + origin.frameRotation - frameRotationOf(targetParentId),
      });
      continue;
    }
    // 旧行为：无原级记录 / 未开 restore / 无页面快照且目标非顶层 → 单目标、坐标原样 + 偏移
    placements.set(rootId, {
      parentId: targetParentId,
      index: legacyRootIndex(rootId),
      x: node.x + offset.x,
      y: node.y + offset.y,
    });
  }

  // 锚定根的位移记账：同父级内按原节点现下标升序，第 k 个 → index = 现下标 + 1 + k
  // （每个更早的同父锚点副本都插在其原节点之后、且在本原节点之前，恰好把本原节点推后 k 位）
  const anchorGroups = new Map<NodeId | null, NodeId[]>();
  for (const [rootId, placement] of placements) {
    if (placement.anchorIndex === undefined) continue;
    const group = anchorGroups.get(placement.parentId) ?? [];
    group.push(rootId);
    anchorGroups.set(placement.parentId, group);
  }
  for (const group of anchorGroups.values()) {
    group.sort(
      (a, b) => (placements.get(a)?.anchorIndex ?? 0) - (placements.get(b)?.anchorIndex ?? 0),
    );
    group.forEach((rootId, order) => {
      const placement = placements.get(rootId);
      if (placement) placement.index = (placement.anchorIndex as number) + 1 + order;
    });
  }

  // 发射顺序：同父级的锚定根按记账升序整组发射，其余保持载荷顺序
  const emission: NodeId[] = [];
  const emitted = new Set<NodeId>();
  for (const rootId of payload.rootIds) {
    if (emitted.has(rootId)) continue;
    const group =
      placements.get(rootId)?.anchorIndex !== undefined
        ? anchorGroups.get(placements.get(rootId)?.parentId ?? null)
        : undefined;
    if (group) {
      for (const id of group) {
        if (!emitted.has(id)) {
          emission.push(id);
          emitted.add(id);
        }
      }
    } else {
      emission.push(rootId);
      emitted.add(rootId);
    }
  }

  // 单遍把前序节点分桶到各自的根（桶内保持前序：根先于其后代）
  const rootSet = new Set(payload.rootIds);
  const nodesByRoot = new Map<NodeId, SceneNode[]>();
  let currentRoot: NodeId | null = null;
  for (const node of payload.nodes) {
    if (rootSet.has(node.id)) currentRoot = node.id;
    if (currentRoot === null) continue;
    const bucket = nodesByRoot.get(currentRoot);
    if (bucket) bucket.push(node);
    else nodesByRoot.set(currentRoot, [node]);
  }

  const commands: Command[] = [];
  for (const rootId of emission) {
    const placement = placements.get(rootId);
    const bucket = nodesByRoot.get(rootId);
    if (!placement || !bucket) continue;
    for (const node of bucket) {
      const newId = map.get(node.id);
      if (!newId) continue;
      const oldParent = oldParentOf.get(node.id) ?? null;
      const remapped = settleComponentRefs(
        remapNode(node, map, options.componentRemap ?? {}),
        node,
        map,
        options.componentRemap ?? {},
        page,
      );
      // 容器插入时清空 children，交由子节点的插入重建（叶子节点不带 children 字段）
      const insertNodeValue: SceneNode = isContainer(remapped)
        ? { ...remapped, children: [] }
        : remapped;
      const isPayloadRoot = node.id === rootId;
      let commandNode = insertNodeValue;
      let parentId: NodeId | null;
      let index: number | undefined;
      if (isPayloadRoot) {
        commandNode =
          placement.rotation === undefined
            ? { ...insertNodeValue, x: placement.x, y: placement.y }
            : {
                ...insertNodeValue,
                x: placement.x,
                y: placement.y,
                rotation: placement.rotation,
              };
        parentId = placement.parentId;
        index = placement.index;
      } else {
        // 子节点：挂到重映射后的原父级（载荷校验保证父先于子；oldParent 为 null 时兜底目标父级）
        parentId = oldParent === null ? targetParentId : (map.get(oldParent) ?? targetParentId);
        index = indexInParent.get(node.id);
      }
      const command: Command = {
        type: 'node.insert',
        pageId: options.pageId,
        node: commandNode,
        parentId,
      };
      commands.push(index === undefined ? command : { ...command, index });
    }
  }
  return commands;
}

/**
 * 复制一份并偏移（Cmd+D）：副本**各归各父级**、紧随原节点、世界位置保持。
 *
 * 跨父级选区再制时，旧实现把全部副本塞进第一个节点的父级且坐标不改算，
 * 画板外副本会被 `clipsContent` 裁剪成不可见（B4）；现走 restore 原父级路径。
 */
export function duplicateCommands(
  page: ScenePage,
  pageId: PageId,
  nodeIds: readonly NodeId[],
  options: { offset?: Point; ids?: IdFactory } = {},
): Command[] {
  if (nodeIds.length === 0) return [];
  const payload = copyNodes(page, pageId, nodeIds);
  const commandOptions: PasteOptions = {
    pageId,
    offset: options.offset ?? { x: 0, y: 0 },
    page,
    restoreParents: true,
  };
  if (options.ids) commandOptions.ids = options.ids;
  return pasteCommands(payload, commandOptions);
}
