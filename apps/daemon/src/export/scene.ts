/**
 * @dforge/daemon · 导出用「最小场景」提取（对 opaque 页面 JSON 的容错子集解析）。
 *
 * 边界声明（简报 §2）：文档正文归 `@dforge/engine`，daemon **不解析节点语义**；
 * 本模块只做**导出所需的最小结构映射**——在页面 JSON 里识别
 * `{ width, height, background, children[] }`（或 `nodes[]`）与矩形/椭圆/文本/图片的基本几何，
 * 未知节点类型跳过。这是「SVG/PDF 可先用引擎序列化简化实现」的过渡实现，
 * 引擎序列化接入后只替换本文件，不动契约（ExportRequest/ExportArtifact 形状不变）。
 */

/** 可渲染节点（最小子集）。 */
export interface RenderNode {
  kind: 'frame' | 'rect' | 'ellipse' | 'text' | 'image' | 'other';
  x: number;
  y: number;
  width: number;
  height: number;
  /** `#RGB` / `#RRGGBB` / `#RRGGBBAA` 归一化后的颜色；无填充为 null。 */
  fill: string | null;
  cornerRadius: number;
  opacity: number;
  text: string | null;
  fontSize: number;
  children: RenderNode[];
}

/** 最小渲染场景。 */
export interface RenderScene {
  width: number;
  height: number;
  background: string;
  nodes: RenderNode[];
  /** 结构非法/无渲染语义被跳过的节点计数（**真损失**，计入 complete 判定）。 */
  skippedNodes: number;
  /** 因节点预算（`MAX_NODES`）被丢弃的**整棵子树**计数（**真损失**，计入 complete 判定）。 */
  truncatedNodes: number;
  /** 隐藏层计数（应用侧从不渲染，`visible===false` 连子树）——**非损失**，不参与 complete 判定。 */
  hiddenNodes: number;
  /**
   * 产物是否覆盖页面全部可渲染节点：仅当 `skippedNodes` 与 `truncatedNodes` 皆为零、
   * 且提取「对账通过」时才 true。隐藏层不计（它本就渲染不到）。
   */
  complete: boolean;
}

/**
 * 提取预算计数（对账三分类，互斥且覆盖节点表全部可达节点）。
 *
 * `hidden` 非损失、不进 `complete`；`skipped` = 结构非法/无渲染语义（真损失）；
 * `truncated` = 走到预算闸门被拒的节点连同其整棵子树（真损失，整子树计数，非「容器记 1」）。
 * 被拒/隐藏/非法容器都会**下钻其子树逐个计数**，使三分类精确到每一枚被丢弃/隐藏的节点。
 */
interface ExtractBudget {
  skipped: number;
  used: number;
  truncated: number;
  hidden: number;
}

/** 子树计数的损失类别：`hidden`（非损失）/ `skipped` / `truncated`。 */
type LossMode = 'hidden' | 'skipped' | 'truncated';

/** 默认画布（页面无显式尺寸时的兜底，对齐基准视口）。 */
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const DEFAULT_BACKGROUND = '#FFFFFF';
/** 节点数上限（P0 简化实现的计算边界；超出部分跳过并计数）。 */
const MAX_NODES = 2000;

/**
 * web 落盘信封标识（`apps/web/.../documents-client.ts` 的 `CANVAS_PAGE_FORMAT`）。
 * daemon 不依赖引擎、不解析节点语义；只按信封形状做导出所需的最小结构映射。
 */
const CANVAS_PAGE_FORMAT = 'dforge.canvas.page';

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 颜色归一化：接受 #RGB/#RRGGBB/#RRGGBBAA；其余形态返回 null（不做命名色/函数色）。 */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [r, g, b] = [trimmed[1], trimmed[2], trimmed[3]] as [string, string, string];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed) || /^#[0-9a-fA-F]{8}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return null;
}

/** 从多种可能的填充写法里取颜色（`fill` 字符串、`fill.color`、`fills[0].color`）。 */
function extractFill(node: Record<string, unknown>): string | null {
  const direct = normalizeColor(node.fill);
  if (direct !== null) return direct;
  const fillObject = node.fill;
  if (typeof fillObject === 'object' && fillObject !== null) {
    const color = normalizeColor((fillObject as Record<string, unknown>).color);
    if (color !== null) return color;
  }
  const fills = node.fills;
  if (Array.isArray(fills)) {
    for (const entry of fills) {
      if (typeof entry === 'object' && entry !== null) {
        const paint = entry as Record<string, unknown>;
        // 引擎 `SolidPaint.visible`：隐藏画刷不取色，继续找下一个可见填充
        if (paint.visible === false) continue;
        const color = normalizeColor(paint.color);
        if (color !== null) return color;
      }
    }
  }
  return null;
}

