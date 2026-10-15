import { describe, expect, it } from 'vitest';

import {
  createDocument,
  createFrame,
  createPage,
  createRect,
  type ScenePage,
} from '../model/index';
import { getPage, insertNode, insertNodes } from '../scene/index';
import {
  computeMeasurements,
  computeSnap,
  SNAP_THRESHOLD_PX,
  type SnapTarget,
  snapPointToGrid,
  snapRectToGrid,
  snapTargetsFromPage,
  snapThresholdWorld,
  snapValueToGrid,
} from './index';

const target = (id: string, x: number, y: number, width = 100, height = 100): SnapTarget => ({
  id,
  bounds: { x, y, width, height },
});

describe('snap · 阈值语义（C8：吸附阈值 6px）', () => {
  it('屏幕阈值 6px，世界阈值随缩放换算', () => {
    expect(SNAP_THRESHOLD_PX).toBe(6);
    expect(snapThresholdWorld(1)).toBe(6);
    expect(snapThresholdWorld(0.5)).toBe(12); // 缩小画布 → 世界空间容忍更大
    expect(snapThresholdWorld(2)).toBe(3);
    expect(snapThresholdWorld(0)).toBe(6); // 非法缩放回落到屏幕阈值
  });

  it('边界：5.9px 吸、6.0px 吸（闭区间）、6.1px 不吸', () => {
    const other = target('t', 105.9, 0);
    // 移动体左边缘 100 → 与目标左边缘 105.9 相差 5.9
    expect(computeSnap({ x: 100, y: 0, width: 50, height: 50 }, [other]).dx).toBeCloseTo(5.9);
    const six = target('t', 106, 0);
    expect(computeSnap({ x: 100, y: 0, width: 50, height: 50 }, [six]).dx).toBeCloseTo(6);
    const beyond = target('t', 106.1, 0);
    expect(computeSnap({ x: 100, y: 0, width: 50, height: 50 }, [beyond]).dx).toBe(0);
  });

  it('阈值可显式给定（画布缩放后的世界阈值）', () => {
    const other = target('t', 112, 0);
    expect(computeSnap({ x: 100, y: 0, width: 50, height: 50 }, [other], { threshold: 6 }).dx).toBe(
      0,
    );
    expect(
      computeSnap({ x: 100, y: 0, width: 50, height: 50 }, [other], { threshold: 12 }).dx,
    ).toBe(12);
  });
});

describe('snap · 对齐参考线', () => {
  it('边对齐产出参考线数据（位置/跨度/参与对象）', () => {
    const moving = { x: 100, y: 0, width: 50, height: 50 };
    const other = target('t1', 104, 80, 60, 60);
    const result = computeSnap(moving, [other]);
    expect(result.dx).toBe(4);
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]).toMatchObject({
      axis: 'x',
      position: 104,
      refs: ['t1'],
      kind: 'edge',
    });
    // 跨度覆盖两者
    expect(result.guides[0]?.from).toBe(0);
    expect(result.guides[0]?.to).toBe(140);
  });

  it('中心对齐（center 参考线）', () => {
    const moving = { x: 0, y: 0, width: 100, height: 100 }; // 中心 x = 50
    const other = target('t1', 28, 0, 50, 50); // 中心 x = 53
    const result = computeSnap(moving, [other]);
    expect(result.dx).toBe(3);
    expect(result.guides[0]).toMatchObject({ axis: 'x', kind: 'center', position: 53 });
    // 全部边缘/中心配对的最小间距为 10px（超阈值）→ 不吸附
    expect(computeSnap(moving, [target('t2', 40, 0, 50, 50)]).dx).toBe(0);
  });

  it('两轴独立求解：x 命中 y 未命中', () => {
    const moving = { x: 100, y: 100, width: 50, height: 50 };
    const result = computeSnap(moving, [target('t1', 104, 500, 60, 60)]);
    expect(result.dx).toBe(4);
    expect(result.dy).toBe(0);
    expect(result.guides.map((guide) => guide.axis)).toEqual(['x']);
  });

  it('axes 选项可关闭某一轴', () => {
    const moving = { x: 100, y: 100, width: 50, height: 50 };
    const result = computeSnap(moving, [target('t1', 104, 104, 60, 60)], { axes: 'y' });
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(4);
  });

  it('多目标共享同一位置时参考线合并 refs', () => {
    const moving = { x: 100, y: 0, width: 50, height: 50 };
    const result = computeSnap(moving, [target('t1', 104, 0), target('t2', 104, 300)]);
    expect(result.dx).toBe(4);
    expect(result.guides[0]?.refs).toEqual(['t1', 't2']);
  });

  it('无目标 / 阈值非正 → 不吸附', () => {
    expect(computeSnap({ x: 0, y: 0, width: 10, height: 10 }, []).dx).toBe(0);
    expect(
      computeSnap({ x: 0, y: 0, width: 10, height: 10 }, [target('t', 1, 1)], { threshold: 0 }).dx,
    ).toBe(0);
  });
});

