/**
 * 覆盖层绘制（C8 对标要点逐条落位）：选择框 + **8 手柄** + 悬停高亮 + 框选矩形
 * + 吸附参考线（**红**）+ 测量标注（**红**）+ 标尺 + 图层名/尺寸标签。
 *
 * 坐标口径：本模块在**屏幕（CSS 像素）空间**绘制——世界坐标一律经视口换算后再画，
 * 这样线宽/手柄/字号不随缩放变形（Figma 口径：手柄与参考线是 UI 而非内容）。
 *
 * 与命中测试的一致性：手柄位置来自 `SelectionFrame`（`input/handle-hit.ts` 用同一份数据做命中），
 * 因此「看到的 8 个手柄」与「能拖到的 8 个手柄」不会漂移。
 */

import type { HandleId, Measurement, NodeId, SnapGuide, Viewport } from '@dforge/engine';
import { normalizeRect, worldQuad } from '@dforge/engine';
import type { CanvasKit } from 'canvaskit-wasm';

import { parseColor } from './color';
import { cachedColor, type DrawContext, type DrawTools, worldToScreenPoint } from './draw-scene';
import type { SceneFrame, SelectionFrame } from './frame';
import type { ParagraphCache } from './paragraph-cache';
import {
  HANDLE_SIZE_PX,
  handleScreenPoints,
  OUTLINE_WIDTH_PX,
  RULER_SIZE,
  rulerLabel,
  rulerStepWorld,
  visibleGridValues,
  worldRectToScreen,
} from './scale';

/** 覆盖层绘制计数（门禁断言「画了什么」）。 */
export interface OverlayCounters {
  selectionOutlines: number;
  handles: number;
  snapGuides: number;
  measurements: number;
  marquee: boolean;
  /** 是否绘制了拖画草稿（创建工具）。 */
  draft: boolean;
  rulers: boolean;
  labels: number;
}

/** 标签内边距（屏幕 px，几何常量）。 */
const LABEL_PADDING_X = 4;
const LABEL_PADDING_Y = 2;
/** 标尺刻度长度（屏幕 px）。 */
const RULER_TICK_MINOR = 4;
const RULER_TICK_MAJOR = 8;
/** 测量线端部刻痕长度（屏幕 px）。 */
const MEASURE_TICK = 4;
/** 悬停描边 alpha（比选中轻）。 */
const HOVER_ALPHA = 0.6;
/** 框选填充 alpha。 */
const MARQUEE_ALPHA = 0.08;

/** 四点的多边形描边（选择框/节点 OBB）。 */
function strokePolygon(
  context: DrawContext,
  tools: DrawTools,
  points: readonly { x: number; y: number }[],
  color: ReturnType<CanvasKit['Color4f']>,
  width = OUTLINE_WIDTH_PX,
): void {
  if (points.length < 2) return;
  // 0.42 起 Path 为不可变快照：路径构建走 PathBuilder，detach 出 Path
  const builder = new context.canvasKit.PathBuilder();
  const first = points[0] as { x: number; y: number };
  builder.moveTo(first.x, first.y);
  for (const point of points.slice(1)) builder.lineTo(point.x, point.y);
  builder.close();
  const path = builder.detach();
  tools.line.setColor(color);
  tools.line.setStrokeWidth(width);
  context.canvas.drawPath(path, tools.line);
  path.delete();
  builder.delete();
}

/** 节点的屏幕四边形（含旋转；实例虚节点同样适用）。 */
function quadScreen(frame: SceneFrame, id: NodeId): Array<{ x: number; y: number }> {
  const quad = worldQuad(frame.page, id);
  if (quad === null) return [];
  return quad.map((point) => worldToScreenPoint(frame.viewport, point));
}