function extractKind(node: Record<string, unknown>): RenderNode['kind'] {
  const rawKind =
    typeof node.kind === 'string' ? node.kind : typeof node.type === 'string' ? node.type : '';
  switch (rawKind.toLowerCase()) {
    case 'frame':
    case 'artboard':
      return 'frame';
    case 'rect':
    case 'rectangle':
      return 'rect';
    case 'ellipse':
    case 'circle':
      return 'ellipse';
    case 'text':
      return 'text';
    case 'image':
      return 'image';
    default:
      return 'other';
  }
}

function extractNode(value: unknown, budget: ExtractBudget): RenderNode | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    // 结构非法的子引用（字符串/数组/null 等）：是一次真损失，计入跳过，不静默丢弃
    budget.skipped += 1;
    return null;
  }
  const record = value as Record<string, unknown>;
  const x = asFiniteNumber(record.x);
  const y = asFiniteNumber(record.y);
  const width = asFiniteNumber(record.width);
  const height = asFiniteNumber(record.height);
  if (x === null || y === null || width === null || height === null) {
    budget.skipped += 1;
    return null;
  }
  const kind = extractKind(record);
  if (kind === 'other') {
    budget.skipped += 1;
    return null;
  }
  budget.used += 1;
  if (budget.used > MAX_NODES) {
    budget.truncated += 1;
    return null;
  }

  const rawText =
    typeof record.text === 'string'
      ? record.text
      : typeof record.characters === 'string'
        ? record.characters
        : null;
  const rawFontSize = asFiniteNumber(record.fontSize);
  const rawCornerRadius = asFiniteNumber(record.cornerRadius) ?? asFiniteNumber(record.radius) ?? 0;
  const rawOpacity = asFiniteNumber(record.opacity) ?? 1;

  const children: RenderNode[] = [];
  const rawChildren = Array.isArray(record.children)
    ? record.children
    : Array.isArray(record.nodes)
      ? record.nodes
      : [];
  for (const child of rawChildren) {
    const parsed = extractNode(child, budget);
    if (parsed !== null) children.push(parsed);
  }

  return {
    kind,
    x,
    y,
    width,
    height,
    fill: extractFill(record),
    cornerRadius: Math.max(0, rawCornerRadius),
    opacity: Math.min(Math.max(0, rawOpacity), 1),
    text: rawText,
    fontSize: rawFontSize ?? 16,
    children,
  };
}

/** 从 opaque 页面正文提取最小场景（宽容：坏节点跳过并计数，不抛错）。 */
export function extractScene(pageBody: unknown): RenderScene {
  const record =
    typeof pageBody === 'object' && pageBody !== null && !Array.isArray(pageBody)
      ? (pageBody as Record<string, unknown>)
      : {};

  // 信封分支：web 真实正文 `{ $format: 'dforge.canvas.page', page: ScenePage, tokens }`
  // —— 一旦声明信封格式，就**独占处理**，绝不回落存量顶层分支（否则坏 page 会被当成
  // 「空场景 = 完整」认证，覆盖掉上一份好产物）。
  if (record.$format === CANVAS_PAGE_FORMAT) {
    const page = record.page;
    if (typeof page === 'object' && page !== null && !Array.isArray(page)) {
      return extractEnvelopeScene(page as Record<string, unknown>);
    }
    // page 缺失/为 null/数组/字符串等不可解析形态：无法核对节点表，判为不完整（未判定不当绿）。
    return {
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      background: DEFAULT_BACKGROUND,
      nodes: [],
      skippedNodes: 1,
      truncatedNodes: 0,
      hiddenNodes: 0,
      complete: false,
    };
  }

  // 存量分支：顶层形状旧页面（`{ width, height, background, children[]/nodes[] }`）
  const width = asFiniteNumber(record.width) ?? DEFAULT_WIDTH;
  const height = asFiniteNumber(record.height) ?? DEFAULT_HEIGHT;
  const background = normalizeColor(record.background) ?? DEFAULT_BACKGROUND;

  const roots: unknown[] = Array.isArray(record.children)
    ? record.children
    : Array.isArray(record.nodes)
      ? record.nodes
      : Array.isArray(pageBody)
        ? pageBody
        : [];

  const budget = { skipped: 0, used: 0, truncated: 0, hidden: 0 };
  const nodes: RenderNode[] = [];
  for (const root of roots) {
    const parsed = extractNode(root, budget);
    if (parsed !== null) nodes.push(parsed);
  }

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    background,
    nodes,
    skippedNodes: budget.skipped,
    truncatedNodes: budget.truncated,
    hiddenNodes: budget.hidden,
    complete: budget.skipped === 0 && budget.truncated === 0,
  };
}

