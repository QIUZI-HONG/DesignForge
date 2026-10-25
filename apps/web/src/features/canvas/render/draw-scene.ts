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
 * 渲染子集（显式声明，避免默默少画）：
 * - 效果（投影/内阴影/层模糊）已接入（工单 09）：口径换算、spread 分流、离屏合成的
 *   实现选择与性能含义集中在 `effects.ts` 头注释登记；观测计数走
 *   `SceneDrawCounters.effectsRendered`（经既有 `stats()` 通道供门禁读取）。
 *   仍登记的近似：投影/内阴影按**节点自身形状**轮廓（group 无自身形状 → 其投影/内阴影
 *   不画、仅层模糊生效；不做子树联合轮廓）；文本节点不画内阴影（无简单形状可 clip）；
 *   容器带可见层模糊时子树 saveLayer 合成后再模糊（唯一扩圈，见 effects.ts）。
 * - **观测计数口径（登记）**：`counters.nodes` = **实际绘制节点数**——`opacity = 0`（含
 *   预览补丁压到 0）的节点不进计数（零绘制不该算「画了」）；该口径变更已同步
 *   `docs/quality/perf-baseline-v1.json` 的 M7 recordOnly 注记（nodesDrawn 分母随之收窄）。
 * - 描边对齐（inside/outside）按中心线近似（口径保持，未扩）；
 * - 容器 opacity 不做离屏图层合成（逐 paint 乘 alpha；口径保持，不因效果扩圈）。
 */

import type { NodeId, NodePatch, SceneNode } from '@dforge/engine';
import { getChildrenIds, resolveNode } from '@dforge/engine';
import type { Canvas, CanvasKit, Color, FontMgr, Paint } from 'canvaskit-wasm';

import { parseColor, withAlpha } from './color';
import {
  blurMaskFilter,
  buildEffectPlan,
  inflatedCornerRadius,
  inflateRect,
  visibleEffects,
  type EffectPlan,
} from './effects';
import type { SceneFrame } from './frame';
import type { CanvasPalette } from './palette';
import type { ParagraphCache } from './paragraph-cache';
import { gridStepWorld, visibleGridValues } from './scale';
import { screenToWorldPoint, worldToScreenPoint } from './viewport-map';

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
  /** 效果滤镜笔（工单 09）：底垫笔（spread>0 投影）与 saveLayer 滤镜载体，Fill 风格。 */
  filter: Paint;
  /** 内阴影擦除笔：`BlendMode.DstOut` + 模糊 MaskFilter，Fill 风格。 */
  eraser: Paint;
}

/** 绘制计数（渲染统计：门禁据此断言「画了什么」）。 */
export interface SceneDrawCounters {
  /** 实际绘制节点数（`opacity = 0` 的节点不计——口径登记见文件头注释）。 */
  nodes: number;
  clipped: number;
  textRuns: number;
  /** 实际绘制的效果条数（投影/内阴影/层模糊逐条计；工单 09 经 stats() 供门禁读取）。 */
  effectsRendered: number;
}

/** 屏幕坐标 ⇄ 世界坐标：实现在 `viewport-map`（**渲染层与 DOM 覆盖层共用**）。 */
export { screenToWorldPoint, worldToScreenPoint };

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
  const counters: SceneDrawCounters = { nodes: 0, clipped: 0, textRuns: 0, effectsRendered: 0 };
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
  const canvasKit = context.canvasKit;
  const allEffects = visibleEffects(patch?.effects ?? node.effects);
  const isContainer =
    node.type === 'frame' ||
    node.type === 'group' ||
    node.type === 'component' ||
    node.type === 'component_set' ||
    node.type === 'instance';
  // 容器层模糊作用于整个子树（扩圈登记，见 effects.ts 头注释）：从自身效果中单拎出来
  const containerBlur =
    isContainer && opacity > 0
      ? allEffects.find((effect) => effect.type === 'layer_blur')
      : undefined;
  // group 无自身形状 → 投影/内阴影不画（登记）；文本无形状可 clip → 内阴影不画（登记）
  const shapeEffects =
    node.type === 'group'
      ? []
      : allEffects.filter(
          (effect) =>
            effect !== containerBlur && !(node.type === 'text' && effect.type === 'inner_shadow'),
        );
  // opacity = 0 时传空列表 → EMPTY_PLAN 零开销快路径（不查缓存、不建对象）
  const plan = buildEffectPlan(canvasKit, opacity > 0 ? shapeEffects : [], opacity);
  const blurPlan =
    containerBlur === undefined ? null : buildEffectPlan(canvasKit, [containerBlur], opacity);
  let subtreeBlurApplied = false;

  if (opacity > 0) {
    counters.effectsRendered += plan.rendered + (blurPlan === null ? 0 : blurPlan.rendered);

    // 容器层模糊：saveLayer 把「自身形状 + 子树」合成后再模糊（离屏，边界外扩 3σ）。
    // 已知近似（登记）：层边界按容器自身矩形外扩——无裁剪的容器（group 等）里，
    // 子节点溢出容器矩形的部分会被层边界裁掉；换全画布层保安全则帧耗失控，此处选前者。
    if (blurPlan !== null && blurPlan.content !== null) {
      tools.filter.setImageFilter(blurPlan.content);
      canvas.saveLayer(
        tools.filter,
        canvasKit.LTRBRect(
          -blurPlan.outset.x,
          -blurPlan.outset.y,
          geometry.width + blurPlan.outset.x,
          geometry.height + blurPlan.outset.y,
        ),
      );
      tools.filter.setImageFilter(null);
      subtreeBlurApplied = true;
    }

    drawNodeShape(context, frame, tools, node, geometry, patch, opacity, plan, counters);
    counters.nodes += 1;
  }
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

  // 内阴影在自身填充与子内容之上（Figma 口径：容器内阴影盖住子内容）；文本/编组不画（登记）
  if (opacity > 0 && node.type !== 'group' && node.type !== 'text') {
    drawInnerShadows(context, tools, plan, node, geometry, patch);
  }
  if (subtreeBlurApplied) {
    canvas.restore(); // 收容器层模糊层
  }

  canvas.restore();
}

