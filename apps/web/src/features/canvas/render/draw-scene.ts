/**
 * 场景绘制（网格 + 节点树）。
 *
 * 坐标口径：**递归 + canvas 变换**。
 * - 帧起始施加 `dpr → 视口平移 → 视口缩放`，之后一切坐标都是**世界单位**；
 * - 节点递归沿用文档约定（子坐标相对父，`T(x,y) · R(θ 绕自身中心)`），
 *   因此子节点随父节点变换天然跟随，无需为每个节点单独合成世界矩阵；
 * - 预览（拖动/缩放/旋转）以**引擎 commit 语义算出的补丁**注入（见 state/preview.ts），
 *   保证「松手后的结果 = 拖动时看到的」，不在渲染层复刻第二套变换数学。
 *
 * P0 子集（显式声明，避免默默少画）：
 * - 效果（投影/内阴影/层模糊）不绘制（Inspector 分区落地后再接）；
 * - 描边对齐（inside/outside）按中心线近似；
 * - 容器 opacity 不做离屏图层合成（逐 paint 乘 alpha）。
 */

import type { NodeId, NodePatch, SceneNode } from '@dforge/engine';
import { getChildrenIds, resolveNode } from '@dforge/engine';
import type { Canvas, CanvasKit, Color, FontMgr, Paint } from 'canvaskit-wasm';

import { parseColor, withAlpha } from './color';
import type { SceneFrame } from './frame';
import type { CanvasPalette } from './palette';
import type { ParagraphCache } from './paragraph-cache';
import { gridStepWorld, visibleGridValues } from './scale';

/** 绘制上下文（每帧复用同一批 Skia 对象——不在帧内反复 new Paint）。 */
export interface DrawContext {
  canvasKit: CanvasKit;
  canvas: Canvas;
  palette: CanvasPalette;
  /** 字体（未就绪 → null：文本不绘制，其余照画，并把缺口显现给上层）。 */
  fonts: { family: string; fontMgr: FontMgr } | null;
  paragraphs: ParagraphCache | null;
}

/** 复用的 Skia 绘制对象（渲染器持有、统一释放）。 */
export interface DrawTools {
  fill: Paint;
  stroke: Paint;
  line: Paint;
}

/** 绘制计数（渲染统计：门禁据此断言「画了什么」）。 */
export interface SceneDrawCounters {
  nodes: number;
  clipped: number;
  textRuns: number;
}

/** 屏幕坐标 → 世界坐标（指针与裁剪换算用）。 */
export function screenToWorldPoint(
  viewport: SceneFrame['viewport'],
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: (point.x - viewport.panX) / viewport.zoom,
    y: (point.y - viewport.panY) / viewport.zoom,
  };
}

/** 世界坐标 → 屏幕坐标（覆盖层用）。 */
export function worldToScreenPoint(
  viewport: SceneFrame['viewport'],
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: point.x * viewport.zoom + viewport.panX,
    y: point.y * viewport.zoom + viewport.panY,
  };
}

/** 节点在本帧的有效几何（预览补丁优先）。 */
export interface NodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** 合并预览补丁到节点几何。 */
export function geometryOf(node: SceneNode, patch: NodePatch | undefined): NodeGeometry {
  return {
    x: patch?.x ?? node.x,
    y: patch?.y ?? node.y,
    width: patch?.width ?? node.width,
    height: patch?.height ?? node.height,
    rotation: patch?.rotation ?? node.rotation,
  };
}

/** 颜色字面量 → Skia 颜色（按 CanvasKit 实例缓存解析结果，避免每帧重解析令牌串）。 */
const colorCache = new WeakMap<CanvasKit, Map<string, Color>>();

