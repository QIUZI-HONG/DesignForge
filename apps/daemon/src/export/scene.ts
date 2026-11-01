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
  /** 被跳过的未知节点计数（诊断用，不失败）。 */
  skippedNodes: number;
  /** 因节点预算（`MAX_NODES`）被丢弃的节点计数（诊断用，不失败）。 */
  truncatedNodes: number;
  /** 产物是否覆盖页面全部可渲染节点：截断与跳过任一发生即 false。 */
  complete: boolean;
}

/**
 * 提取预算计数。
 *
 * `truncated` 只统计「走到预算闸门被拒」的节点：被拒容器其整棵子树不再遍历（这是
 * `MAX_NODES` 作为计算边界的目的本身），所以它是**下界**；对外保证由 `complete` 承担。
 */
interface ExtractBudget {
  skipped: number;
  used: number;
  truncated: number;
}

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
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
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
  if (record.$format === CANVAS_PAGE_FORMAT) {
    const page = record.page;
    if (typeof page === 'object' && page !== null && !Array.isArray(page)) {
      return extractEnvelopeScene(page as Record<string, unknown>);
    }
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

  const budget = { skipped: 0, used: 0, truncated: 0 };
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

  const budget = { skipped: 0, used: 0, truncated: 0 };
  const bounds = { width: 0, height: 0 };
  const nodes: RenderNode[] = [];
  // visited 全程不清空：同一节点至多渲染一次（环/多父引用按跳过计，不挂死）
  const visited = new Set<string>();
  for (const rootId of roots) {
    const parsed = extractEnvelopeNode(rootId, nodesRecord, budget, visited, bounds);
    if (parsed !== null) nodes.push(parsed);
  }

  return {
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
    background,
    nodes,
    skippedNodes: budget.skipped,
    truncatedNodes: budget.truncated,
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

  const x = asFiniteNumber(node.x);
  const y = asFiniteNumber(node.y);
  const width = asFiniteNumber(node.width);
  const height = asFiniteNumber(node.height);
  if (x === null || y === null || width === null || height === null) {
    budget.skipped += 1;
    return null;
  }
  // 隐藏节点不参与渲染（引擎 `NodeBase.visible`）
  if (node.visible === false) {
    budget.skipped += 1;
    return null;
  }
  const kind = envelopeKind(node);
  if (kind === null) {
    budget.skipped += 1;
    return null;
  }
  budget.used += 1;
  if (budget.used > MAX_NODES) {
    budget.truncated += 1;
    return null;
  }

  bounds.width = Math.max(bounds.width, x + width);
  bounds.height = Math.max(bounds.height, y + height);

  const children: RenderNode[] = [];
  const rawChildren = Array.isArray(node.children) ? node.children : [];
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
