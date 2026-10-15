/**
 * 评论钉点坐标换算测试（seam：`coords.ts`）。
 *
 * 规则来自 C12 与 briefs/fe-07.md §2：钉点走**世界坐标**，随缩放/平移跟随；
 * 命中判定在**屏幕空间**（半径按屏幕像素，缩小时钉点不变得更难点）。
 */
import { createViewport } from '@dforge/engine';
import { describe, expect, it } from 'vitest';
import { hitTestPins, pinScreenPoint, worldAnchorAt } from './coords';

describe('评论钉点 · 世界 ↔ 屏幕', () => {
  it('初始视口（zoom 1 / pan 0）下屏幕坐标等于世界坐标', () => {
    expect(pinScreenPoint(createViewport(), { x: 100, y: 60 })).toEqual({ x: 100, y: 60 });
  });

  it('缩放与平移后钉点跟随：screen = world × zoom + pan', () => {
    const viewport = createViewport(2, 30, -10);
    expect(pinScreenPoint(viewport, { x: 100, y: 60 })).toEqual({ x: 230, y: 110 });
  });

  it('屏幕点 → 世界锚点可反向换算（新建评论用）', () => {
    const viewport = createViewport(0.5, 40, 20);
    const world = worldAnchorAt(viewport, { x: 90, y: 70 });
    expect(world).toEqual({ x: 100, y: 100 });
    expect(pinScreenPoint(viewport, world)).toEqual({ x: 90, y: 70 });
  });
});

describe('评论钉点 · 屏幕空间命中', () => {
  const pins = [
    { id: 'c1', anchor: { x: 0, y: 0 } },
    { id: 'c2', anchor: { x: 40, y: 0 } },
  ];

  it('半径内命中最近的钉点', () => {
    const viewport = createViewport();
    // 屏幕点 (3, 2)：到 c1 距离 ≈ 3.6，到 c2 ≈ 37 → 命中 c1
    expect(hitTestPins(pins, viewport, { x: 3, y: 2 }, 16)).toBe('c1');
    // 屏幕点 (36, 0)：到 c2 距离 4，到 c1 距离 36 → 命中 c2
    expect(hitTestPins(pins, viewport, { x: 36, y: 0 }, 16)).toBe('c2');
  });

  it('半径外不命中', () => {
    expect(hitTestPins(pins, createViewport(), { x: 200, y: 200 }, 16)).toBeNull();
  });

  it('半径按屏幕像素：缩小后世界距离 40 的两钉在屏上更近，仍可命中', () => {
    const zoomedOut = createViewport(0.5);
    // 世界 (40, 0) 在 0.5 缩放下落于屏幕 (20, 0)：到 c2 仅 1px
    expect(hitTestPins(pins, zoomedOut, { x: 20, y: 0 }, 16)).toBe('c2');
  });

  it('空钉点集返回 null（不抛错）', () => {
    expect(hitTestPins([], createViewport(), { x: 0, y: 0 }, 16)).toBeNull();
  });
});