/** 画一段带底色的小字（标签/标注）：返回占位尺寸。 */
export function drawChip(
  context: DrawContext,
  text: string,
  x: number,
  y: number,
  background: string,
  foreground: string,
  fontSize: number,
): { width: number; height: number } {
  const paragraphs: ParagraphCache | null = context.paragraphs;
  if (paragraphs === null || context.fonts === null) return { width: 0, height: 0 };
  const paragraph = paragraphs.get({
    text,
    fontFamily: context.fonts.family,
    fontSize,
    fontWeight: 400,
    lineHeight: 1, // guard-tokens:allow 单行标签的排版参数（几何/排版口径，非设计令牌）
    letterSpacing: 0,
    align: 'left',
    color: parseColor(foreground),
    layoutWidth: 0,
    maxLines: 1,
  });
  const boxWidth = paragraph.getLongestLine() + LABEL_PADDING_X * 2;
  const boxHeight = paragraph.getHeight() + LABEL_PADDING_Y * 2;
  const paint = new context.canvasKit.Paint();
  paint.setAntiAlias(true);
  paint.setColor(cachedColor(context, background));
  context.canvas.drawRRect(
    context.canvasKit.RRectXY(
      context.canvasKit.LTRBRect(x, y, x + boxWidth, y + boxHeight),
      boxHeight / 2,
      boxHeight / 2,
    ),
    paint,
  );
  paint.delete();
  context.canvas.drawParagraph(paragraph, x + LABEL_PADDING_X, y + LABEL_PADDING_Y);
  return { width: boxWidth, height: boxHeight };
}

/** 标尺（顶部 + 左侧）+ 选中区间标记。 */
function drawRulers(
  context: DrawContext,
  frame: SceneFrame,
  tools: DrawTools,
  selectionFrame: SelectionFrame | null,
): void {
  const { width, height } = frame.scale.size;
  const kit = context.canvasKit;
  const step = rulerStepWorld(frame.viewport.zoom);

  tools.fill.setColor(cachedColor(context, context.palette.rulerBackground));
  context.canvas.drawRect(kit.LTRBRect(0, 0, width, RULER_SIZE), tools.fill);
  context.canvas.drawRect(kit.LTRBRect(0, 0, RULER_SIZE, height), tools.fill);

  tools.line.setColor(cachedColor(context, context.palette.rulerTick));
  tools.line.setStrokeWidth(1);

  const screenX = (world: number): number =>
    worldToScreenPoint(frame.viewport, { x: world, y: 0 }).x;
  const screenY = (world: number): number =>
    worldToScreenPoint(frame.viewport, { x: 0, y: world }).y;

  const xs = visibleGridValues(
    (0 - frame.viewport.panX) / frame.viewport.zoom,
    (width - frame.viewport.panX) / frame.viewport.zoom,
    step,
  );
  const ys = visibleGridValues(
    (0 - frame.viewport.panY) / frame.viewport.zoom,
    (height - frame.viewport.panY) / frame.viewport.zoom,
    step,
  );

  for (const world of xs) {
    const screen = screenX(world);
    if (screen < RULER_SIZE || screen > width) continue;
    context.canvas.drawLine(screen, RULER_SIZE, screen, RULER_SIZE - RULER_TICK_MAJOR, tools.line);
    drawChipText(context, frame, rulerLabel(world), screen + LABEL_PADDING_X, LABEL_PADDING_Y);
  }
  for (const world of ys) {
    const screen = screenY(world);
    if (screen < RULER_SIZE || screen > height) continue;
    context.canvas.drawLine(RULER_SIZE, screen, RULER_SIZE - RULER_TICK_MAJOR, screen, tools.line);
    drawChipText(context, frame, rulerLabel(world), LABEL_PADDING_X, screen + LABEL_PADDING_Y);
  }

  // 细分刻度：只在屏幕间距够大时画（否则糊成一片）
  const minor = step / 5;
  if (minor * frame.viewport.zoom >= 6) {
    for (const world of visibleGridValues(xs[0] ?? 0, xs[xs.length - 1] ?? 0, minor)) {
      const screen = screenX(world);
      if (screen < RULER_SIZE || screen > width) continue;
      context.canvas.drawLine(
        screen,
        RULER_SIZE,
        screen,
        RULER_SIZE - RULER_TICK_MINOR,
        tools.line,
      );
    }
    for (const world of visibleGridValues(ys[0] ?? 0, ys[ys.length - 1] ?? 0, minor)) {
      const screen = screenY(world);
      if (screen < RULER_SIZE || screen > height) continue;
      context.canvas.drawLine(
        RULER_SIZE,
        screen,
        RULER_SIZE - RULER_TICK_MINOR,
        screen,
        tools.line,
      );
    }
  }

  if (selectionFrame !== null) {
    tools.line.setColor(cachedColor(context, context.palette.rulerMarker));
    tools.line.setStrokeWidth(2);
    context.canvas.drawLine(
      screenX(selectionFrame.bounds.x),
      0,
      screenX(selectionFrame.bounds.x + selectionFrame.bounds.width),
      0,
      tools.line,
    );
    context.canvas.drawLine(
      0,
      screenY(selectionFrame.bounds.y),
      0,
      screenY(selectionFrame.bounds.y + selectionFrame.bounds.height),
      tools.line,
    );
  }
}

