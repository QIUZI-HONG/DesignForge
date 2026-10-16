/**
 * [独立验证 · engine] 几何与命中边界测试。
 *
 * 覆盖风险点：旋转节点的点选/框选、负尺寸、零尺寸、极坐标（±10000）、
 * 缩放两端（0.01 / 100 与其夹取）下的命中与坐标换算精度。
 */

import { describe, expect, it } from 'vitest';

import { rotatePointsAround } from '../geometry/bounds';
import { hitTestPoint, marqueeSelect } from '../geometry/hit-test';
import { nodeQuadInRect, worldBoundsOfNode, worldQuad } from '../geometry/transform';
import {
  clampZoom,
  createViewport,
  MAX_ZOOM,
  MIN_ZOOM,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '../interaction/viewport';
import {
  createDocument,
  createFrame,
  createPage,
  createRect,
  type ScenePage,
} from '../model/index';
import { getPage, insertNode } from '../scene/index';

/** 单页场景构造器（返回页面与文档）。 */
function pageWith(nodes: Array<{ node: ReturnType<typeof createRect>; parentId: string | null }>): {
  page: ScenePage;
  pageId: string;
} {
  let doc = createDocument({ id: 'd', pages: [createPage({ id: 'p1' })] });
  for (const { node, parentId } of nodes) {
    doc = insertNode(doc, 'p1', node, parentId);
  }
  return { page: getPage(doc, 'p1'), pageId: 'p1' };
}

// ---------------------------------------------------------------------------
// 旋转节点：点选
// ---------------------------------------------------------------------------

describe('[verify] 命中 · 旋转节点点选', () => {
  const rotated = () =>
    pageWith([
      {
        node: createRect({ id: 'rr', x: 0, y: 0, width: 100, height: 50, rotation: 45 }),
        parentId: null,
      },
    ]);

  it('中心命中；落在 AABB 内但在 OBB 外的点不命中', () => {
    const { page } = rotated();
    const quad = worldQuad(page, 'rr') as Array<{ x: number; y: number }>;
    const center = { x: 50, y: 25 };
    expect(hitTestPoint(page, center)?.id).toBe('rr');

    // 旋转 45° 后 AABB ≈ [-3.03, -28.03] ~ [103.03, 78.03]；点 (0, -25) 在 AABB 内
    const aabb = worldBoundsOfNode(page, 'rr') as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    expect(aabb.x).toBeLessThan(0);
    expect(aabb.y).toBeLessThan(-25);
    expect(hitTestPoint(page, { x: 0, y: -25 })).toBeNull();
    // 该点确实在 AABB 内（证明上面的 miss 是旋转感知的结果，不是框选外）
    expect(0 >= aabb.x && 0 <= aabb.x + aabb.width).toBe(true);

    // 四角（OBB 顶点）稍向内应命中（含边界）
    for (const corner of quad) {
      const probe = {
        x: corner.x + (center.x - corner.x) * 1e-6,
        y: corner.y + (center.y - corner.y) * 1e-6,
      };
      expect(hitTestPoint(page, probe)?.id).toBe('rr');
    }
    // 四角稍向外（沿背离中心方向）不命中
    for (const corner of quad) {
      const probe = {
        x: corner.x + (corner.x - center.x) * 1e-3,
        y: corner.y + (corner.y - center.y) * 1e-3,
      };
      expect(hitTestPoint(page, probe)).toBeNull();
    }
  });

  it('旋转 90° 后原角落由命中变不命中（旋转真实参与判定）', () => {
    const { page } = pageWith([
      { node: createRect({ id: 'r0', x: 0, y: 0, width: 100, height: 50 }), parentId: null },
    ]);
    const { page: page90 } = pageWith([
      {
        node: createRect({ id: 'r90', x: 0, y: 0, width: 100, height: 50, rotation: 90 }),
        parentId: null,
      },
    ]);
    const probe = { x: 2, y: 2, width: 0.5, height: 0.5 }; // 未旋转时命中（本地 (2,2) 附近）
    expect(hitTestPoint(page, { x: 2, y: 2 })?.id).toBe('r0');
    expect(nodeQuadInRect(page, 'r0', probe, 'intersect')).toBe(true);
    // 绕中心 (50,25) 转 90° 后，世界 (2,2) 落在旋转矩形的短边之外
    expect(hitTestPoint(page90, { x: 2, y: 2 })).toBeNull();
    expect(nodeQuadInRect(page90, 'r90', probe, 'intersect')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 旋转节点：框选
// ---------------------------------------------------------------------------

describe('[verify] 命中 · 旋转节点框选', () => {
  function rotatedPage(rotation: number) {
    return pageWith([
      {
        node: createRect({ id: 'rr', x: 0, y: 0, width: 100, height: 50, rotation }),
        parentId: null,
      },
    ]);
  }

  it('intersect 模式：仅与 OBB 相交的框选中；只碰到 AABB 角落的框不选中', () => {
    const { page } = rotatedPage(45);
    // 紧贴 AABB 左上角的小框：与 AABB 相交但不与 OBB 相交
    const cornerOnly = { x: -3.2, y: -28.2, width: 2.5, height: 2.5 };
    expect(marqueeSelect(page, cornerOnly, { mode: 'intersect' })).toEqual([]);
    // 覆盖中心的框：与 OBB 相交
    expect(
      marqueeSelect(page, { x: 40, y: 15, width: 20, height: 20 }, { mode: 'intersect' }),
    ).toEqual(['rr']);
  });

  it('contain 模式：紧包旋转后矩形的框选中；削掉一个角的框不选中', () => {
    const { page } = rotatedPage(45);
    const quad = worldQuad(page, 'rr') as Array<{ x: number; y: number }>;
    const xs = quad.map((p) => p.x);
    const ys = quad.map((p) => p.y);
    // 轴对齐框若要包含 45° 矩形，必须包含其 AABB（AABB 是轴对齐下的最小包围盒）
    const tight = {
      x: Math.min(...xs) - 0.5,
      y: Math.min(...ys) - 0.5,
      width: Math.max(...xs) - Math.min(...xs) + 1,
      height: Math.max(...ys) - Math.min(...ys) + 1,
    };
    expect(marqueeSelect(page, tight, { mode: 'contain' })).toEqual(['rr']);
    // 削掉右下角：intersect 仍选中，contain 不选中
    const cut = {
      x: tight.x,
      y: tight.y,
      width: tight.width - 1.5,
      height: tight.height - 1.5,
    };
    expect(marqueeSelect(page, cut, { mode: 'intersect' })).toEqual(['rr']);
    expect(marqueeSelect(page, cut, { mode: 'contain' })).toEqual([]);
  });

  it('旋转容器内的子节点：框选深入子层而非选中容器', () => {
    let doc = createDocument({ id: 'd', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'f1', x: 0, y: 0, width: 200, height: 200, rotation: 30 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'kid', x: 20, y: 20, width: 40, height: 40 }),
      'f1',
    );
    const page = getPage(doc, 'p1');
    const kidBounds = worldBoundsOfNode(page, 'kid') as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    const marquee = {
      x: kidBounds.x - 2,
      y: kidBounds.y - 2,
      width: kidBounds.width + 4,
      height: kidBounds.height + 4,
    };
    expect(marqueeSelect(page, marquee, { mode: 'contain' })).toEqual(['kid']);
  });
});

// ---------------------------------------------------------------------------
// 负尺寸 / 零尺寸
// ---------------------------------------------------------------------------

describe('[verify] 命中 · 负尺寸与零尺寸', () => {
  it('负尺寸矩形：几何归正，中心点仍命中', () => {
    const { page } = pageWith([
      { node: createRect({ id: 'neg', x: 0, y: 0, width: -100, height: -50 }), parentId: null },
    ]);
    const bounds = worldBoundsOfNode(page, 'neg');
    expect(bounds).toMatchObject({ x: -100, y: -50, width: 100, height: 50 });
    expect(hitTestPoint(page, { x: -50, y: -25 })?.id).toBe('neg');
    expect(hitTestPoint(page, { x: -101, y: -25 })).toBeNull();
    expect(hitTestPoint(page, { x: -100, y: -50 })?.id).toBe('neg'); // 边界含
    // 框选 contain 也应把负尺寸节点当作归正矩形
    expect(
      marqueeSelect(page, { x: -101, y: -51, width: 102, height: 52 }, { mode: 'contain' }),
    ).toEqual(['neg']);
  });

  it('零宽/零高矩形：任意点（含线段之外）都被判为命中（退化边缺陷，已复现）', () => {
    const { page } = pageWith([
      { node: createRect({ id: 'line', x: 10, y: 10, width: 0, height: 50 }), parentId: null },
    ]);
    // 线段上的点：命中（正确）
    expect(hitTestPoint(page, { x: 10, y: 30 })?.id).toBe('line');
    // 期望（直觉口径）：线段之外不命中；实际：命中了 0.5px 之外的点
    expect(hitTestPoint(page, { x: 10.5, y: 30 })?.id).toBe('line');
    // 更极端的证据：整个页面任意坐标都命中该零宽节点
    expect(hitTestPoint(page, { x: 1e6, y: -1e6 })?.id).toBe('line');
    // 零高同理
    const { page: page2 } = pageWith([
      { node: createRect({ id: 'flat', x: 0, y: 0, width: 80, height: 0 }), parentId: null },
    ]);
    expect(hitTestPoint(page2, { x: 40, y: 999 })?.id).toBe('flat');
    // 同一根因还污染框选：零面积框选矩形与任意矩形相交（退化线段判定缺陷）
    expect(
      nodeQuadInRect(page2, 'flat', { x: 500, y: 500, width: 0, height: 0 }, 'intersect'),
    ).toBe(true);
    expect(
      marqueeSelect(page2, { x: 500, y: 500, width: 0, height: 0 }, { mode: 'intersect' }),
    ).toEqual(['flat']);
  });

  it('零尺寸矩形（0×0）：任意远点都被判为命中（退化四边形点归属缺陷，已复现）', () => {
    const { page } = pageWith([
      { node: createRect({ id: 'dot', x: 10, y: 10, width: 0, height: 0 }), parentId: null },
      { node: createRect({ id: 'big', x: 500, y: 500, width: 100, height: 100 }), parentId: null },
    ]);
    // 期望（直觉口径）：只有 (10,10) 这一点命中；实际：0×0 节点在任意坐标都命中
    // 远端探测点 (9999, 9999) 本应无命中，实际返回 dot
    const far = hitTestPoint(page, { x: 9999, y: 9999 });
    expect(far?.id).toBe('dot');
    // 更严重的后果：视觉最上层点击被 0×0 节点吞掉（把 dot 放在大矩形之后）
    expect(hitTestPoint(page, { x: 550, y: 550 })?.id).toBe('big');
    const { page: page2 } = pageWith([
      { node: createRect({ id: 'big2', x: 0, y: 0, width: 100, height: 100 }), parentId: null },
      { node: createRect({ id: 'dot2', x: 10, y: 10, width: 0, height: 0 }), parentId: null },
    ]);
    // dot2 在绘制顺序上更靠上 → 点大矩形内部任意位置都被 dot2 抢走
    expect(hitTestPoint(page2, { x: 80, y: 80 })?.id).toBe('dot2');
  });
});

// ---------------------------------------------------------------------------
// 极坐标（±10000）
// ---------------------------------------------------------------------------

describe('[verify] 命中 · 极坐标 ±10000', () => {
  it('10000 处的边界命中与越界不命中（无浮点漂移）', () => {
    const { page } = pageWith([
      {
        node: createRect({ id: 'far', x: 10000, y: -10000, width: 100, height: 100 }),
        parentId: null,
      },
    ]);
    expect(hitTestPoint(page, { x: 10000, y: -10000 })?.id).toBe('far'); // 左上角（含边界）
    expect(hitTestPoint(page, { x: 10100, y: -9900 })?.id).toBe('far'); // 右下角（含边界）
    expect(hitTestPoint(page, { x: 10050, y: -9950 })?.id).toBe('far'); // 中心
    expect(hitTestPoint(page, { x: 10099.999999, y: -9900 })).not.toBeNull();
    expect(hitTestPoint(page, { x: 10100.0001, y: -9900 })).toBeNull();
    expect(hitTestPoint(page, { x: 9999.9999, y: -9950 })).toBeNull();
  });

  it('20000 处的旋转节点：世界 AABB 与 OBB 关系仍然正确', () => {
    const { page } = pageWith([
      {
        node: createRect({ id: 'far2', x: 20000, y: 20000, width: 100, height: 100, rotation: 45 }),
        parentId: null,
      },
    ]);
    const center = { x: 20050, y: 20050 };
    expect(hitTestPoint(page, center)?.id).toBe('far2');
    const quad = worldQuad(page, 'far2') as Array<{ x: number; y: number }>;
    const manual = rotatePointsAround(
      [
        { x: 20000, y: 20000 },
        { x: 20100, y: 20000 },
        { x: 20100, y: 20100 },
        { x: 20000, y: 20100 },
      ],
      center,
      45,
    );
    for (let index = 0; index < 4; index += 1) {
      expect(quad[index]?.x).toBeCloseTo(manual[index]?.x as number, 6);
      expect(quad[index]?.y).toBeCloseTo(manual[index]?.y as number, 6);
    }
    // AABB 之外的角点不命中
    const aabb = worldBoundsOfNode(page, 'far2') as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    expect(hitTestPoint(page, { x: aabb.x + 1, y: aabb.y + 1 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 缩放两端
// ---------------------------------------------------------------------------

describe('[verify] 视口 · 缩放 0.01 / 100 两端', () => {
  it('zoom < MIN_ZOOM 被夹取到 0.02；> MAX_ZOOM 夹取到 256', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(createViewport(0.01).zoom).toBe(MIN_ZOOM);
    expect(clampZoom(100)).toBe(100);
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('screen↔world 往返在两端保持精度（相对误差 < 1e-9）', () => {
    for (const zoom of [MIN_ZOOM, 0.01, 1, 100, MAX_ZOOM]) {
      const viewport = createViewport(zoom, -12345.5, 6789.25);
      for (const screen of [
        { x: 0, y: 0 },
        { x: 1_000_000, y: -1_000_000 },
        { x: 1920, y: 1080 },
      ]) {
        const world = screenToWorld(viewport, screen);
        const back = worldToScreen(viewport, world);
        const errorX = Math.abs(back.x - screen.x) / Math.max(1, Math.abs(screen.x));
        const errorY = Math.abs(back.y - screen.y) / Math.max(1, Math.abs(screen.y));
        expect(errorX).toBeLessThan(1e-9);
        expect(errorY).toBeLessThan(1e-9);
      }
    }
  });

  it('缩放 0.02 与 256 下 zoomAt 锚点世界坐标保持不动', () => {
    for (const target of [MIN_ZOOM, MAX_ZOOM]) {
      const viewport = createViewport(1, 10, 20);
      const anchor = { x: 333, y: 222 };
      const worldBefore = screenToWorld(viewport, anchor);
      const zoomed = zoomAt(viewport, target, anchor);
      const worldAfter = screenToWorld(zoomed, anchor);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 9);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
    }
  });

  it('缩放 0.02 下 1 屏幕像素对应的世界距离 = 50（命中仍以世界坐标判定）', () => {
    const viewport = createViewport(MIN_ZOOM, 0, 0);
    const a = screenToWorld(viewport, { x: 0, y: 0 });
    const b = screenToWorld(viewport, { x: 1, y: 0 });
    expect(b.x - a.x).toBeCloseTo(50, 9);
  });
});