/**
 * 信封分支：扁平节点表（`nodes: Record<id, node>`）+ `rootIds` 顶层顺序。
 *
 * 页面本身无宽高字段：场景尺寸取**内容包围盒**（原点 0,0 起，max(x+width)/max(y+height)，
 * 空页面回退默认视口）；背景取 `page.backgroundColor`。
 */
function extractEnvelopeScene(page: Record<string, unknown>): RenderScene {
  const background = normalizeColor(page.backgroundColor) ?? DEFAULT_BACKGROUND;
  const nodesRecord =
    typeof page.nodes === 'object' && page.nodes !== null && !Array.isArray(page.nodes)
      ? (page.nodes as Record<string, unknown>)
      : {};
  // rootIds 缺失/非数组时兜底：未被任何容器 children 引用的节点视为顶层（旧数据容错）
  const roots: unknown[] = Array.isArray(page.rootIds)
    ? page.rootIds
    : deriveEnvelopeRootIds(nodesRecord);

  const budget = { skipped: 0, used: 0, truncated: 0, hidden: 0 };
  const bounds = { width: 0, height: 0 };
  const nodes: RenderNode[] = [];
  // visited 全程不清空：同一节点至多渲染一次（环/多父引用按跳过计，不挂死）
  const visited = new Set<string>();
  for (const rootId of roots) {
    const parsed = extractEnvelopeNode(rootId, nodesRecord, budget, visited, bounds);
    if (parsed !== null) nodes.push(parsed);
  }

  // 对账（票 18 红线）：节点表里存在、却没被任何根遍历到达的 id = 孤立节点。
  // 可渲染的孤立节点是**真损失**（明明在表里却没进产物），计入 skipped，否则
  // 「rootIds:[] 但表里有 30 个节点」会被当成「空页面 = 完整」认证；隐藏孤立 = 非损失。
  // 空表 → 无孤立 → 仍完整（合法空页，见 scene.test 空页用例）。
  for (const id of Object.keys(nodesRecord)) {
    if (visited.has(id)) continue;
    const value = nodesRecord[id];
    const isHidden =
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).visible === false;
    if (isHidden) budget.hidden += 1;
    else budget.skipped += 1;
  }

  return {
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
    background,
    nodes,
    skippedNodes: budget.skipped,
    truncatedNodes: budget.truncated,
    hiddenNodes: budget.hidden,
    complete: budget.skipped === 0 && budget.truncated === 0,
  };
}

/** 信封 rootIds 缺失时兜底：收集被 children 引用的 id，剩下的即顶层节点。 */
function deriveEnvelopeRootIds(nodesRecord: Record<string, unknown>): string[] {
  const referenced = new Set<string>();
  for (const value of Object.values(nodesRecord)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const children = (value as Record<string, unknown>).children;
    if (!Array.isArray(children)) continue;
    for (const childId of children) {
      if (typeof childId === 'string') referenced.add(childId);
    }
  }
  return Object.keys(nodesRecord).filter((id) => !referenced.has(id));
}

/** 引擎节点类型 → 最小渲染类型；无渲染语义且无法承载子树的返回 null（跳过）。 */
function envelopeKind(node: Record<string, unknown>): RenderNode['kind'] | null {
  const rawType = typeof node.type === 'string' ? node.type.toLowerCase() : '';
  switch (rawType) {
    case 'rect':
      return 'rect';
    case 'ellipse':
      return 'ellipse';
    case 'text':
      return 'text';
    case 'frame':
      return 'frame';
    // 编组/主组件/组件集本身不直接绘制，但承载真实子节点 → 透明画板
    case 'group':
    case 'component':
    case 'component_set':
      return 'frame';
    // 实例的子树是虚节点（按 componentId 解析），daemon 不解析组件语义 → 跳过
    default:
      return null;
  }
}

/**
 * 子树计数：断链容器（隐藏 / 几何非法 / 实例 / 预算越界）不再渲染，但其**子孙仍需对账**——
 * 否则它们会被「未到达 → 孤立」循环按各自 `visible` 误分类（例如隐藏父下的可见子会被记成损失）。
 * 逐节点下钻：父链一旦判为非损失（hidden），整条子树都按 hidden 计；否则按各节点自身 `visible`
 * 分成 hidden 或 `mode`（skipped / truncated）。与主遍历共享 `visited`，天然防环、防多父重复计数。
 */