/** 标尺数字（小字、次级色；不画底）。 */
function drawChipText(
  context: DrawContext,
  frame: SceneFrame,
  text: string,
  x: number,
  y: number,
): void {
  if (context.paragraphs === null || context.fonts === null) return;
  const paragraph = context.paragraphs.get({
    text,
    fontFamily: context.fonts.family,
    fontSize: frame.palette.fontSize.ruler,
    fontWeight: 400,
    lineHeight: 1, // guard-tokens:allow 单行标签的排版参数（几何/排版口径，非设计令牌）
    letterSpacing: 0,
    align: 'left',
    color: parseColor(context.palette.rulerText),
    layoutWidth: 0,
    maxLines: 1,
  });
  context.canvas.drawParagraph(paragraph, x, y);
}

/** 吸附参考线（红）与测量标注（红）。 */
function drawSnap(
  context: DrawContext,
  frame: SceneFrame,
  tools: DrawTools,
  guides: readonly SnapGuide[],
  measurements: readonly Measurement[],
): { guides: number; measurements: number } {
  const viewport = frame.viewport;
  tools.line.setColor(cachedColor(context, context.palette.snapGuide));
  tools.line.setStrokeWidth(1);

  for (const guide of guides) {
    if (guide.axis === 'x') {
      const x = worldToScreenPoint(viewport, { x: guide.position, y: 0 }).x;
      const from = worldToScreenPoint(viewport, { x: 0, y: guide.from }).y;
      const to = worldToScreenPoint(viewport, { x: 0, y: guide.to }).y;
      context.canvas.drawLine(x, from, x, to, tools.line);
    } else {
      const y = worldToScreenPoint(viewport, { x: 0, y: guide.position }).y;
      const from = worldToScreenPoint(viewport, { x: guide.from, y: 0 }).x;
      const to = worldToScreenPoint(viewport, { x: guide.to, y: 0 }).x;
      context.canvas.drawLine(from, y, to, y, tools.line);
    }
  }

  for (const measurement of measurements) {
    const label = rulerLabel(round2(measurement.value));
    if (measurement.axis === 'x') {
      const y = worldToScreenPoint(viewport, { x: 0, y: measurement.at }).y;
      const from = worldToScreenPoint(viewport, { x: measurement.from, y: 0 }).x;
      const to = worldToScreenPoint(viewport, { x: measurement.to, y: 0 }).x;
      context.canvas.drawLine(from, y, to, y, tools.line);
      context.canvas.drawLine(from, y - MEASURE_TICK, from, y + MEASURE_TICK, tools.line);
      context.canvas.drawLine(to, y - MEASURE_TICK, to, y + MEASURE_TICK, tools.line);
      drawChip(
        context,
        label,
        (from + to) / 2 - WIDTH_GUESS / 2,
        y - frame.palette.fontSize.label - LABEL_PADDING_Y * 3,
        context.palette.measureLabelBackground,
        context.palette.measureLabelText,
        frame.palette.fontSize.label,
      );
    } else {
      const x = worldToScreenPoint(viewport, { x: measurement.at, y: 0 }).x;
      const from = worldToScreenPoint(viewport, { x: 0, y: measurement.from }).y;
      const to = worldToScreenPoint(viewport, { x: 0, y: measurement.to }).y;
      context.canvas.drawLine(x, from, x, to, tools.line);
      context.canvas.drawLine(x - MEASURE_TICK, from, x + MEASURE_TICK, from, tools.line);
      context.canvas.drawLine(x - MEASURE_TICK, to, x + MEASURE_TICK, to, tools.line);
      drawChip(
        context,
        label,
        x + LABEL_PADDING_X,
        (from + to) / 2 - LABEL_PADDING_Y,
        context.palette.measureLabelBackground,
        context.palette.measureLabelText,
        frame.palette.fontSize.label,
      );
    }
  }
  return { guides: guides.length, measurements: measurements.length };
}

