/**
 * 参考线命中/拖拽几何测试（票 12 · 纯函数，无 Skia/DOM）。
 *
 * 断言口径：屏幕坐标 ↔ 世界坐标的判定行为——标尺条判定、轴向归属、
 * 既有参考线命中（屏幕距离阈值）、标尺条内不命中（那是「拉新线」的领地）。
 */

import { createGuide, createPage, createViewport } from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import {
  GUIDE_HIT_RADIUS_PX,
  guideHitAt,
  guideWorldPosition,
  isOverRulerStrip,
  rulerDragAxisAt,
} from './guides';

const viewport = createViewport(1, 0, 0);
const page = () => createPage({ id: 'p1' });
const pageWithGuides = () =>
  createPage({
    id: 'p1',
    guides: [
      createGuide({ id: 'guide_v', axis: 'x', position: 200 }),
      createGuide({ id: 'guide_h', axis: 'y', position: 120 }),
    ],
  });

describe('标尺条判定', () => {
  it('顶部水平条与左侧垂直条内为真；画布区为假（条占 0..20 前开区间）', () => {
    expect(isOverRulerStrip({ x: 10, y: 10 })).toBe(true);
    expect(isOverRulerStrip({ x: 10, y: 100 })).toBe(true); // 左条
    expect(isOverRulerStrip({ x: 300, y: 10 })).toBe(true); // 顶条
    expect(isOverRulerStrip({ x: 300, y: 100 })).toBe(false);
    expect(isOverRulerStrip({ x: 20, y: 20 })).toBe(false); // 恰在条外缘 = 画布首行
    expect(isOverRulerStrip({ x: -50, y: -50 })).toBe(false); // 负坐标 = 画布外起手（框选），不是条内
  });

  it('顶条归属水平线（y）、左条归属垂直线（x）；角点归顶条', () => {
    expect(rulerDragAxisAt({ x: 300, y: 10 })).toBe('y');
    expect(rulerDragAxisAt({ x: 10, y: 100 })).toBe('x');
    expect(rulerDragAxisAt({ x: 10, y: 10 })).toBe('y');
    expect(rulerDragAxisAt({ x: 300, y: 100 })).toBe(null);
    expect(rulerDragAxisAt({ x: 20, y: 20 })).toBe(null);
  });
});

describe('既有参考线命中', () => {
  it('屏幕距离 ≤ 阈值命中；取数组末条（后画在上）', () => {
    // guide_v 在世界 x=200 → 屏幕 x=200；指针 x=199 命中
    expect(guideHitAt({ x: 199, y: 100 }, pageWithGuides(), viewport)?.id).toBe('guide_v');
    // 同点同时靠近两条（交点附近）：末条优先
    expect(guideHitAt({ x: 200, y: 120 }, pageWithGuides(), viewport)?.id).toBe('guide_h');
  });

  it('超过阈值不命中；空页面不命中', () => {
    expect(guideHitAt({ x: 210, y: 100 }, pageWithGuides(), viewport)).toBe(null);
    expect(GUIDE_HIT_RADIUS_PX).toBeGreaterThan(0);
    expect(guideHitAt({ x: 200, y: 120 }, page(), viewport)).toBe(null);
  });

  it('标尺条内不命中（拉新线优先于抓既有线）', () => {
    // guide_h 在屏幕 y=120 —— 不在条内；构造一条落在条内的线验证
    const pageEdge = createPage({
      id: 'p1',
      guides: [createGuide({ id: 'guide_edge', axis: 'y', position: 10 })],
    });
    expect(guideHitAt({ x: 300, y: 10 }, pageEdge, viewport)).toBe(null);
  });
});

describe('拖拽位置（屏幕 → 世界）', () => {
  it('轴向取对应世界坐标分量；缩放/平移下换算正确', () => {
    expect(guideWorldPosition('x', { x: 200, y: 0 }, viewport)).toBe(200);
    expect(guideWorldPosition('y', { x: 0, y: 120 }, viewport)).toBe(120);
    const zoomed = createViewport(2, 10, -20);
    // 屏幕 x=210 → 世界 (210-10)/2 = 100；屏幕 y=180 → 世界 (180+20)/2 = 100
    expect(guideWorldPosition('x', { x: 210, y: 0 }, zoomed)).toBe(100);
    expect(guideWorldPosition('y', { x: 0, y: 180 }, zoomed)).toBe(100);
  });
});
