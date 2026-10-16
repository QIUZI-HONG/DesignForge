/**
 * [独立验证 · engine] 吸附阈值边界、参考线/测量语义、网格与节点吸附冲突。
 *
 * 口径钉子（实现文档已声明）：阈值 6 **屏幕**像素、闭区间（≤6 吸附）；
 * 网格吸附在 `applySnapToMove` 中**逐轴优先**：命中的轴由网格定值，未命中的轴回落节点吸附
 * （两轴分别求解；B4 修后不再「单轴命中即整体早退」）。
 */

import { describe, expect, it } from 'vitest';

import { applySnapToMove, type InteractionContext } from '../interaction/reducer';
import { createDocument, createPage, createRect, type ScenePage } from '../model/index';
import { getPage, insertNode } from '../scene/index';
import {
  computeMeasurements,
  computeSnap,
  NO_SNAP,
  SNAP_THRESHOLD_PX,
  snapRectToGrid,
  snapThresholdWorld,
  snapValueToGrid,
} from '../snap/snap';

const moving = { x: 100, y: 100, width: 50, height: 50 };

describe('[verify] 吸附 · 阈值 5.99 / 6.00 / 6.01 边界', () => {
  it('世界阈值 6：5.99 吸、6.00 吸（闭区间）、6.01 不吸', () => {
    // 移动体右边缘 = 150；目标左边缘 = 150 + gap
    const targetsFor = (gap: number) => [
      { id: 't', bounds: { x: 150 + gap, y: 1100, width: 50, height: 50 } },
    ];
    expect(computeSnap(moving, targetsFor(5.99)).dx).toBeCloseTo(5.99, 9);
    expect(computeSnap(moving, targetsFor(6)).dx).toBe(6);
    expect(computeSnap(moving, targetsFor(6.01))).toEqual({ ...NO_SNAP });
    // 负方向同样对称
    const leftTarget = [{ id: 'l', bounds: { x: 44, y: 1100, width: 50, height: 50 } }];
    // 目标右边缘 94 vs 移动体左边缘 100 → delta -6
    expect(computeSnap(moving, leftTarget).dx).toBe(-6);
  });

  it('阈值随缩放换算为屏幕像素：6/zoom，非法 zoom 回退 6', () => {
    expect(snapThresholdWorld(1)).toBe(6);
    expect(snapThresholdWorld(0.5)).toBe(12);
    expect(snapThresholdWorld(2)).toBe(3);
    expect(snapThresholdWorld(0)).toBe(SNAP_THRESHOLD_PX);
    expect(snapThresholdWorld(Number.NaN)).toBe(SNAP_THRESHOLD_PX);
    // Infinity 也被 isFinite 守卫拦下 → 回退默认（不是 6/Infinity = 0）
    expect(snapThresholdWorld(Number.POSITIVE_INFINITY)).toBe(SNAP_THRESHOLD_PX);
  });

  it('threshold <= 0 或目标为空时不吸附，且不产出参考线', () => {
    const targets = [{ id: 't', bounds: { x: 151, y: 100, width: 50, height: 50 } }];
    expect(computeSnap(moving, targets, { threshold: 0 })).toEqual({ ...NO_SNAP });
    expect(computeSnap(moving, [], { threshold: 6 })).toEqual({ ...NO_SNAP });
  });

  it('阈值只吃最近的一档：多个候选时取 |delta| 最小者', () => {
    const targets = [
      { id: 'near', bounds: { x: 151, y: 1100, width: 50, height: 50 } },
      { id: 'far', bounds: { x: 154, y: 1100, width: 50, height: 50 } },
    ];
    const result = computeSnap(moving, targets);
    expect(result.dx).toBe(1);
    expect(result.guides[0]?.refs).toEqual(['near']);
  });
});

