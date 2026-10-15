/**
 * 批量修改（C6「批量修改作用于全选」+ 自动布局读写）规格。
 *
 * 口径：一次修改 = **一个事务**（撤销粒度 = 一次修改）；补丁逐节点从该节点现状推导
 * （保留各节点其余属性）；不适用节点跳过，不产生空命令。
 */

import {
  CommandStack,
  createDocument,
  createFrame,
  createPage,
  createRect,
  createText,
  type DesignDocument,
  defaultTextContent,
  type NodeId,
  solidPaint,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import {
  applyAutoLayoutCommands,
  setBlendModeCommands,
  setFillColorCommands,
  setNumberCommands,
  setStrokeCommands,
  setTextCommands,
} from './patches';

/** 夹具：两个矩形（填充透明度不同）+ 一个文本 + 空画板 + 含两子项的画板。 */
function fixture(): DesignDocument {
  const r1 = createRect({
    id: 'r1',
    x: 10,
    y: 10,
    width: 100,
    height: 50,
    fills: [solidPaint('#111111', 0.5)],
  });
  const r2 = createRect({
    id: 'r2',
    x: 60,
    y: 10,
    width: 100,
    height: 50,
    fills: [solidPaint('#222222', 1)],
  });
  const t1 = createText({ id: 't1', text: { ...defaultTextContent('设界'), fontSize: 14 } });
  const emptyFrame = createFrame({ id: 'f0', width: 300, height: 200 });
  const c1 = createRect({ id: 'c1', x: 0, y: 0, width: 40, height: 20 });
  const c2 = createRect({ id: 'c2', x: 0, y: 40, width: 40, height: 20 });
  const frame = createFrame({ id: 'f1', width: 300, height: 200, children: ['c1', 'c2'] });
  const page = createPage({
    id: 'p1',
    nodes: { r1, r2, t1, f0: emptyFrame, f1: frame, c1, c2 },
    rootIds: ['r1', 'r2', 't1', 'f0', 'f1'],
  });
  return createDocument({ id: 'd1', pages: [page] });
}

/** 取页面（断言用）。 */
function pageOf(stack: CommandStack) {
  const page = stack.document.pages[0];
  if (page === undefined) throw new Error('夹具缺失');
  return page;
}

describe('setNumberCommands（批量数值修改）', () => {
  it('一次事务改全部选中节点的该属性（撤销一次全部还原）', () => {
    const stack = new CommandStack(fixture());
    const page = pageOf(stack);
    const commands = setNumberCommands(page, 'p1', ['r1', 'r2'], 'x', 25);

    stack.dispatch(commands, { label: '位置' });
    expect(pageOf(stack).nodes.r1?.x).toBe(25);
    expect(pageOf(stack).nodes.r2?.x).toBe(25);

    expect(stack.undo()).toBe(true);
    expect(pageOf(stack).nodes.r1?.x).toBe(10);
    expect(pageOf(stack).nodes.r2?.x).toBe(60);
  });

  it('不存在的节点被跳过（不产生空命令）', () => {
    const page = pageOf(new CommandStack(fixture()));
    expect(setNumberCommands(page, 'p1', [], 'x', 1)).toEqual([]);
    expect(setNumberCommands(page, 'p1', ['nope' as NodeId], 'x', 1)).toEqual([]);
  });
});

describe('setFillColorCommands / setStrokeCommands（外观）', () => {
  it('改填充色但保留各节点自身的不透明度', () => {
    const stack = new CommandStack(fixture());
    stack.dispatch(setFillColorCommands(pageOf(stack), 'p1', ['r1', 'r2'], '#00FF00'), {
      label: '填充',
    });
    const fill1 = pageOf(stack).nodes.r1?.fills[0];
    const fill2 = pageOf(stack).nodes.r2?.fills[0];
    expect(fill1).toMatchObject({ color: '#00FF00', opacity: 0.5 });
    expect(fill2).toMatchObject({ color: '#00FF00', opacity: 1 });
  });

  it('无描边的节点获得新描边（默认宽 1）；已有描边保留其宽度', () => {
    const stack = new CommandStack(fixture());
    stack.dispatch(
      {
        type: 'node.update',
        pageId: 'p1',
        nodeId: 'r2',
        patch: { strokes: [{ paint: solidPaint('#000000'), width: 3, align: 'inside' }] },
      },
      { label: '描边' },
    );
    stack.dispatch(setStrokeCommands(pageOf(stack), 'p1', ['r1', 'r2'], { color: '#FF0000' }), {
      label: '描边色',
    });
    const s1 = pageOf(stack).nodes.r1?.strokes[0];
    const s2 = pageOf(stack).nodes.r2?.strokes[0];
    expect(s1).toMatchObject({ width: 1, paint: { color: '#FF0000' } });
    expect(s2).toMatchObject({ width: 3, paint: { color: '#FF0000' } });
  });
});

describe('setTextCommands（文字分区）', () => {
  it('批量修改字号只作用于文本节点（矩形不受影响）', () => {
    const stack = new CommandStack(fixture());
    stack.dispatch(setTextCommands(pageOf(stack), 'p1', ['r1', 't1'], { fontSize: 20 }), {
      label: '字号',
    });
    const textNode = pageOf(stack).nodes.t1;
    expect(textNode?.type === 'text' ? textNode.text.fontSize : null).toBe(20);
    expect(pageOf(stack).nodes.r1?.width).toBe(100);
  });

  it('仅含非文本节点时不产生命令', () => {
    const page = pageOf(new CommandStack(fixture()));
    expect(setTextCommands(page, 'p1', ['r1', 'r2'], { fontSize: 20 })).toEqual([]);
  });
});

describe('setBlendModeCommands（高级分区）', () => {
  it('批量写混合模式可撤销', () => {
    const stack = new CommandStack(fixture());
    stack.dispatch(setBlendModeCommands(pageOf(stack), 'p1', ['r1', 't1'], 'multiply'), {
      label: '混合模式',
    });
    expect(pageOf(stack).nodes.r1?.blendMode).toBe('multiply');
    expect(pageOf(stack).nodes.t1?.blendMode).toBe('multiply');
    stack.undo();
    expect(pageOf(stack).nodes.r1?.blendMode).toBe('normal');
  });
});

describe('applyAutoLayoutCommands（布局分区 · 自动布局）', () => {
  it('开启自动布局：子项按配置重排 + 容器尺寸更新（一条历史）', () => {
    const stack = new CommandStack(fixture());
    stack.dispatch(applyAutoLayoutCommands(stack.document, 'p1', 'f1', {}), { label: '自动布局' });

    const page = pageOf(stack);
    const frame = page.nodes.f1;
    if (frame?.type !== 'frame') throw new Error('夹具缺失');
    expect(frame.autoLayout).toMatchObject({ direction: 'vertical' });
    // 默认内边距 10：首子项落在 (10,10)
    expect(page.nodes.c1).toMatchObject({ x: 10, y: 10 });
    // 间距 10：第二子项紧接首子项
    expect(page.nodes.c2?.y).toBe(10 + 20 + 10);

    expect(stack.undo()).toBe(true);
    const restored = pageOf(stack).nodes.f1;
    if (restored?.type !== 'frame') throw new Error('夹具缺失');
    expect(restored.autoLayout).toBeNull();
    expect(pageOf(stack).nodes.c2?.y).toBe(40);
  });

  it('改间距：子项位置随之更新', () => {
    const stack = new CommandStack(fixture());
    stack.dispatch(applyAutoLayoutCommands(stack.document, 'p1', 'f1', {}), { label: '自动布局' });
    stack.dispatch(applyAutoLayoutCommands(stack.document, 'p1', 'f1', { spacing: 30 }), {
      label: '间距',
    });
    expect(pageOf(stack).nodes.c2?.y).toBe(10 + 20 + 30);
  });

  it('关闭自动布局：配置清空、子项位置保留', () => {
    const stack = new CommandStack(fixture());
    stack.dispatch(applyAutoLayoutCommands(stack.document, 'p1', 'f1', {}), { label: '自动布局' });
    const before = pageOf(stack).nodes.c1?.y;
    stack.dispatch(applyAutoLayoutCommands(stack.document, 'p1', 'f1', null), {
      label: '关闭自动布局',
    });
    const frame = pageOf(stack).nodes.f1;
    if (frame?.type !== 'frame') throw new Error('夹具缺失');
    expect(frame.autoLayout).toBeNull();
    expect(pageOf(stack).nodes.c1?.y).toBe(before);
  });

  it('非画板节点被跳过', () => {
    const stack = new CommandStack(fixture());
    expect(applyAutoLayoutCommands(stack.document, 'p1', 'r1', {})).toEqual([]);
  });
});
