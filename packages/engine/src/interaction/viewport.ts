/**
 * 视口（画布缩放/平移，白名单第 4/5 类）。
 *
 * 纯数据 + 纯函数：`zoom` 为缩放系数，`panX/panY` 为屏幕像素平移量。
 * 屏幕 ↔ 世界：`world = (screen - pan) / zoom`、`screen = world * zoom + pan`。
 */

import type { Point, Rect, Size } from '../geometry/types';

/** 视口状态。 */
export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

/** 缩放上下限（Figma 量级）。 */
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 256;

/** C16 缩放菜单的百分比档位。 */
export const ZOOM_LEVELS: readonly number[] = [
  0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 8, 16, 32, 64, 128, 256,
];

/** 初始视口。 */
export function createViewport(zoom = 1, panX = 0, panY = 0): Viewport {
  return { zoom: clampZoom(zoom), panX, panY };
}

/** 缩放裁剪。 */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** 屏幕坐标 → 世界坐标。 */
export function screenToWorld(viewport: Viewport, screen: Point): Point {
  return {
    x: (screen.x - viewport.panX) / viewport.zoom,
    y: (screen.y - viewport.panY) / viewport.zoom,
  };
}

/** 世界坐标 → 屏幕坐标。 */
export function worldToScreen(viewport: Viewport, world: Point): Point {
  return { x: world.x * viewport.zoom + viewport.panX, y: world.y * viewport.zoom + viewport.panY };
}

/** 平移（屏幕像素增量，白名单第 5 类：画布平移）。 */
export function panBy(viewport: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return { ...viewport, panX: viewport.panX + dxScreen, panY: viewport.panY + dyScreen };
}

/**
 * 以屏幕锚点为中心缩放到指定倍率（白名单第 4 类：画布缩放）。
 * 锚点（鼠标位置）下的世界点保持不动——Figma 的滚轮缩放手感。
 */
export function zoomAt(viewport: Viewport, nextZoom: number, anchorScreen: Point): Viewport {
  const zoom = clampZoom(nextZoom);
  if (zoom === viewport.zoom) return viewport;
  const worldAnchor = screenToWorld(viewport, anchorScreen);
  return {
    zoom,
    panX: anchorScreen.x - worldAnchor.x * zoom,
    panY: anchorScreen.y - worldAnchor.y * zoom,
  };
}

/** 按倍率缩放（factor > 1 放大）。 */
export function zoomByFactor(viewport: Viewport, factor: number, anchorScreen: Point): Viewport {
  return zoomAt(viewport, viewport.zoom * factor, anchorScreen);
}

/** 滚轮缩放：Ctrl/⌘ + 滚轮或触控板双指缩放皆归一到本函数。 */
export function zoomByWheel(
  viewport: Viewport,
  deltaY: number,
  anchorScreen: Point,
  options: { sensitivity?: number } = {},
): Viewport {
  const sensitivity = options.sensitivity ?? 0.0015;
  const factor = Math.exp(-deltaY * sensitivity);
  return zoomByFactor(viewport, factor, anchorScreen);
}

/** 按档位步进（缩放菜单的 +/- 或键盘快捷键）。 */
export function zoomStep(viewport: Viewport, steps: number, anchorScreen: Point): Viewport {
  if (steps === 0) return viewport;
  const currentIndex = ZOOM_LEVELS.findIndex((level) => level >= viewport.zoom - 1e-9);
  const startIndex = currentIndex < 0 ? ZOOM_LEVELS.length - 1 : currentIndex;
  const targetIndex = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, startIndex + steps));
  return zoomAt(viewport, ZOOM_LEVELS[targetIndex] as number, anchorScreen);
}

/** 100% 视图（以屏幕中心为锚点）。 */
export function zoomTo100(viewport: Viewport, viewportSize: Size): Viewport {
  const center = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
  return zoomAt(viewport, 1, center);
}

/** 适应画布：把世界矩形放进视口（含边距）。 */
export function fitBounds(
  bounds: Rect,
  viewportSize: Size,
  options: { padding?: number; maxZoom?: number } = {},
): Viewport {
  const padding = options.padding ?? 40;
  const maxZoom = options.maxZoom ?? 1;
  const usableWidth = Math.max(1, viewportSize.width - padding * 2);
  const usableHeight = Math.max(1, viewportSize.height - padding * 2);
  const zoom = clampZoom(
    Math.min(
      maxZoom,
      bounds.width > 0 ? usableWidth / bounds.width : maxZoom,
      bounds.height > 0 ? usableHeight / bounds.height : maxZoom,
    ),
  );
  return {
    zoom,
    panX: viewportSize.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    panY: viewportSize.height / 2 - (bounds.y + bounds.height / 2) * zoom,
  };
}

/** 视口可见的世界矩形。 */
export function visibleWorldRect(viewport: Viewport, viewportSize: Size): Rect {
  const topLeft = screenToWorld(viewport, { x: 0, y: 0 });
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: viewportSize.width / viewport.zoom,
    height: viewportSize.height / viewport.zoom,
  };
}

/** 视口是否可见某世界点。 */
export function isWorldPointVisible(viewport: Viewport, viewportSize: Size, point: Point): boolean {
  const screen = worldToScreen(viewport, point);
  return (
    screen.x >= 0 &&
    screen.y >= 0 &&
    screen.x <= viewportSize.width &&
    screen.y <= viewportSize.height
  );
}

/** 百分数显示（C16 缩放菜单文案）。 */
export function zoomPercent(viewport: Viewport): number {
  return Math.round(viewport.zoom * 100);
}
