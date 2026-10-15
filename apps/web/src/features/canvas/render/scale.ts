/**
 * 比例尺与几何工具（渲染层可测部分）。
 *
 * 为什么单独成模块：网格步长、标尺刻度、手柄屏幕坐标这些都是**纯计算**，
 * 不需要 Skia 就能测；把它们留在绘制函数里会让渲染逻辑无法回归。
 *
 * 阈值与厚度是**几何常量**（`_shared.md` §3：几何计算除外，不受令牌禁裸值约束），
 * 颜色/字号仍一律走令牌。
 */

import type { HandleId, Point, Rect, Viewport } from '@dforge/engine';
import { HANDLE_IDS, rotatedHandlePoints, worldToScreen } from '@dforge/engine';

/** 网格线屏幕间距下限（低于它就把网格步长翻倍，避免上万条线）。 */
export const MIN_GRID_PX = 12;

/** 标尺厚度（屏幕 px）。 */
export const RULER_SIZE = 20;

/** 标尺刻度目标间距（屏幕 px）——挑一个「好看」的刻度值。 */
export const RULER_TICK_TARGET_PX = 80;

/** 手柄边长（屏幕 px，C8 8 手柄）。 */
export const HANDLE_SIZE_PX = 8;

/** 手柄命中半径（屏幕 px）。 */
export const HANDLE_HIT_RADIUS_PX = 5;

/** 旋转区带宽（屏幕 px）：手柄**外侧**的一圈。 */
export const ROTATE_ZONE_PX = 14;

/** 缩放上下文的绘制线宽（屏幕 px）。 */
export const OUTLINE_WIDTH_PX = 1.5;

/**
 * 网格步长：世界步长不变，但屏幕上太密时按 2 的幂放大显示步长。
 * 返回的仍是**世界**步长（渲染时再用 zoom 乘回屏幕）。
 */
export function gridStepWorld(sizeWorld: number, zoom: number, minPx = MIN_GRID_PX): number {
  if (!Number.isFinite(sizeWorld) || sizeWorld <= 0) return 0;
  if (!Number.isFinite(zoom) || zoom <= 0) return sizeWorld;
  let step = sizeWorld;
  let guard = 0;
  while (step * zoom < minPx && guard < 32) {
    step *= 2;
    guard += 1;
  }
  return step;
}

/** 可见范围内的刻度值（含首尾；上限保护防止极端缩放下的天量迭代）。 */
export function visibleGridValues(from: number, to: number, step: number, cap = 4000): number[] {
  if (step <= 0 || !Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const start = Math.floor(from / step) * step;
  const values: number[] = [];
  for (let value = start; value <= to + step; value += step) {
    if (value < from - step) continue;
    values.push(value);
    if (values.length >= cap) break;
  }
  return values;
}

/** 标尺刻度步长（世界单位）：从 1/2/5/10 量级里挑「屏幕上不小于目标间距」的最小值。 */
export function rulerStepWorld(zoom: number, targetPx = RULER_TICK_TARGET_PX): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 100;
  const targetWorld = targetPx / zoom;
  const magnitude = 10 ** Math.floor(Math.log10(targetWorld));
  for (const factor of [1, 2, 5, 10]) {
    const candidate = magnitude * factor;
    if (candidate >= targetWorld) return candidate;
  }
  return magnitude * 10;
}

/** 标尺刻度文案（整数不带小数；小数保留一位）。 */
export function rulerLabel(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 1e-6) return String(rounded);
  return value.toFixed(1);
}

/** 世界包围盒的 8 手柄屏幕坐标（复用引擎的手柄语义，只做坐标换算）。 */
export function handleScreenPoints(
  boundsWorld: Rect,
  rotationDeg: number,
  viewport: Viewport,
): Record<HandleId, Point> {
  const points = rotatedHandlePoints(boundsWorld, rotationDeg);
  const out = {} as Record<HandleId, Point>;
  for (const handle of HANDLE_IDS) {
    const point = points[handle];
    out[handle] = worldToScreen(viewport, point);
  }
  return out;
}

/** 手柄方块的屏幕矩形（以手柄点为心）。 */
export function handleScreenRect(point: Point, sizePx = HANDLE_SIZE_PX): Rect {
  return {
    x: point.x - sizePx / 2,
    y: point.y - sizePx / 2,
    width: sizePx,
    height: sizePx,
  };
}

/** 世界矩形 → 屏幕矩形。 */
export function worldRectToScreen(rect: Rect, viewport: Viewport): Rect {
  const topLeft = worldToScreen(viewport, { x: rect.x, y: rect.y });
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: rect.width * viewport.zoom,
    height: rect.height * viewport.zoom,
  };
}

/**
 * 环绕旋转区判定（屏幕坐标）：手柄立方体**外侧**的方环。
 * 与手柄命中互斥——外侧才算旋转（Figma 手感：角落上拖动是缩放，稍外侧才是旋转）。
 */
export function inRotateZone(corner: Point, point: Point, band = ROTATE_ZONE_PX): boolean {
  const dx = Math.abs(point.x - corner.x);
  const dy = Math.abs(point.y - corner.y);
  const outer = HANDLE_SIZE_PX / 2 + band;
  const inner = HANDLE_SIZE_PX / 2 + 1;
  // 落在「手柄外、环带内」且两轴都进入环带范围（正方形环），排除与手柄重叠的格子
  return dx > inner && dy > inner && dx <= outer && dy <= outer;
}

/** 帧号/统计用的轻量计数器（渲染层向门禁暴露「画了什么」）。 */
export interface RenderStats {
  frame: number;
  nodesDrawn: number;
  selectionOutlines: number;
  handles: number;
  snapGuides: number;
  measurements: number;
  marquee: boolean;
  hoverId: string | null;
  selectedIds: string[];
}