/** 取（并缓存）不透明颜色。 */
export function cachedColor(context: DrawContext, literal: string, alpha = 1): Color {
  let perKit = colorCache.get(context.canvasKit);
  if (perKit === undefined) {
    perKit = new Map();
    colorCache.set(context.canvasKit, perKit);
  }
  const key = alpha === 1 ? literal : `${literal}@${alpha}`;
  const hit = perKit.get(key);
  if (hit !== undefined) return hit;
  const rgba = alpha === 1 ? parseColor(literal) : withAlpha(parseColor(literal), alpha);
  const color = context.canvasKit.Color4f(rgba.r, rgba.g, rgba.b, rgba.a);
  perKit.set(key, color);
  return color;
}

/** 绘制网格（C8：网格/点阵；显示步长随缩放自适应，避免上百万条线）。 */
function drawGrid(context: DrawContext, frame: SceneFrame, tools: DrawTools): void {
  const grid = frame.page.grid;
  if (!grid.visible || grid.size <= 0) return;
  const step = gridStepWorld(grid.size, frame.viewport.zoom);
  if (step <= 0) return;

  const viewport = frame.viewport;
  const from = screenToWorldPoint(viewport, { x: 0, y: 0 });
  const to = screenToWorldPoint(viewport, {
    x: frame.scale.size.width,
    y: frame.scale.size.height,
  });
  const xs = visibleGridValues(from.x, to.x, step);
  const ys = visibleGridValues(from.y, to.y, step);

  if (grid.style === 'dots') {
    tools.fill.setColor(cachedColor(context, context.palette.gridDot));
    const radius = context.palette.gridDotSize / 2 / viewport.zoom;
    for (const y of ys) {
      for (const x of xs) context.canvas.drawCircle(x, y, radius, tools.fill);
    }
    return;
  }

  tools.line.setColor(cachedColor(context, context.palette.gridLine));
  for (const x of xs) context.canvas.drawLine(x, from.y, x, to.y, tools.line);
  for (const y of ys) context.canvas.drawLine(from.x, y, to.x, y, tools.line);
}

/** 绘制页面内容（网格 + 节点树）。 */
export function drawScene(
  context: DrawContext,
  frame: SceneFrame,
  tools: DrawTools,
): SceneDrawCounters {
  drawGrid(context, frame, tools);
  const counters: SceneDrawCounters = { nodes: 0, clipped: 0, textRuns: 0 };
  for (const rootId of frame.page.rootIds) {
    drawNode(context, frame, tools, rootId, counters);
  }
  return counters;
}

/** 递归绘制节点及其子树。 */
function drawNode(
  context: DrawContext,
  frame: SceneFrame,
  tools: DrawTools,
  id: NodeId,
  counters: SceneDrawCounters,
): void {
  const node = resolveNode(frame.page, id);
  if (node === undefined || !node.visible) return;
  const patch = frame.preview.get(id);
  const geometry = geometryOf(node, patch);
  if (geometry.width <= 0 || geometry.height <= 0) return;

  const canvas = context.canvas;
  canvas.save();
  canvas.translate(geometry.x, geometry.y);
  if (geometry.rotation !== 0) {
    canvas.rotate(geometry.rotation, geometry.width / 2, geometry.height / 2);
  }

  const opacity = patch?.opacity ?? node.opacity;
  if (opacity > 0) {
    drawNodeShape(context, frame, tools, node, geometry, patch, opacity, counters);
  }
  counters.nodes += 1;

  const children = getChildrenIds(frame.page, id);
  if (children.length > 0) {
    if (node.type === 'frame' && (patch?.clipsContent ?? node.clipsContent)) {
      const rect = context.canvasKit.LTRBRect(0, 0, geometry.width, geometry.height);
      const radius = Math.min(
        patch?.cornerRadius ?? node.cornerRadius,
        geometry.width / 2,
        geometry.height / 2,
      );
      context.canvas.clipRRect(
        context.canvasKit.RRectXY(rect, radius, radius),
        context.canvasKit.ClipOp.Intersect,
        true,
      );
      counters.clipped += 1;
    }
    for (const childId of children) {
      drawNode(context, frame, tools, childId, counters);
    }
  }

  canvas.restore();
}