describe('[verify] 吸附 · 参考线与测量语义', () => {
  it('参考线：position = 对齐到的目标坐标，kind 反映移动体候选（edge/center），refs 指向目标', () => {
    // 边对齐（移动体右边缘 150 → 目标左边缘 156）
    const edge = computeSnap(moving, [
      { id: 't1', bounds: { x: 156, y: 1100, width: 50, height: 50 } },
    ]);
    expect(edge.dx).toBe(6);
    expect(edge.guides).toHaveLength(1);
    expect(edge.guides[0]).toMatchObject({ axis: 'x', position: 156, kind: 'edge', refs: ['t1'] });
    // 参考线跨度覆盖移动体与参考对象（y 轴方向）
    expect(edge.guides[0]?.from).toBeLessThanOrEqual(100);
    expect(edge.guides[0]?.to).toBeGreaterThanOrEqual(1150);

    // 中心对齐（唯一最近档）：目标 x=81、w=100 → 中心 131；移动体中心 125 → delta +6
    const center = computeSnap(moving, [
      { id: 't2', bounds: { x: 81, y: 1100, width: 100, height: 50 } },
    ]);
    expect(center.dx).toBe(6);
    expect(center.guides[0]).toMatchObject({
      axis: 'x',
      position: 131,
      kind: 'center',
      refs: ['t2'],
    });
  });

  it('同等距离时取先遇到的候选（边对齐优先于中心对齐，取决于遍历顺序）', () => {
    // 移动体 100..150（中心 125）；目标 x=106、w=50（左 106 / 中心 131）→ 两个候选 delta 都是 +6
    const tied = computeSnap(moving, [
      { id: 'tie', bounds: { x: 106, y: 1100, width: 50, height: 50 } },
    ]);
    expect(tied.dx).toBe(6);
    // 实际实现返回先遍历到的「移动体左边 ↔ 目标左边」，而不是中心对齐
    expect(tied.guides[0]).toMatchObject({ kind: 'edge', position: 106 });
  });

  it('测量数据：左右/上下最近一个参考对象的间隙，超出 maxDistance(1000) 不给', () => {
    const targets = [
      { id: 'right', bounds: { x: 170, y: 100, width: 50, height: 50 } },
      { id: 'left', bounds: { x: 40, y: 100, width: 50, height: 50 } },
    ];
    const measurements = computeMeasurements(moving, targets);
    const byAxis = measurements.map((m) => `${m.axis}:${m.value}:${m.refs[0]}`);
    // 左间隙 10（100 - 90）、右间隙 20（170 - 150）；顺序：左 → 右
    expect(byAxis).toEqual(['x:10:left', 'x:20:right']);
    // 移动体与目标无重叠轴 → 不给该方向测量
    const disjoint = computeMeasurements(moving, [
      { id: 'diag', bounds: { x: 500, y: 500, width: 10, height: 10 } },
    ]);
    expect(disjoint).toEqual([]);
  });

  it('吸附发生时才附带测量（无位移 → 无测量）', () => {
    const noSnap = computeSnap(moving, [
      { id: 'far', bounds: { x: 9000, y: 9000, width: 10, height: 10 } },
    ]);
    expect(noSnap.measurements).toEqual([]);
    const snapped = computeSnap(moving, [
      { id: 't', bounds: { x: 156, y: 100, width: 50, height: 50 } },
    ]);
    expect(snapped.dx).toBe(6);
    expect(snapped.measurements.length).toBeGreaterThan(0);
  });
});