describe('snap · 测量数据（红色标注）', () => {
  it('给出与最近参考对象的间距（每侧一条）', () => {
    const moving = { x: 100, y: 0, width: 50, height: 50 };
    const measurements = computeMeasurements(moving, [
      target('t1', 200, 0, 50, 50),
      target('t2', 20, 0, 50, 50),
    ]);
    const byAxis = measurements.filter((m) => m.axis === 'x');
    expect(byAxis).toHaveLength(2);
    const right = byAxis.find((m) => m.refs[0] === 't1');
    expect(right?.value).toBe(50);
    expect(right?.from).toBe(150);
    expect(right?.to).toBe(200);
    expect(right?.at).toBe(25); // 标注线画在移动体垂直中线
  });

  it('吸附结果带上测量数据', () => {
    const moving = { x: 100, y: 0, width: 50, height: 50 };
    const result = computeSnap(moving, [target('t1', 104, 100, 50, 50)]);
    expect(result.measurements.length).toBeGreaterThan(0);
    expect(result.measurements[0]).toMatchObject({ axis: 'y', value: 50 });
    // 未吸附时不产生测量（避免拖动全程标红）
    const silent = computeSnap(moving, [target('t2', 500, 0)]);
    expect(silent.measurements).toEqual([]);
  });
});

describe('snap · 网格吸附', () => {
  it('值吸附：超出阈值不动', () => {
    expect(snapValueToGrid(13, 10, 6)).toEqual({ value: 10, delta: -3 });
    expect(snapValueToGrid(14, 10, 3)).toBeNull(); // 距网格线 4 > 3
    expect(snapValueToGrid(14, 10, 4)).toEqual({ value: 10, delta: -4 }); // 边界含等号
  });

  it('矩形按左上角吸附，点吸附', () => {
    expect(snapRectToGrid({ x: 12, y: 21, width: 10, height: 10 }, 10, 6)).toEqual({
      dx: -2,
      dy: -1,
    });
    expect(snapPointToGrid({ x: 12, y: 21 }, 10, 6)).toEqual({ x: 10, y: 20 });
    expect(snapPointToGrid({ x: 14, y: 21 }, 10, 3)).toEqual({ x: 14, y: 20 });
  });
});

describe('snap · 从页面收集参考对象', () => {
  function page(): ScenePage {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'f1', x: 0, y: 0, width: 200, height: 200 }),
      null,
    );
    doc = insertNodes(
      doc,
      'p1',
      [
        createRect({ id: 'r1', x: 10, y: 10, width: 50, height: 50 }),
        createRect({ id: 'r2', x: 80, y: 10, width: 50, height: 50 }),
      ],
      'f1',
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 't1', x: 300, y: 0, width: 20, height: 20 }),
      null,
    );
    doc = insertNode(doc, 'p1', createRect({ id: 'hidden', visible: false }), null);
    return getPage(doc, 'p1');
  }

  it('排除移动节点自身，纳入父容器/兄弟/顶层对象，跳过隐藏节点', () => {
    const targets = snapTargetsFromPage(page(), ['r1']);
    const ids = targets.map((t) => t.id);
    expect(ids).not.toContain('r1');
    expect(ids).toContain('r2');
    expect(ids).toContain('f1');
    expect(ids).toContain('t1');
    expect(ids).not.toContain('hidden');
    expect(targets.find((t) => t.id === 'r2')?.bounds).toEqual({
      x: 80,
      y: 10,
      width: 50,
      height: 50,
    });
  });

  it('移动画板时其子节点不作为参考对象', () => {
    const ids = snapTargetsFromPage(page(), ['f1']).map((t) => t.id);
    expect(ids).not.toContain('r1');
    expect(ids).not.toContain('r2');
    expect(ids).toContain('t1');
  });
});
