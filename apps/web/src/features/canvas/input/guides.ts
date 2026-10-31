/**
 * 参考线命中/拖拽几何（票 12 · 渲染无关的纯函数）。
 *
 * 与 scale.ts 同一口径：阈值/厚度是**几何常量**，坐标换算复用引擎的视口数学。
 * 会话（state/session.ts）消费这里的三类判定：标尺条内拉新线、条外抓既有线、
 * 松手位置是否回到标尺（删除/取消）。
 */

import type { GuideAxis, PageGuide, Point, ScenePage, Viewport } from '@dforge/engine';
import { guidesOf, screenToWorld, worldToScreen } from '@dforge/engine';

import { RULER_SIZE } from '../render/scale';

/** 既有参考线的命中半径（屏幕 px，几何常量）。 */
export const GUIDE_HIT_RADIUS_PX = 4;

/**
 * 指针是否在标尺条上（顶部水平标尺或左侧垂直标尺，屏幕坐标；条占 0..RULER_SIZE 前开区间）。
 * 负坐标不算条内——框选等手势可以从画布外（元素可视区之外）起手，标尺条只覆盖 0..20。
 */
export function isOverRulerStrip(screen: Point): boolean {
  return (screen.x >= 0 && screen.x < RULER_SIZE) || (screen.y >= 0 && screen.y < RULER_SIZE);
}

/**
 * 标尺条拖拽的参考线轴向：顶条 → 水平线（axis 'y'）、左条 → 垂直线（axis 'x'）。
 * 角点（两条件重叠区）归顶条（绘制层顶条先画，与视觉归属一致）。不在条上 → null。
 */
export function rulerDragAxisAt(screen: Point): GuideAxis | null {
  if (screen.y >= 0 && screen.y < RULER_SIZE) return 'y';
  if (screen.x >= 0 && screen.x < RULER_SIZE) return 'x';
  return null;
}

/** 参考线在拖拽轴上的世界位置（指针屏幕坐标 → 世界坐标，取轴向分量）。 */
export function guideWorldPosition(axis: GuideAxis, screen: Point, viewport: Viewport): number {
  const world = screenToWorld(viewport, screen);
  return axis === 'x' ? world.x : world.y;
}

/**
 * 命中既有参考线（屏幕距离 ≤ GUIDE_HIT_RADIUS_PX）；同点靠近多条取数组末条（后建在上）。
 * 标尺条内**不**命中——条内指针是「拉出新线」的领地（否则条附近的线永远抓不到新线入口）。
 */
export function guideHitAt(screen: Point, page: ScenePage, viewport: Viewport): PageGuide | null {
  if (isOverRulerStrip(screen)) return null;
  const guides = guidesOf(page);
  for (let index = guides.length - 1; index >= 0; index -= 1) {
    const guide = guides[index];
    if (guide === undefined) continue;
    const distance =
      guide.axis === 'x'
        ? Math.abs(worldToScreen(viewport, { x: guide.position, y: 0 }).x - screen.x)
        : Math.abs(worldToScreen(viewport, { x: 0, y: guide.position }).y - screen.y);
    if (distance <= GUIDE_HIT_RADIUS_PX) return guide;
  }
  return null;
}