/** 两矩形页面：a(100,100,50,50)、b(156,100,50,50) —— 水平间隙恰为 6px。 */
function pageWithTwoRects(): { page: ScenePage; pageId: string } {
  let doc = createDocument({ id: 'd', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(doc, 'p1', createRect({ id: 'a', x: 100, y: 100, width: 50, height: 50 }), null);
  doc = insertNode(doc, 'p1', createRect({ id: 'b', x: 156, y: 100, width: 50, height: 50 }), null);
  return { page: getPage(doc, 'p1'), pageId: 'p1' };
}

describe('[verify] 吸附 · 网格与节点吸附冲突', () => {
  const baseContext = (over: Partial<InteractionContext>): InteractionContext => {
    const { page, pageId } = pageWithTwoRects();
    return { page, pageId, zoom: 1, ...over };
  };

  it('网格命中轴由网格定值，未命中轴照常回落节点吸附（两轴分别求解）', () => {
    // 网格 40：a 目标位置 x=118（拖 18px）——x 轴网格最近线 120（delta +2，≤6）→ 命中；
    // y 轴 100 距最近网格线 120 为 20 > 6 → 不命中，回落节点吸附
    const context = baseContext({ grid: { size: 40, snapToGrid: true } });
    const gridOnly = applySnapToMove(context, ['a'], { x: 18, y: 0 });
    expect(gridOnly.delta).toEqual({ x: 20, y: 0 }); // 118 → 120（x 轴由网格定值）
    // y 轴与 b 同顶（y=100，delta 0）仍产出参考线：修前此处整体早退、参考线被吃掉
    expect(gridOnly.snap.guides).toEqual([
      { axis: 'y', position: 100, from: 120, to: 206, refs: ['b'], kind: 'edge' },
    ]);
    expect(gridOnly.snap.measurements).toEqual([]); // 与 b 无间隙，测量为空
    // 两轴都不命中网格时全部回落节点吸附
    const gridOverNode = applySnapToMove(context, ['a'], { x: 238, y: 0 });
    // 338 → 最近网格线 320（delta -18 超阈值）；y=100 距 120 为 20 → 也超 → 回落节点吸附
    expect(gridOverNode.snap.guides.length).toBeGreaterThan(0);
  });

  it('网格不命中时回落到节点吸附（含参考线）', () => {
    // 目标位置 (106,128)：网格 40 的两轴 delta 均超阈值（x 距 120 为 14；y 距 120 为 8）
    // 节点吸附：x 右边缘 156 与 b 左边缘 156 精确对齐（delta 0）；
    //          y 中心 153 与 b 中心 125 差 -28…… 但 y 顶边 128 与 b 中心 125 差 -3 → dy = -3
    const context = baseContext({ grid: { size: 40, snapToGrid: true } });
    const result = applySnapToMove(context, ['a'], { x: 6, y: 28 });
    expect(result.delta).toEqual({ x: 6, y: 25 }); // y 被节点吸附拉回 3px
    expect(result.snap.guides).toHaveLength(2); // x（边对齐）+ y（中心对齐）
    expect(result.snap.guides.map((g) => g.refs[0])).toEqual(['b', 'b']);
  });

  it('网格开关关闭时不参与：交给节点吸附', () => {
    const context = baseContext({ grid: { size: 40, snapToGrid: false } });
    const result = applySnapToMove(context, ['a'], { x: 2, y: 0 });
    expect(result.delta.x).toBe(6); // 152 + 4 → 156（右边缘贴 b 左边缘）
    // x 有 +4 的边对齐、y 因两矩形同高同顶（delta 0）也产出一条参考线
    expect(result.snap.guides).toHaveLength(2);
    expect(result.snap.guides.map((g) => g.axis)).toEqual(['x', 'y']);
  });

  it('网格吸附的阈值同样是屏幕像素（zoom=0.5 时世界阈值 12）', () => {
    const context = baseContext({ zoom: 0.5, grid: { size: 100, snapToGrid: true } });
    // a 目标 x=112 → 网格最近 100（delta -12 → 世界阈值 12，闭区间命中）
    const result = applySnapToMove(context, ['a'], { x: 12, y: 0 });
    expect(result.delta).toEqual({ x: 0, y: 0 });
    // zoom=1 时世界阈值 6：网格 delta -12 不命中 → 回落节点吸附（162 距 b 左边缘 156 → -6）
    const context1 = baseContext({ zoom: 1, grid: { size: 100, snapToGrid: true } });
    const result1 = applySnapToMove(context1, ['a'], { x: 12, y: 0 });
    expect(result1.delta).toEqual({ x: 6, y: 0 });
    expect(result1.snap.guides.length).toBeGreaterThan(0);
  });

  it('[语义] 单轴命中网格不早退：另一轴的节点对齐与参考线照常求解', () => {
    // b 的顶边在 y=300：把 a 拖到 (118, 297) —— x 轴命中网格（→120），y 轴网格不命中
    // （297 距最近网格线 280 为 17 > 6）→ y 轴回落节点吸附，拉到 b 顶边 300
    let doc = createDocument({ id: 'd', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'a', x: 100, y: 100, width: 50, height: 50 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'b', x: 156, y: 300, width: 50, height: 50 }),
      null,
    );
    const page = getPage(doc, 'p1');

    const withGrid = applySnapToMove(
      { page, pageId: 'p1', zoom: 1, grid: { size: 40, snapToGrid: true } },
      ['a'],
      { x: 18, y: 197 },
    );
    // x 轴 118 → 120（网格 +2）；y 轴 297 → 300（节点对齐 +3，修前停在 197）
    expect(withGrid.delta).toEqual({ x: 20, y: 200 });
    expect(withGrid.snap.guides).toEqual([
      { axis: 'y', position: 300, from: 120, to: 206, refs: ['b'], kind: 'edge' },
    ]);
    expect(withGrid.snap.guides.every((guide) => guide.axis === 'y')).toBe(true); // x 轴由网格定值
    expect(withGrid.snap.measurements).toEqual([]); // 与 b 无间隙，测量为空

    // 同一位置、关掉网格：y 轴同样被对齐到 300（证明丢的是「另一轴」的吸附而非本来就无吸附）
    const withoutGrid = applySnapToMove(
      { page, pageId: 'p1', zoom: 1, grid: { size: 40, snapToGrid: false } },
      ['a'],
      { x: 18, y: 197 },
    );
    expect(withoutGrid.delta.y).toBe(200); // 297 → 300（与 b 顶边对齐）
    expect(withoutGrid.snap.guides.some((guide) => guide.axis === 'y')).toBe(true);
  });

  it('网格命中单轴时另一轴的节点吸附测量不再被吞（B4 回归）', () => {
    // a 拖到 (118, 297)：x 轴命中网格（→120）、y 轴对齐 b 顶边（→300）；
    // c 与 a 吸附后同排且相距 130 → 产出 x 轴距离测量（修前整体早退，测量为空）
    let doc = createDocument({ id: 'd', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'a', x: 100, y: 100, width: 50, height: 50 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'b', x: 156, y: 300, width: 50, height: 50 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'c', x: 300, y: 300, width: 50, height: 50 }),
      null,
    );
    const page = getPage(doc, 'p1');

    const result = applySnapToMove(
      { page, pageId: 'p1', zoom: 1, grid: { size: 40, snapToGrid: true } },
      ['a'],
      { x: 18, y: 197 },
    );
    expect(result.delta).toEqual({ x: 20, y: 200 }); // x 网格 + y 节点对齐，两轴都生效
    expect(result.snap.measurements).toEqual([
      // 吸附后 a 的右边缘 170 到 c 左边缘 300 的水平间隙 130，标注线在 a 垂直中线 325
      { axis: 'x', from: 170, to: 300, value: 130, at: 325, refs: ['c'], kind: 'distance' },
    ]);
  });
});