function accountSubtree(
  nodeId: unknown,
  nodesRecord: Record<string, unknown>,
  budget: ExtractBudget,
  visited: Set<string>,
  mode: LossMode,
): void {
  if (typeof nodeId !== 'string' || nodeId.length === 0) {
    if (mode !== 'hidden') budget[mode] += 1;
    return;
  }
  if (visited.has(nodeId)) return;
  visited.add(nodeId);

  const value = nodesRecord[nodeId];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    if (mode !== 'hidden') budget[mode] += 1;
    return;
  }
  const node = value as Record<string, unknown>;
  // 隐藏父链（mode==='hidden'）或本节点自身隐藏 → 非损失；否则计入本层的损失类别。
  const nonLoss = mode === 'hidden' || node.visible === false;
  if (nonLoss) budget.hidden += 1;
  else budget[mode] += 1;

  const children = Array.isArray(node.children) ? node.children : [];
  const childMode: LossMode = nonLoss ? 'hidden' : mode;
  for (const childId of children) {
    accountSubtree(childId, nodesRecord, budget, visited, childMode);
  }
}

/** 按节点 id 从扁平表解析并映射（`children` 为 NodeId 引用，逐个递归解析）。 */
function extractEnvelopeNode(
  nodeId: unknown,
  nodesRecord: Record<string, unknown>,
  budget: ExtractBudget,
  visited: Set<string>,
  bounds: { width: number; height: number },
): RenderNode | null {
  if (typeof nodeId !== 'string' || nodeId.length === 0) {
    budget.skipped += 1;
    return null;
  }
  if (visited.has(nodeId)) {
    budget.skipped += 1;
    return null;
  }
  visited.add(nodeId);

  const value = nodesRecord[nodeId];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    budget.skipped += 1;
    return null;
  }
  const node = value as Record<string, unknown>;
  const rawChildren = Array.isArray(node.children) ? node.children : [];

  // 隐藏 = 非损失：应用侧 `drawNode` 见 `!visible` 即 return，整棵子树都不渲染 →
  // 逐个下钻计「隐藏」并标记 visited，绝不混进 skipped（否则正确的导出被误判部分）。
  if (node.visible === false) {
    budget.hidden += 1;
    for (const childId of rawChildren) {
      accountSubtree(childId, nodesRecord, budget, visited, 'hidden');
    }
    return null;
  }

  const x = asFiniteNumber(node.x);
  const y = asFiniteNumber(node.y);
  const width = asFiniteNumber(node.width);
  const height = asFiniteNumber(node.height);
  if (x === null || y === null || width === null || height === null) {
    // 几何非法 → 真损失；其子树在断链下同样出不来 → 逐个计 skipped。
    budget.skipped += 1;
    for (const childId of rawChildren) {
      accountSubtree(childId, nodesRecord, budget, visited, 'skipped');
    }
    return null;
  }
  const kind = envelopeKind(node);
  if (kind === null) {
    // 实例/未知类型（虚节点子树按 componentId 解析，daemon 不解析组件语义）→ 真损失。
    budget.skipped += 1;
    for (const childId of rawChildren) {
      accountSubtree(childId, nodesRecord, budget, visited, 'skipped');
    }
    return null;
  }
  budget.used += 1;
  if (budget.used > MAX_NODES) {
    // 预算闸门：本节点连同**整棵子树**被丢弃 → 逐节点计 truncated（精确到每一枚，不是「容器记 1」）。
    budget.truncated += 1;
    for (const childId of rawChildren) {
      accountSubtree(childId, nodesRecord, budget, visited, 'truncated');
    }
    return null;
  }

  bounds.width = Math.max(bounds.width, x + width);
  bounds.height = Math.max(bounds.height, y + height);

  const children: RenderNode[] = [];
  for (const childId of rawChildren) {
    const parsed = extractEnvelopeNode(childId, nodesRecord, budget, visited, bounds);
    if (parsed !== null) children.push(parsed);
  }

  const rawCornerRadius = asFiniteNumber(node.cornerRadius) ?? 0;
  const rawOpacity = asFiniteNumber(node.opacity) ?? 1;

  // 引擎 TextNode：characters/fontSize 嵌套在 `text: TextContent` 里
  const textContent =
    typeof node.text === 'object' && node.text !== null && !Array.isArray(node.text)
      ? (node.text as Record<string, unknown>)
      : null;
  const rawText =
    textContent !== null && typeof textContent.characters === 'string'
      ? textContent.characters
      : null;
  const rawFontSize = textContent === null ? null : asFiniteNumber(textContent.fontSize);

  return {
    kind,
    x,
    y,
    width,
    height,
    fill: extractFill(node),
    cornerRadius: Math.max(0, rawCornerRadius),
    opacity: Math.min(Math.max(0, rawOpacity), 1),
    text: rawText,
    fontSize: rawFontSize ?? 16,
    children,
  };
}

/** 展平场景（父先子后 = 绘制顺序）。 */
export function flattenScene(scene: RenderScene): RenderNode[] {
  const flat: RenderNode[] = [];
  const walk = (nodes: RenderNode[]): void => {
    for (const node of nodes) {
      flat.push(node);
      walk(node.children);
    }
  };
  walk(scene.nodes);
  return flat;
}