/** 标注标签的居中对齐粗估（像素）；避免为了取宽度先建段落。 */
const WIDTH_GUESS = 24;

/** 选择框手柄的屏幕点（与命中测试同源）。 */
export function selectionHandleScreens(
  selectionFrame: SelectionFrame,
  viewport: Viewport,
): Record<HandleId, { x: number; y: number }> {
  return handleScreenPoints(selectionFrame.bounds, selectionFrame.rotation, viewport);
}

/** 覆盖层输入。 */
export interface OverlayOptions {
  selectionFrame: SelectionFrame | null;
  /** 选择标签文案（单选 = 图层名；多选 = 数量描述）。 */
  selectionLabels: readonly string[];
  /** 吸附数据（拖动中才有）。 */
  snap: { guides: readonly SnapGuide[]; measurements: readonly Measurement[] } | null;
}

/** 绘制覆盖层全量（在场景绘制之后、同一帧内调用）。 */
export function drawOverlay(
  context: DrawContext,
  frame: SceneFrame,
  tools: DrawTools,
  options: OverlayOptions,
): OverlayCounters {
  const counters: OverlayCounters = {
    selectionOutlines: 0,
    handles: 0,
    snapGuides: 0,
    measurements: 0,
    marquee: false,
    draft: false,
    rulers: false,
    labels: 0,
  };
  const kit = context.canvasKit;
  const viewport = frame.viewport;

  if (frame.rulers) {
    drawRulers(context, frame, tools, options.selectionFrame);
    counters.rulers = true;
  }

  if (frame.hoverId !== null && !frame.selection.includes(frame.hoverId)) {
    const quad = quadScreen(frame, frame.hoverId);
    if (quad.length === 4) {
      strokePolygon(
        context,
        tools,
        quad,
        cachedColor(context, context.palette.hoverOutline, HOVER_ALPHA),
      );
    }
  }

  for (const id of frame.selection) {
    const quad = quadScreen(frame, id);
    if (quad.length !== 4) continue;
    strokePolygon(context, tools, quad, cachedColor(context, context.palette.selectionOutline));
    counters.selectionOutlines += 1;
  }

  const selectionFrame = options.selectionFrame;
  if (selectionFrame !== null) {
    const points = selectionHandleScreens(selectionFrame, viewport);
    if (frame.selection.length > 1) {
      const box = worldRectToScreen(normalizeRect(selectionFrame.bounds), viewport);
      tools.line.setColor(cachedColor(context, context.palette.selectionOutline));
      tools.line.setStrokeWidth(OUTLINE_WIDTH_PX);
      context.canvas.drawRect(
        kit.LTRBRect(box.x, box.y, box.x + box.width, box.y + box.height),
        tools.line,
      );
    }
    tools.fill.setColor(cachedColor(context, context.palette.handleFill));
    tools.line.setColor(cachedColor(context, context.palette.handleBorder));
    tools.line.setStrokeWidth(1);
    const half = HANDLE_SIZE_PX / 2;
    for (const handle of Object.keys(points) as HandleId[]) {
      const point = points[handle];
      const rect = kit.LTRBRect(point.x - half, point.y - half, point.x + half, point.y + half);
      context.canvas.drawRect(rect, tools.fill);
      context.canvas.drawRect(rect, tools.line);
      counters.handles += 1;
    }
  }

  const interaction = frame.interaction;
  if (interaction.kind === 'resize') {
    const box = worldRectToScreen(normalizeRect(interaction.nextBounds), viewport);
    const widthWorld = round2(box.width / viewport.zoom);
    const heightWorld = round2(box.height / viewport.zoom);
    drawChip(
      context,
      `${rulerLabel(widthWorld)} × ${rulerLabel(heightWorld)}`,
      box.x + box.width / 2 - WIDTH_GUESS,
      box.y - frame.palette.fontSize.label - LABEL_PADDING_Y * 3,
      context.palette.labelBackground,
      context.palette.labelText,
      frame.palette.fontSize.label,
    );
    counters.labels += 1;
  }
  if (interaction.kind === 'rotate' && interaction.rotation !== 0) {
    const center = worldToScreenPoint(viewport, interaction.center);
    drawChip(
      context,
      `${rulerLabel(round2(interaction.rotation))}°`,
      center.x + 12,
      center.y - 12,
      context.palette.labelBackground,
      context.palette.labelText,
      frame.palette.fontSize.label,
    );
    counters.labels += 1;
  }

  if (options.selectionLabels.length > 0 && selectionFrame !== null) {
    const box = worldRectToScreen(normalizeRect(selectionFrame.bounds), viewport);
    let x = box.x;
    const y = box.y - frame.palette.fontSize.label - LABEL_PADDING_Y * 4;
    for (const text of options.selectionLabels) {
      const size = drawChip(
        context,
        text,
        x,
        y,
        context.palette.labelBackground,
        context.palette.labelText,
        frame.palette.fontSize.label,
      );
      x += size.width + 4;
      counters.labels += 1;
    }
  }

  // 拖画草稿（创建工具）：与框选同一视觉族，但用主色填充稍重，并带尺寸标签
  if (frame.draft !== null) {
    const box = worldRectToScreen(normalizeRect(frame.draft), viewport);
    const rect = kit.LTRBRect(box.x, box.y, box.x + box.width, box.y + box.height);
    tools.fill.setColor(cachedColor(context, context.palette.marqueeFill, MARQUEE_ALPHA));
    context.canvas.drawRect(rect, tools.fill);
    tools.line.setColor(cachedColor(context, context.palette.selectionOutline));
    tools.line.setStrokeWidth(OUTLINE_WIDTH_PX);
    context.canvas.drawRect(rect, tools.line);
    drawChip(
      context,
      `${rulerLabel(round2(Math.abs(frame.draft.width)))} × ${rulerLabel(round2(Math.abs(frame.draft.height)))}`,
      box.x + box.width / 2 - WIDTH_GUESS,
      box.y - frame.palette.fontSize.label - LABEL_PADDING_Y * 3,
      context.palette.labelBackground,
      context.palette.labelText,
      frame.palette.fontSize.label,
    );
    counters.draft = true;
    counters.labels += 1;
  }

  if (frame.marquee !== null) {
    const box = worldRectToScreen(normalizeRect(frame.marquee), viewport);
    const rect = kit.LTRBRect(box.x, box.y, box.x + box.width, box.y + box.height);
    tools.fill.setColor(cachedColor(context, context.palette.marqueeFill, MARQUEE_ALPHA));
    context.canvas.drawRect(rect, tools.fill);
    tools.line.setColor(cachedColor(context, context.palette.marqueeStroke));
    tools.line.setStrokeWidth(1);
    context.canvas.drawRect(rect, tools.line);
    counters.marquee = true;
  }

  if (options.snap !== null) {
    const result = drawSnap(context, frame, tools, options.snap.guides, options.snap.measurements);
    counters.snapGuides = result.guides;
    counters.measurements = result.measurements;
  }

  return counters;
}

/** 两位小数（标签显示用）。 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