describe('[verify] 吸附 · 网格数值边界', () => {
  it('snapValueToGrid：闭区间阈值；gridSize/threshold 非法返回 null', () => {
    expect(snapValueToGrid(4, 10, 6)).toEqual({ value: 0, delta: -4 });
    // 6 的最近线是 10（距离 4 ≤ 6）→ 命中
    expect(snapValueToGrid(6, 10, 6)).toEqual({ value: 10, delta: 4 });
    expect(snapValueToGrid(13.99, 10, 6)).toEqual({ value: 10, delta: -3.99 });
    expect(snapValueToGrid(0, 10, 6)).toEqual({ value: 0, delta: 0 });
    expect(snapValueToGrid(7, 20, 6)).toBeNull(); // 距 0 为 7 > 6，距 20 为 13 > 6
    expect(snapValueToGrid(7, 0, 6)).toBeNull();
    expect(snapValueToGrid(7, 10, 0)).toBeNull();
    expect(snapValueToGrid(7, -5, 6)).toBeNull();
  });

  it('当 gridSize ≤ 2×threshold 时任意位置都会吸附（无自由移动区间）', () => {
    expect(snapValueToGrid(5, 10, 6)).not.toBeNull();
    expect(snapValueToGrid(5.5, 10, 6)).not.toBeNull();
    expect(snapValueToGrid(9.9, 10, 6)).not.toBeNull();

    const rect = { x: 103, y: 107, width: 10, height: 10 };
    const grid = snapRectToGrid(rect, 10, 6);
    expect(grid).toEqual({ dx: -3, dy: 3 });
  });
});

describe('[verify] 吸附 · 目标收集（拖动场景）', () => {
  it('拖动节点自身与其子树被排除，父容器与兄弟被纳入', () => {
    const { page } = pageWithTwoRects();
    // 直接调用 reducer 的吸附入口：拖 a（顶层）时参考对象应含 b（同层兄弟）
    const context: InteractionContext = { page, pageId: 'p1', zoom: 1 };
    const result = applySnapToMove(context, ['a'], { x: 1, y: 0 });
    expect(result.snap.guides[0]?.refs).toEqual(['b']);
  });

  it('隐藏节点默认不作为吸附参考', () => {
    let doc = createDocument({ id: 'd', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'a', x: 100, y: 100, width: 50, height: 50 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'hidden', x: 156, y: 100, width: 50, height: 50, visible: false }),
      null,
    );
    const page = getPage(doc, 'p1');
    const result = applySnapToMove({ page, pageId: 'p1', zoom: 1 }, ['a'], { x: 2, y: 0 });
    expect(result.snap).toEqual({ ...NO_SNAP });
  });
});