/** 画节点自身形状（填充 + 描边 + 文本）；`group` 自身不可见。 */
function drawNodeShape(
  context: DrawContext,
  frame: SceneFrame,
  tools: DrawTools,
  node: SceneNode,
  geometry: NodeGeometry,
  patch: NodePatch | undefined,
  opacity: number,
  counters: SceneDrawCounters,
): void {
  if (node.type === 'group') return;
  const canvasKit = context.canvasKit;

  // 文本节点：`fills` 是**文字颜色**（Figma 口径），不是盒子填充——只画字形，不画矩形。
  if (node.type === 'text') {
    if (frame.editingNodeId === node.id) return;
    drawNodeText(context, frame, node, geometry, opacity, patch, counters);
    return;
  }

  const rect = canvasKit.LTRBRect(0, 0, geometry.width, geometry.height);
  const radius = Math.min(
    patch?.cornerRadius ?? node.cornerRadius,
    geometry.width / 2,
    geometry.height / 2,
  );
  const rrect = canvasKit.RRectXY(rect, radius, radius);

  const fills = patch?.fills ?? node.fills;
  for (const fill of fills) {
    if (!fill.visible || fill.opacity <= 0) continue;
    const alpha = fill.opacity * opacity;
    if (fill.type === 'solid') {
      tools.fill.setColor(cachedColor(context, fill.color, alpha));
    } else {
      const stops = fill.stops;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (first === undefined || last === undefined || stops.length < 2) continue;
      const shader = canvasKit.Shader.MakeLinearGradient(
        [fill.start.x * geometry.width, fill.start.y * geometry.height],
        [fill.end.x * geometry.width, fill.end.y * geometry.height],
        stops.map((stop) => cachedColor(context, stop.color, alpha)),
        stops.map((stop) => stop.position),
        canvasKit.TileMode.Clamp,
      );
      tools.fill.setShader(shader);
    }
    if (node.type === 'ellipse') context.canvas.drawOval(rect, tools.fill);
    else context.canvas.drawRRect(rrect, tools.fill);
    tools.fill.setShader(null);
  }

  const strokes = patch?.strokes ?? node.strokes;
  for (const stroke of strokes) {
    if (!stroke.paint.visible || stroke.paint.opacity <= 0 || stroke.width <= 0) continue;
    const alpha = stroke.paint.opacity * opacity;
    const literal =
      stroke.paint.type === 'solid' ? stroke.paint.color : stroke.paint.stops[0]?.color;
    if (literal === undefined) continue;
    tools.stroke.setColor(cachedColor(context, literal, alpha));
    tools.stroke.setStrokeWidth(stroke.width);
    if (node.type === 'ellipse') context.canvas.drawOval(rect, tools.stroke);
    else context.canvas.drawRRect(rrect, tools.stroke);
  }
}

/** 文本字形（Paragraph + 字体回退；字体未就绪则不画字形并把缺口传给上层）。 */
function drawNodeText(
  context: DrawContext,
  frame: SceneFrame,
  node: SceneNode,
  geometry: NodeGeometry,
  opacity: number,
  patch: NodePatch | undefined,
  counters: SceneDrawCounters,
): void {
  if (node.type !== 'text' || context.paragraphs === null || context.fonts === null) return;
  const content = patch?.text ?? node.text;
  if (content.characters.length === 0) return;
  const firstFill = node.fills[0];
  const literal = firstFill?.type === 'solid' ? firstFill.color : '#000000';
  const paragraph = context.paragraphs.get({
    text: content.characters,
    fontFamily: content.fontFamily,
    fontSize: content.fontSize,
    fontWeight: content.fontWeight,
    lineHeight: content.lineHeight,
    letterSpacing: content.letterSpacing,
    align: content.align,
    color: withAlpha(parseColor(literal), opacity),
    layoutWidth: geometry.width,
  });
  context.canvas.drawParagraph(paragraph, 0, 0);
  counters.textRuns += 1;
  void frame;
}