/** 画节点自身形状（底垫投影 + 填充/描边（含内容滤镜）+ 文本）；`group` 自身不可见。 */
function drawNodeShape(
  context: DrawContext,
  frame: SceneFrame,
  tools: DrawTools,
  node: SceneNode,
  geometry: NodeGeometry,
  patch: NodePatch | undefined,
  opacity: number,
  plan: EffectPlan,
  counters: SceneDrawCounters,
): void {
  if (node.type === 'group') return;
  const canvasKit = context.canvasKit;
  const canvas = context.canvas;

  // 文本节点：`fills` 是**文字颜色**（Figma 口径），不是盒子填充——只画字形，不画矩形。
  if (node.type === 'text') {
    if (frame.editingNodeId === node.id) return;
    drawNodeTextWithEffects(context, frame, tools, node, geometry, opacity, patch, plan, counters);
    return;
  }

  const rect = canvasKit.LTRBRect(0, 0, geometry.width, geometry.height);
  const radius = Math.min(
    patch?.cornerRadius ?? node.cornerRadius,
    geometry.width / 2,
    geometry.height / 2,
  );
  const rrect = canvasKit.RRectXY(rect, radius, radius);
  const isEllipse = node.type === 'ellipse';

  // 中心线描边会越出节点矩形：离屏层边界还要留出描边半径，别把宽描边裁掉
  const strokes = patch?.strokes ?? node.strokes;
  let strokeHalf = 0;
  for (const stroke of strokes) {
    if (stroke.paint.visible && stroke.paint.opacity > 0 && stroke.width > 0) {
      strokeHalf = Math.max(strokeHalf, stroke.width / 2);
    }
  }
  /** saveLayer 边界：节点矩形外扩 outset（3σ + |offset| + spread）+ 描边半径。 */
  const paddedBounds = (): Float32Array =>
    canvasKit.LTRBRect(
      -plan.outset.x - strokeHalf,
      -plan.outset.y - strokeHalf,
      geometry.width + plan.outset.x + strokeHalf,
      geometry.height + plan.outset.y + strokeHalf,
    );

  // 底垫笔（spread>0 投影）：只留阴影、轮廓已按 spread 放大，画在内容之下
  if (plan.shadowOnly !== null) {
    tools.filter.setImageFilter(plan.shadowOnly);
    if (isEllipse) canvas.drawOval(rect, tools.filter);
    else canvas.drawRRect(rrect, tools.filter);
    tools.filter.setImageFilter(null);
  }

  // 内容笔（spread=0 投影 + 层模糊的合成滤镜）：填充与描边整层进同一离屏层，一次性滤镜
  if (plan.content !== null) {
    tools.filter.setImageFilter(plan.content);
    canvas.saveLayer(tools.filter, paddedBounds());
    tools.filter.setImageFilter(null);
  }

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
    if (isEllipse) context.canvas.drawOval(rect, tools.fill);
    else context.canvas.drawRRect(rrect, tools.fill);
    tools.fill.setShader(null);
  }

  for (const stroke of strokes) {
    if (!stroke.paint.visible || stroke.paint.opacity <= 0 || stroke.width <= 0) continue;
    const alpha = stroke.paint.opacity * opacity;
    const literal =
      stroke.paint.type === 'solid' ? stroke.paint.color : stroke.paint.stops[0]?.color;
    if (literal === undefined) continue;
    tools.stroke.setColor(cachedColor(context, literal, alpha));
    tools.stroke.setStrokeWidth(stroke.width);
    if (isEllipse) context.canvas.drawOval(rect, tools.stroke);
    else context.canvas.drawRRect(rrect, tools.stroke);
  }

  if (plan.content !== null) canvas.restore(); // 收内容滤镜层（滤镜在 restore 时套用）
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
  const literal = firstFill?.type === 'solid' ? firstFill.color : context.palette.textDefault;
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

