/**
 * 渲染器（C8）：把一帧 `SceneFrame` 画到 Skia surface 上。
 *
 * 分层（一帧内的绘制顺序，与 Figma 一致）：
 * 1. 清屏（画布底）→ 施加 `dpr → 视口平移 → 视口缩放`；
 * 2. 世界单位层：网格 + 节点树（`draw-scene`）；
 * 3. 屏幕单位层：标尺/选择框/8 手柄/参考线/测量（`draw-overlay`）——屏幕层**不随缩放变形**；
 * 4. `surface.flush()` 提交（wasm surface 必须显式 flush，否则读到的仍是上一帧）。
 *
 * DPR 感知：backing store = CSS 尺寸 × dpr（基准 1.5），`resize` 时重建 surface。
 * 对象复用：Paint 与段落缓存都在渲染器内持有——**不在帧内反复 new**（性能反模式）。
 */

import type { Size } from '@dforge/engine';
import type { CanvasKit, FontMgr, Surface } from 'canvaskit-wasm';
import { drawOverlay, type OverlayCounters, type OverlayOptions } from './draw-overlay';
import { cachedColor, type DrawTools, drawScene } from './draw-scene';
import type { SceneFrame } from './frame';
import type { CanvasPalette } from './palette';
import { ParagraphCache } from './paragraph-cache';
import type { RenderStats } from './scale';

/** 渲染统计（门禁/调试断言「画了什么」）。 */
export interface SceneRenderStats extends RenderStats {
  textRuns: number;
  clipped: number;
  rulers: boolean;
  labels: number;
  /** 是否绘制了拖画草稿（创建工具）。 */
  draft: boolean;
  devicePixelRatio: number;
  canvasCssSize: Size;
}

/** 渲染器选项。 */
export interface SceneRendererOptions {
  canvasKit: CanvasKit;
  /** 字体（未就绪 → null：文本不绘制，其余照画）。 */
  fonts: { family: string; fontMgr: FontMgr } | null;
  /**
   * 绘制目标工厂：按**设备像素**尺寸创建 surface。
   * 浏览器传 `MakeWebGLCanvasSurface` 包装；测试传 `MakeSurface`（CPU 光栅），
   * 因此渲染器的绘制逻辑可在 Node 里做像素级回归。
   */
  makeSurface: (widthDevice: number, heightDevice: number) => Surface | null;
}

/** 渲染器。 */
export interface SceneRenderer {
  /** 重设绘制目标（CSS 尺寸 + DPR；backing store = 尺寸 × DPR）。 */
  resize(size: Size, dpr: number): void;
  /** 画一帧并返回统计。 */
  render(frame: SceneFrame, overlay: OverlayOptions): SceneRenderStats;
  /** 当前统计（最近一帧）。 */
  currentStats(): SceneRenderStats;
  /** 释放 Skia 对象与 surface。 */
  dispose(): void;
  /** 段落缓存条目数（调试）。 */
  paragraphCount(): number;
}

/** 空统计（尚未出帧）。 */
function emptyStats(palette: CanvasPalette): SceneRenderStats {
  void palette;
  return {
    frame: 0,
    nodesDrawn: 0,
    selectionOutlines: 0,
    handles: 0,
    snapGuides: 0,
    measurements: 0,
    marquee: false,
    hoverId: null,
    selectedIds: [],
    textRuns: 0,
    clipped: 0,
    rulers: false,
    labels: 0,
    draft: false,
    devicePixelRatio: 1,
    canvasCssSize: { width: 0, height: 0 },
  };
}

/** 创建渲染器。 */
export function createSceneRenderer(options: SceneRendererOptions): SceneRenderer {
  const canvasKit: CanvasKit = options.canvasKit;
  const tools: DrawTools = {
    fill: new canvasKit.Paint(),
    stroke: new canvasKit.Paint(),
    line: new canvasKit.Paint(),
  };
  tools.fill.setAntiAlias(true);
  tools.fill.setStyle(canvasKit.PaintStyle.Fill);
  tools.stroke.setAntiAlias(true);
  tools.stroke.setStyle(canvasKit.PaintStyle.Stroke);
  tools.line.setAntiAlias(true);
  tools.line.setStyle(canvasKit.PaintStyle.Stroke);
  tools.line.setStrokeWidth(1);

  const paragraphs: ParagraphCache | null =
    options.fonts === null ? null : new ParagraphCache(canvasKit, options.fonts.fontMgr);

  let surface: Surface | null = null;
  let widthDevice = 0;
  let heightDevice = 0;
  let size: Size = { width: 0, height: 0 };
  let dpr = 1;
  let stats: SceneRenderStats = emptyStats({
    // 占位：首次 render 会立刻覆盖（统计不依赖配色）
  } as CanvasPalette);

  const ensureSurface = (): void => {
    const nextWidth = Math.max(1, Math.round(size.width * dpr));
    const nextHeight = Math.max(1, Math.round(size.height * dpr));
    if (surface !== null && nextWidth === widthDevice && nextHeight === heightDevice) return;
    surface?.delete();
    surface = options.makeSurface(nextWidth, nextHeight);
    widthDevice = nextWidth;
    heightDevice = nextHeight;
  };

  return {
    resize(nextSize, nextDpr): void {
      size = { width: Math.max(0, nextSize.width), height: Math.max(0, nextSize.height) };
      dpr = nextDpr > 0 ? nextDpr : 1;
      ensureSurface();
    },
    render(frame, overlay): SceneRenderStats {
      ensureSurface();
      if (surface === null) {
        throw new Error('渲染目标创建失败（surface 为 null）');
      }
      const canvas = surface.getCanvas();
      const context = {
        canvasKit,
        canvas,
        palette: frame.palette,
        fonts: options.fonts,
        paragraphs,
      };

      canvas.save();
      canvas.scale(dpr, dpr);
      canvas.clear(cachedColor(context, frame.palette.background));
      canvas.translate(frame.viewport.panX, frame.viewport.panY);
      canvas.scale(frame.viewport.zoom, frame.viewport.zoom);
      const scene = drawScene(context, frame, tools);
      canvas.restore();

      canvas.save();
      canvas.scale(dpr, dpr);
      const overlayCounters: OverlayCounters = drawOverlay(context, frame, tools, overlay);
      canvas.restore();

      surface.flush();

      stats = {
        frame: stats.frame + 1,
        nodesDrawn: scene.nodes,
        selectionOutlines: overlayCounters.selectionOutlines,
        handles: overlayCounters.handles,
        snapGuides: overlayCounters.snapGuides,
        measurements: overlayCounters.measurements,
        marquee: overlayCounters.marquee,
        draft: overlayCounters.draft,
        hoverId: frame.hoverId,
        selectedIds: [...frame.selection],
        textRuns: scene.textRuns,
        clipped: scene.clipped,
        rulers: overlayCounters.rulers,
        labels: overlayCounters.labels,
        devicePixelRatio: dpr,
        canvasCssSize: { ...size },
      };
      return stats;
    },
    currentStats(): SceneRenderStats {
      return stats;
    },
    paragraphCount(): number {
      return paragraphs?.size ?? 0;
    },
    dispose(): void {
      paragraphs?.dispose();
      surface?.delete();
      surface = null;
      tools.fill.delete();
      tools.stroke.delete();
      tools.line.delete();
    },
  };
}
