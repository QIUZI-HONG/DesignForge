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
}

/** 默认画布（页面无显式尺寸时的兜底，对齐基准视口）。 */
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const DEFAULT_BACKGROUND = '#FFFFFF';
/** 节点数上限（P0 简化实现的计算边界；超出部分跳过并计数）。 */
const MAX_NODES = 2000;

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
        const color = normalizeColor((entry as Record<string, unknown>).color);
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

function extractNode(value: unknown, budget: { skipped: number; used: number }): RenderNode | null {
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
  if (budget.used > MAX_NODES) return null;

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

  const budget = { skipped: 0, used: 0 };
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