/**
 * 带效果的字形绘制：drawParagraph 不接 paint，效果经「saveLayer + 滤镜」包裹——
 * 底垫（spread>0 投影）与内容（spread=0 投影 + 层模糊）各包一层，字形各画一遍
 * （段落本身有缓存，重复 draw 的成本只是栅格化）。
 * 层边界额外外扩一个盒高：段落可能纵向溢出文本盒，别让层边界把溢出字形裁掉。
 */
function drawNodeTextWithEffects(
  context: DrawContext,
  frame: SceneFrame,
  tools: DrawTools,
  node: SceneNode,
  geometry: NodeGeometry,
  opacity: number,
  patch: NodePatch | undefined,
  plan: EffectPlan,
  counters: SceneDrawCounters,
): void {
  if (plan.shadowOnly === null && plan.content === null) {
    drawNodeText(context, frame, node, geometry, opacity, patch, counters);
    return;
  }
  const canvasKit = context.canvasKit;
  const canvas = context.canvas;
  const bounds = canvasKit.LTRBRect(
    -plan.outset.x - geometry.width,
    -plan.outset.y - geometry.height,
    geometry.width + plan.outset.x + geometry.width,
    geometry.height + plan.outset.y + geometry.height,
  );
  const drawGlyphs = (): void =>
    drawNodeText(context, frame, node, geometry, opacity, patch, counters);

  if (plan.shadowOnly !== null) {
    tools.filter.setImageFilter(plan.shadowOnly);
    canvas.saveLayer(tools.filter, bounds);
    tools.filter.setImageFilter(null);
    drawGlyphs();
    canvas.restore();
  }
  if (plan.content !== null) {
    tools.filter.setImageFilter(plan.content);
    canvas.saveLayer(tools.filter, bounds);
    tools.filter.setImageFilter(null);
    drawGlyphs();
    canvas.restore();
  }
}

/**
 * 内阴影（工单 09，取舍登记见 effects.ts）：CanvasKit 无原生内阴影滤镜——
 * clip 节点形状 → saveLayer → drawColor 底色 → 用 `DstOut + 模糊 MaskFilter`
 * 擦除「偏移 + spread 外扩的模糊形状」，剩下的边缘色带即内阴影。
 * 离屏是**必需**的：DstOut 擦的是层内目标像素，不离屏会把节点自身填充与下层内容一起擦掉。
 * 在自身填充与子内容之上逐条绘制（数组序）。
 */
function drawInnerShadows(
  context: DrawContext,
  tools: DrawTools,
  plan: EffectPlan,
  node: SceneNode,
  geometry: NodeGeometry,
  patch: NodePatch | undefined,
): void {
  if (plan.innerShadows.length === 0) return;
  const canvasKit = context.canvasKit;
  const canvas = context.canvas;

  const rect = canvasKit.LTRBRect(0, 0, geometry.width, geometry.height);
  const radius = Math.min(
    patch?.cornerRadius ?? node.cornerRadius,
    geometry.width / 2,
    geometry.height / 2,
  );
  const isEllipse = node.type === 'ellipse';

  for (const shadow of plan.innerShadows) {
    canvas.save();
    if (isEllipse) {
      canvas.clipOval(rect, canvasKit.ClipOp.Intersect, true);
    } else {
      canvas.clipRRect(
        canvasKit.RRectXY(rect, radius, radius),
        canvasKit.ClipOp.Intersect,
        true,
      );
    }
    canvas.saveLayer(tools.filter, rect);
    canvas.drawColor(shadow.color, canvasKit.BlendMode.SrcOver);
    // 擦除轮廓：形状按 spread 外扩，再整体偏移 (dx, dy)（正偏移 → 对侧留色带，CSS 口径）
    const inflated = inflateRect(
      { x: 0, y: 0, width: geometry.width, height: geometry.height },
      shadow.spread,
    );
    const eraserRect = canvasKit.LTRBRect(
      inflated.x + shadow.dx,
      inflated.y + shadow.dy,
      inflated.x + shadow.dx + inflated.width,
      inflated.y + shadow.dy + inflated.height,
    );
    const eraserRadius = inflatedCornerRadius(
      radius,
      shadow.spread,
      inflated.width,
      inflated.height,
    );
    tools.eraser.setMaskFilter(blurMaskFilter(canvasKit, shadow.sigma));
    if (isEllipse) canvas.drawOval(eraserRect, tools.eraser);
    else canvas.drawRRect(canvasKit.RRectXY(eraserRect, eraserRadius, eraserRadius), tools.eraser);
    tools.eraser.setMaskFilter(null);
    canvas.restore();
    canvas.restore();
  }
}
