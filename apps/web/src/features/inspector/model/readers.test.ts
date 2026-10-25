/**
 * 字段读取（C6 混选「—」的数据源）规格。
 *
 * 口径：只统计**适用节点**（如文字分区只统计文本节点、自动布局只看画板）——
 * 全部适用值一致 → 单值；不一致 → `mixed`（界面显示「—」）；无适用节点 → `absent`（分区隐藏）。
 */

import {
  createEllipse,
  createFrame,
  createPage,
  createRect,
  createSelection,
  createText,
  defaultAutoLayout,
  defaultTextContent,
  dropShadow,
  type Effect,
  type ScenePage,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import {
  activeFieldValue,
  readAutoLayoutField,
  readBlendMode,
  readEffects,
  readField,
  readFillColor,
  readFillOpacity,
  readStrokeWidth,
  readTextField,
} from './readers';

/** 夹具：两个矩形（x 不同、宽相同）+ 一个文本 + 一个画板。 */
function fixture(): ScenePage {
  return createPage({
    id: 'p1',
    nodes: {
      r1: createRect({ id: 'r1', x: 10, y: 20, width: 100, height: 50 }),
      r2: createRect({ id: 'r2', x: 40, y: 20, width: 100, height: 50 }),
      t1: createText({
        id: 't1',
        text: { ...defaultTextContent('设界'), fontSize: 16, align: 'center' },
      }),
      f1: createFrame({
        id: 'f1',
        width: 300,
        height: 200,
        autoLayout: defaultAutoLayout('horizontal'),
      }),
      f2: createFrame({ id: 'f2', width: 300, height: 200 }),
      e1: createEllipse({ id: 'e1', cornerRadius: 8 }),
    },
    rootIds: ['r1', 'r2', 't1', 'f1', 'f2', 'e1'],
  });
}

describe('readField（混选判定）', () => {
  it('单选：返回该节点的字段值', () => {
    const page = fixture();
    expect(readField(page, createSelection(['r1']), (node) => node.x)).toEqual({
      kind: 'single',
      value: 10,
    });
  });

  it('多选且值一致：返回单值（不显「—」）', () => {
    const page = fixture();
    expect(readField(page, createSelection(['r1', 'r2']), (node) => node.width)).toEqual({
      kind: 'single',
      value: 100,
    });
  });

  it('多选且值不一致：返回 mixed（C6「—」的数据源）', () => {
    const page = fixture();
    expect(readField(page, createSelection(['r1', 'r2']), (node) => node.x)).toEqual({
      kind: 'mixed',
    });
  });

  it('空选择：absent', () => {
    const page = fixture();
    expect(readField(page, createSelection([]), (node) => node.x)).toEqual({ kind: 'absent' });
  });

  it('无适用节点（读文本字段但选的是矩形）：absent', () => {
    const page = fixture();
    expect(readTextField(page, createSelection(['r1', 'e1']), (text) => text.fontSize)).toEqual({
      kind: 'absent',
    });
  });

  it('部分适用（1 文本 + 1 矩形）：只看适用节点', () => {
    const page = fixture();
    expect(readTextField(page, createSelection(['r1', 't1']), (text) => text.fontSize)).toEqual({
      kind: 'single',
      value: 16,
    });
    expect(readTextField(page, createSelection(['r1', 't1']), (text) => text.align)).toEqual({
      kind: 'single',
      value: 'center',
    });
  });

  it('自动布局字段：只读已启用自动布局的画板；未启用者 absent', () => {
    const page = fixture();
    expect(readAutoLayoutField(page, createSelection(['f1']), (config) => config.spacing)).toEqual({
      kind: 'single',
      value: 10,
    });
    expect(
      readAutoLayoutField(page, createSelection(['f1']), (config) => config.direction),
    ).toEqual({
      kind: 'single',
      value: 'horizontal',
    });
    expect(readAutoLayoutField(page, createSelection(['f2']), (config) => config.spacing)).toEqual({
      kind: 'absent',
    });
  });
});

describe('具体字段读取', () => {
  it('填充色/透明度取第一层纯色填充', () => {
    const page = fixture();
    expect(readFillColor(page, createSelection(['r1']))).toEqual({
      kind: 'single',
      value: '#D9D9D9',
    });
    expect(readFillOpacity(page, createSelection(['r1']))).toEqual({ kind: 'single', value: 1 });
  });

  it('无填充（椭圆默认有填充，改取空填充节点）→ absent', () => {
    const page = fixture();
    const rect = page.nodes.r1;
    if (rect === undefined) throw new Error('夹具缺失');
    const stripped = createPage({
      id: 'p2',
      nodes: { r1: { ...rect, fills: [] } },
      rootIds: ['r1'],
    });
    expect(readFillColor(stripped, createSelection(['r1']))).toEqual({ kind: 'absent' });
  });

  it('描边宽度：无描边 → absent；有描边 → 取第一层', () => {
    const page = fixture();
    expect(readStrokeWidth(page, createSelection(['r1']))).toEqual({ kind: 'absent' });
    const rect = page.nodes.r1;
    if (rect === undefined) throw new Error('夹具缺失');
    const stroked = createPage({
      id: 'p3',
      nodes: {
        r1: {
          ...rect,
          strokes: [
            {
              paint: { type: 'solid', color: '#000000', opacity: 1, visible: true },
              width: 2,
              align: 'inside',
            },
          ],
        },
      },
      rootIds: ['r1'],
    });
    expect(readStrokeWidth(stroked, createSelection(['r1']))).toEqual({ kind: 'single', value: 2 });
  });

  it('混合模式默认 normal（引擎纯增量字段）', () => {
    const page = fixture();
    expect(readBlendMode(page, createSelection(['r1', 'e1']))).toEqual({
      kind: 'single',
      value: 'normal',
    });
  });
});

describe('readEffects（效果分区 · RW-10）', () => {
  const shadowA: Effect = dropShadow('#000000', 0, 4, 10);
  const shadowB: Effect = dropShadow('#000000', 0, 8, 10);

  it('单选：返回该节点的效果列表（含空列表——分区仍可见，给「添加」入口）', () => {
    const page = fixture();
    expect(readEffects(page, createSelection(['r1']))).toEqual({ kind: 'single', value: [] });
  });

  it('多选且效果列表结构一致：single（Effect 数组按结构比较，不看引用）', () => {
    const page = fixture();
    const a = page.nodes.r1;
    const b = page.nodes.r2;
    if (a === undefined || b === undefined) throw new Error('夹具缺失');
    const withEffects = createPage({
      id: 'p2',
      nodes: {
        r1: { ...a, effects: [shadowA] },
        r2: { ...b, effects: [{ ...shadowA } ] }, // 同结构不同引用
      },
      rootIds: ['r1', 'r2'],
    });
    expect(readEffects(withEffects, createSelection(['r1', 'r2']))).toEqual({
      kind: 'single',
      value: [shadowA],
    });
  });

  it('多选且效果不一致（参数或长度不同）：mixed', () => {
    const page = fixture();
    const a = page.nodes.r1;
    const b = page.nodes.r2;
    if (a === undefined || b === undefined) throw new Error('夹具缺失');
    const diverged = createPage({
      id: 'p3',
      nodes: {
        r1: { ...a, effects: [shadowA] },
        r2: { ...b, effects: [shadowB] },
      },
      rootIds: ['r1', 'r2'],
    });
    expect(readEffects(diverged, createSelection(['r1', 'r2']))).toEqual({ kind: 'mixed' });

    const lengthDiverged = createPage({
      id: 'p4',
      nodes: { r1: { ...a, effects: [shadowA] }, r2: { ...b, effects: [] } },
      rootIds: ['r1', 'r2'],
    });
    expect(readEffects(lengthDiverged, createSelection(['r1', 'r2']))).toEqual({ kind: 'mixed' });
  });

  it('空选择：absent', () => {
    const page = fixture();
    expect(readEffects(page, createSelection([]))).toEqual({ kind: 'absent' });
  });
});

describe('activeFieldValue（混选拖拽的起始基准）', () => {
  it('取主选中节点的值', () => {
    const page = fixture();
    const selection = createSelection(['r1', 'r2'], 'r2');
    expect(activeFieldValue(page, selection, (node) => node.x)).toBe(40);
  });

  it('主选中不适用时回落到首个适用节点', () => {
    const page = fixture();
    const selection = createSelection(['r1', 't1'], 'r1');
    const value = activeFieldValue(page, selection, (node) =>
      node.type === 'text' ? node.text.fontSize : undefined,
    );
    expect(value).toBe(16);
  });

  it('无适用节点 → undefined', () => {
    const page = fixture();
    expect(
      activeFieldValue(page, createSelection(['r1']), (node) =>
        node.type === 'text' ? node.text.fontSize : undefined,
      ),
    ).toBeUndefined();
  });
});
