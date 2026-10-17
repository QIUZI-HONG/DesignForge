// @vitest-environment jsdom
/**
 * 对抗性验证 · 风险 4：画布边界
 *
 * 覆盖：空文档 / 无选中 / 超大文档（≥500 节点）/ 拖动中被删除 / 旋转节点手柄命中 /
 *      缩放锚点漂移 / 吸附阈值 5.99 vs 6.00。
 */
import {
  CommandStack,
  computeSnap,
  createDocument,
  createPage,
  createRect,
  createSelection,
  getPage,
  hitTestHandle,
  rotatedHandlePoints,
  SNAP_THRESHOLD_PX,
  snapThresholdWorld,
  worldBoundsOfNode,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { handleHitAt } from '@/features/canvas/input/hit';
import { type CanvasSession, createCanvasSession } from '@/features/canvas/state/session';

/** 会话：任意页面 + 初始视口。 */
function sessionOf(
  page: ReturnType<typeof createPage>,
  viewport = { zoom: 1, panX: 0, panY: 0 },
): CanvasSession {
  const document = createDocument({ id: 'doc_1', pages: [page] });
  return createCanvasSession({ document, pageId: page.id, viewport });
}

/** 画布会话构造（correct 形状）。 */
function makeSession(
  page: ReturnType<typeof createPage>,
  viewport = { zoom: 1, panX: 0, panY: 0 },
): CanvasSession {
  const doc = createDocument({ id: 'doc_1', pages: [page] });
  return createCanvasSession({ document: doc, pageId: page.id, viewport });
}

describe('画布边界 · 空文档 / 无选中', () => {
  it('空页面：selectAll / 删除 / 对齐 / 成组 / 适应画布都不得抛错或写历史', () => {
    const session = makeSession(createPage({ id: 'page_1' }));
    expect(() => {
      session.selectAll();
      session.deleteSelection();
      session.align('left');
      session.distribute('horizontal');
      session.group();
      session.ungroup();
      session.reorder('front');
      session.nudge(1, 0);
      session.zoomToFit({ width: 1200, height: 800 });
      session.zoom100({ width: 1200, height: 800 });
      session.zoomIn({ x: 600, y: 400 });
      session.zoomOut({ x: 600, y: 400 });
    }).not.toThrow();
    expect(session.stack.history().undo).toHaveLength(0);
    expect(session.undo).toBeTypeOf('function');
  });

  it('空页面 + 零尺寸视口：zoomToFit 不得产出 NaN/Infinity（视口会被写进渲染管线）', () => {
    const session = makeSession(createPage({ id: 'page_1' }));
    session.zoomToFit({ width: 0, height: 0 });
    const viewport = session.viewport();
    expect(Number.isFinite(viewport.zoom)).toBe(true);
    expect(Number.isFinite(viewport.panX)).toBe(true);
    expect(Number.isFinite(viewport.panY)).toBe(true);
  });

  it('无选中：undo/redo/复制/粘贴/副本都是空操作（不写历史、不抛错）', () => {
    const session = makeSession(createPage({ id: 'page_1' }));
    expect(() => {
      session.undo();
      session.redo();
      session.copy();
      void session.paste();
      session.duplicate();
    }).not.toThrow();
    expect(session.stack.history().undo).toHaveLength(0);
  });

  it('指针序列在空页面上完整走一遍（点空 → 框选 → 松手）不得抛错', () => {
    const session = makeSession(createPage({ id: 'page_1' }));
    expect(() => {
      session.pointerDown({ world: { x: 10, y: 10 }, screen: { x: 10, y: 10 }, button: 'left' });
      session.pointerMove({ world: { x: 200, y: 200 }, screen: { x: 200, y: 200 } });
      session.pointerUp({ world: { x: 200, y: 200 }, screen: { x: 200, y: 200 } });
    }).not.toThrow();
    expect(session.selection().ids).toEqual([]);
  });
});

describe('画布边界 · 超大文档（500 节点）', () => {
  /** 500 个矩形（10×10 网格）。 */
  function bigPage() {
    const nodes: Record<string, ReturnType<typeof createRect>> = {};
    const rootIds: string[] = [];
    for (let index = 0; index < 500; index += 1) {
      const id = `n_${index}`;
      nodes[id] = createRect({
        id,
        x: (index % 25) * 40,
        y: Math.floor(index / 25) * 40,
        width: 30,
        height: 30,
      });
      rootIds.push(id);
    }
    return createPage({ id: 'page_1', rootIds, nodes });
  }

  it('500 节点：全选 + 移动 + 撤销在一次会话里正确收敛（含耗时上限）', () => {
    const session = makeSession(bigPage());
    const started = performance.now();
    session.selectAll();
    expect(session.selection().ids).toHaveLength(500);
    session.nudge(10, 10);
    const started_at = performance.now();
    const after = session.selectedNodes();
    expect(after.every((node) => node.x % 40 === 10)).toBe(true);

    session.undo();
    expect(session.page().nodes.n_0?.x).toBe(0);
    const elapsed = performance.now() - started;
    // 一次全选 + 移动 + 撤销在 3s 内（真实交互预算的宽松上界；冒烟基线 500 节点 O(n) 命令）
    expect(elapsed, `500 节点操作耗时 ${Math.round(elapsed)}ms`).toBeLessThan(3000);
    void started_at;
  });

  it('500 节点：框选全量命中（矩形集合求交不丢不重）', () => {
    const session = makeSession(bigPage());
    session.pointerDown({ world: { x: -50, y: -50 }, screen: { x: -50, y: -50 }, button: 'left' });
    session.pointerMove({ world: { x: 1200, y: 1000 }, screen: { x: 1200, y: 1000 } });
    session.pointerUp({ world: { x: 1200, y: 1000 }, screen: { x: 1200, y: 1000 } });
    expect(new Set(session.selection().ids).size).toBe(500);
  });
});

describe('画布边界 · 拖动中被其它命令删除节点', () => {
  it('[缺陷] 拖动中途 ⌘Z 撤销掉正在拖的节点 → 松手抛未捕获 CommandError（单机可复现，无需外部 actor）', () => {
    const page = createPage({ id: 'page_1' });
    const session = makeSession(page);
    // 新建一个矩形（真实入口：创建工具插入 + 选中）
    session.createRect({ x: 0, y: 0, width: 100, height: 100 });
    const id = session.selection().ids[0] as string;

    session.pointerDown({ world: { x: 50, y: 50 }, screen: { x: 50, y: 50 }, button: 'left' });
    session.pointerMove({ world: { x: 120, y: 60 }, screen: { x: 120, y: 60 } });
    // 拖动中按 ⌘Z（壳层全局快捷键，拖动期间不禁用）→ 节点从文档消失
    session.undo();

    expect(() => {
      session.pointerMove({ world: { x: 160, y: 90 }, screen: { x: 160, y: 90 } });
      session.pointerUp({ world: { x: 160, y: 90 }, screen: { x: 160, y: 90 } });
    }).not.toThrow();
    expect(session.page().nodes[id]).toBeUndefined();
  });

  it('拖动中途节点被删：松手不得抛未捕获异常（拖拽序列来自真实 pointer 事件）', () => {
    const rect = createRect({ id: 'n_rect', x: 0, y: 0, width: 100, height: 100 });
    const page = createPage({ id: 'page_1', rootIds: ['n_rect'], nodes: { n_rect: rect } });
    const session = makeSession(page);

    session.pointerDown({ world: { x: 50, y: 50 }, screen: { x: 50, y: 50 }, button: 'left' });
    session.pointerMove({ world: { x: 150, y: 50 }, screen: { x: 150, y: 50 } });
    // 「其它 actor」删掉拖动中的节点（MCP/AI/面板命令）
    session.stack.dispatch([{ type: 'node.remove', pageId: 'page_1', nodeId: 'n_rect' }], {
      label: '外部删除',
    });

    expect(() => {
      session.pointerMove({ world: { x: 200, y: 80 }, screen: { x: 200, y: 80 } });
      session.pointerUp({ world: { x: 200, y: 80 }, screen: { x: 200, y: 80 } });
    }).not.toThrow();
    // 松手不得留下半成品命令（文档里该节点已删除，不应有 node.move 历史）
    expect(session.stack.history().undo.filter((label) => label === '移动')).toHaveLength(0);
  });

  it('[补充] 拖动途中 ⌘Z → 松手：交互回到一致态（无半成品命令、无错误态、帧内选择集收敛）', () => {
    const session = makeSession(createPage({ id: 'page_1' }));
    session.createRect({ x: 0, y: 0, width: 100, height: 100 });
    const id = session.selection().ids[0] as string;

    session.pointerDown({ world: { x: 50, y: 50 }, screen: { x: 50, y: 50 }, button: 'left' });
    session.pointerMove({ world: { x: 90, y: 60 }, screen: { x: 90, y: 60 } });
    session.undo();
    session.pointerMove({ world: { x: 130, y: 70 }, screen: { x: 130, y: 70 } });
    session.pointerUp({ world: { x: 130, y: 70 }, screen: { x: 130, y: 70 } });

    expect(session.page().nodes[id]).toBeUndefined();
    // 撤销条目留在重做栈，松手不得再写入任何历史（半成品命令 = 撤销栈被污染）
    expect(session.stack.history().undo).toHaveLength(0);
    expect(session.stack.history().redo).toHaveLength(1);
    // 交互回到一致态：不是「拖着一半」的中间态
    expect(session.store.getState().interaction.kind).toBe('idle');
    expect(session.store.getState().error).toBeNull();
    // 失效选择集不进渲染帧（自动收敛：不画幽灵高亮框）
    expect(session.frameInput().selection).toEqual([]);
  });
});

describe('画布边界 · 旋转节点的手柄命中', () => {
  it('旋转 45° 后手柄命中跟随旋转（拿引擎的旋转手柄点位验证，而非 AABB 角）', () => {
    const rect = createRect({ id: 'n_rect', x: 0, y: 0, width: 100, height: 100, rotation: 45 });
    const page = createPage({ id: 'page_1', rootIds: ['n_rect'], nodes: { n_rect: rect } });
    const bounds = worldBoundsOfNode(page, 'n_rect');
    expect(bounds).not.toBeNull();
    const points = rotatedHandlePoints(bounds as NonNullable<typeof bounds>, 45);
    const hit = handleHitAt(page, ['n_rect'], points.se, 1);
    expect(hit?.mode).toBe('resize');
    expect(hit?.id).toBe('se');

    // 反向：旋转后的 AABB 左下角**不是**手柄（若手柄没跟着旋转，这里会命中）
    const aabbCorner = { x: bounds!.x, y: bounds!.y + bounds!.height };
    const miss = handleHitAt(page, ['n_rect'], aabbCorner, 1);
    expect(miss).toBeNull();
  });

  it('角手柄外侧的环带命中旋转区（半径与缩放无关：12px 屏幕 → 世界换算）', () => {
    const rect = createRect({ id: 'n_rect', x: 0, y: 0, width: 100, height: 100, rotation: 30 });
    const page = createPage({ id: 'page_1', rootIds: ['n_rect'], nodes: { n_rect: rect } });
    const bounds = worldBoundsOfNode(page, 'n_rect')!;
    const points = rotatedHandlePoints(bounds, 30);
    const outside = { x: points.nw.x - 8, y: points.nw.y - 8 };
    const hit = handleHitAt(page, ['n_rect'], outside, 1);
    expect(hit?.mode).toBe('rotate');

    // 缩小到 25% 时，同样的世界偏移（8px 屏幕）不再算「外侧」→ 不得命中旋转区
    const hitZoomedOut = handleHitAt(page, ['n_rect'], outside, 0.25);
    expect(hitZoomedOut === null || hitZoomedOut.mode === 'resize').toBe(true);
  });
});

describe('画布边界 · ⌘+缩放锚点漂移', () => {
  it('缩放档位步进：锚点下的世界点保持不动（多档连乘无累积漂移）', () => {
    let viewport = { zoom: 1, panX: 37, panY: -11 };
    const anchor = { x: 640, y: 360 };
    for (let step = 0; step < 6; step += 1) {
      const before = screenToWorldOf(viewport, anchor);
      const session = makeSession(createPage({ id: 'page_1' }), viewport);
      session.zoomIn(anchor);
      viewport = session.viewport();
      const after = screenToWorldOf(viewport, anchor);
      expect(Math.abs(after.x - before.x)).toBeLessThan(1e-9);
      expect(Math.abs(after.y - before.y)).toBeLessThan(1e-9);
    }
  });

  it('滚轮缩放连续 20 次：锚点世界点漂移 < 1e-6（浮点累积上界）', () => {
    const session = makeSession(createPage({ id: 'page_1' }), { zoom: 1, panX: 12, panY: 34 });
    const anchor = { x: 300, y: 200 };
    const before = screenToWorldOf(session.viewport(), anchor);
    for (let index = 0; index < 20; index += 1) {
      session.wheel({ deltaX: 0, deltaY: index % 2 === 0 ? -120 : 60, zoom: true, screen: anchor });
    }
    const after = screenToWorldOf(session.viewport(), anchor);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
  });

  it('缩放到上限（256x）后继续放大：不得溢出且锚点仍不动', () => {
    const session = makeSession(createPage({ id: 'page_1' }), { zoom: 128, panX: 0, panY: 0 });
    const anchor = { x: 100, y: 100 };
    session.wheel({ deltaX: 0, deltaY: -500, zoom: true, screen: anchor });
    const atMax = session.viewport();
    expect(atMax.zoom).toBeLessThanOrEqual(256);
    const before = screenToWorldOf(atMax, anchor);
    session.wheel({ deltaX: 0, deltaY: -500, zoom: true, screen: anchor });
    const after = screenToWorldOf(session.viewport(), anchor);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-9);
  });
});

describe('画布边界 · 吸附阈值（5.99 / 6.00 / 6.01）', () => {
  it('世界阈值 = 6px / zoom（屏幕手感恒定）', () => {
    expect(snapThresholdWorld(1)).toBe(SNAP_THRESHOLD_PX);
    expect(snapThresholdWorld(2)).toBeCloseTo(3, 10);
    expect(snapThresholdWorld(0.5)).toBeCloseTo(12, 10);
    // 非法 zoom 回退屏幕阈值（不产生 Infinity）
    expect(snapThresholdWorld(0)).toBe(SNAP_THRESHOLD_PX);
  });

  it('纯函数边界：5.99 与 6.00 都吸附，6.01 不吸附（实现口径 = 「|Δ| ≤ 阈值」）', () => {
    const targets = [{ id: 't', bounds: { x: 200, y: 0, width: 100, height: 100 } }];
    const at = (gap: number) =>
      computeSnap({ x: 100 - gap, y: 0, width: 100, height: 100 }, targets, {
        axes: 'x',
        measurements: false,
      });
    expect(at(5.99).dx).toBeCloseTo(5.99, 9);
    expect(at(6.0).dx).toBeCloseTo(6.0, 9);
    expect(at(6.01).dx).toBe(0);
  });

  it('会话级（zoom=1）：间隙 6.00 吸附到对齐，6.01 不吸附（走真实 pointer 序列 + 命令）', () => {
    const a = createRect({ id: 'n_a', x: 0, y: 0, width: 100, height: 100 });
    const b = createRect({ id: 'n_b', x: 200, y: 0, width: 100, height: 100 });
    const page = createPage({ id: 'page_1', rootIds: ['n_a', 'n_b'], nodes: { n_a: a, n_b: b } });

    const snapped = makeSession(page);
    snapped.setSelection(['n_a'], 'n_a');
    snapped.pointerDown({ world: { x: 50, y: 50 }, screen: { x: 50, y: 50 }, button: 'left' });
    snapped.pointerMove({ world: { x: 144, y: 50 }, screen: { x: 144, y: 50 } }); // 右缘 194 → 间隙 6.00
    snapped.pointerUp({ world: { x: 144, y: 50 }, screen: { x: 144, y: 50 } });
    expect(getPage(snapped.stack.getSnapshot(), 'page_1').nodes.n_a?.x).toBe(100);

    const nearlySnapped = makeSession(page);
    nearlySnapped.setSelection(['n_a'], 'n_a');
    nearlySnapped.pointerDown({
      world: { x: 50, y: 50 },
      screen: { x: 50, y: 50 },
      button: 'left',
    });
    nearlySnapped.pointerMove({ world: { x: 143.99, y: 50 }, screen: { x: 143.99, y: 50 } });
    nearlySnapped.pointerUp({ world: { x: 143.99, y: 50 }, screen: { x: 143.99, y: 50 } });
    expect(getPage(nearlySnapped.stack.getSnapshot(), 'page_1').nodes.n_a?.x).toBeCloseTo(93.99, 6);
  });

  it('zoom=2 时会话级阈值变 3 世界 px（屏幕 6px 手感）：4 世界 px 的间隙不吸附', () => {
    const a = createRect({ id: 'n_a', x: 0, y: 0, width: 100, height: 100 });
    const b = createRect({ id: 'n_b', x: 200, y: 0, width: 100, height: 100 });
    const page = createPage({ id: 'page_1', rootIds: ['n_a', 'n_b'], nodes: { n_a: a, n_b: b } });
    const session = makeSession(page, { zoom: 2, panX: 0, panY: 0 });
    session.setSelection(['n_a'], 'n_a');
    session.pointerDown({ world: { x: 50, y: 50 }, screen: { x: 100, y: 100 }, button: 'left' });
    session.pointerMove({ world: { x: 146, y: 50 }, screen: { x: 292, y: 100 } }); // 间隙 4 世界 px
    session.pointerUp({ world: { x: 146, y: 50 }, screen: { x: 292, y: 100 } });
    expect(getPage(session.stack.getSnapshot(), 'page_1').nodes.n_a?.x).toBe(96);
  });

  it('吸附关闭时完全不吸附（会话开关生效）', () => {
    const a = createRect({ id: 'n_a', x: 0, y: 0, width: 100, height: 100 });
    const b = createRect({ id: 'n_b', x: 200, y: 0, width: 100, height: 100 });
    const page = createPage({ id: 'page_1', rootIds: ['n_a', 'n_b'], nodes: { n_a: a, n_b: b } });
    const doc = createDocument({ id: 'doc_1', pages: [page] });
    const session = createCanvasSession({
      document: doc,
      pageId: 'page_1',
      viewport: { zoom: 1, panX: 0, panY: 0 },
      snapEnabled: false,
    });
    session.setSelection(['n_a'], 'n_a');
    session.pointerDown({ world: { x: 50, y: 50 }, screen: { x: 50, y: 50 }, button: 'left' });
    session.pointerMove({ world: { x: 144, y: 50 }, screen: { x: 144, y: 50 } });
    session.pointerUp({ world: { x: 144, y: 50 }, screen: { x: 144, y: 50 } });
    expect(getPage(session.stack.getSnapshot(), 'page_1').nodes.n_a?.x).toBe(94);
  });
});

/** 便捷：视口 → 屏幕锚点对应的世界点。 */
function screenToWorldOf(
  viewport: { zoom: number; panX: number; panY: number },
  screen: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: (screen.x - viewport.panX) / viewport.zoom,
    y: (screen.y - viewport.panY) / viewport.zoom,
  };
}
