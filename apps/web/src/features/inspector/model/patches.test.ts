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
  dropShadow,
  type NodeId,
  solidPaint,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import {
  addEffectCommands,
  applyAutoLayoutCommands,
  defaultEffect,
  removeEffectCommands,
  setBlendModeCommands,
  setFillColorCommands,
  setNumberCommands,
  setStrokeCommands,
  setTextCommands,
  updateEffectCommands,
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

describe('effects 命令族（效果分区 · RW-10）', () => {
  it('defaultEffect：三种类型都给出可见的完整参数（文档数据色非界面令牌）', () => {
    for (const type of ['drop_shadow', 'inner_shadow', 'layer_blur'] as const) {
      const effect = defaultEffect(type);
      expect(effect.type).toBe(type);
      expect(effect.visible).toBe(true);
      expect(effect.blur).toBeGreaterThan(0);
    }
  });

  it('addEffectCommands：批量追加，保留各节点已有效果；撤销一步全还原', () => {
    const stack = new CommandStack(fixture());
    // r1 预置一个投影（追加不得覆盖）
    stack.dispatch(
      {
        type: 'node.update',
        pageId: 'p1',
        nodeId: 'r1',
        patch: { effects: [dropShadow('#000000', 0, 4, 10)] },
      },
      { label: '预置效果' },
    );
    const effect = defaultEffect('layer_blur');
    stack.dispatch(addEffectCommands(pageOf(stack), 'p1', ['r1', 'r2'], effect), {
      label: '添加效果',
    });

    const effects1 = pageOf(stack).nodes.r1?.effects ?? [];
    const effects2 = pageOf(stack).nodes.r2?.effects ?? [];
    expect(effects1).toHaveLength(2);
    expect(effects1[0]).toMatchObject({ type: 'drop_shadow' });
    expect(effects1[1]).toMatchObject({ type: 'layer_blur' });
    expect(effects2).toHaveLength(1);
    expect(effects2[0]).toMatchObject({ type: 'layer_blur' });

    expect(stack.undo()).toBe(true);
    expect(pageOf(stack).nodes.r1?.effects).toHaveLength(1);
    expect(pageOf(stack).nodes.r2?.effects).toHaveLength(0);
  });

  it('removeEffectCommands：按序号移除；越界节点跳过（全部越界则无命令）', () => {
    const stack = new CommandStack(fixture());
    stack.dispatch(
      {
        type: 'node.update',
        pageId: 'p1',
        nodeId: 'r1',
        patch: { effects: [dropShadow('#000000', 0, 4, 10), defaultEffect('layer_blur')] },
      },
      { label: '预置效果' },
    );
    stack.dispatch(
      {
        type: 'node.update',
        pageId: 'p1',
        nodeId: 'r2',
        patch: { effects: [defaultEffect('layer_blur')] },
      },
      { label: '预置效果' },
    );

    // 移除序号 1：r1 丢层模糊、r2 越界跳过
    stack.dispatch(removeEffectCommands(pageOf(stack), 'p1', ['r1', 'r2'], 1), {
      label: '移除效果',
    });
    expect(pageOf(stack).nodes.r1?.effects).toHaveLength(1);
    expect(pageOf(stack).nodes.r1?.effects[0]).toMatchObject({ type: 'drop_shadow' });
    expect(pageOf(stack).nodes.r2?.effects).toHaveLength(1);

    // 全部越界：不产生空命令
    expect(removeEffectCommands(pageOf(stack), 'p1', ['r1', 'r2'], 9)).toEqual([]);
  });

  it('updateEffectCommands：按序号合并参数补丁；无变化/越界不出命令', () => {
    const stack = new CommandStack(fixture());
    stack.dispatch(
      {
        type: 'node.update',
        pageId: 'p1',
        nodeId: 'r1',
        patch: { effects: [dropShadow('#000000', 0, 4, 10)] },
      },
      { label: '预置效果' },
    );
    stack.dispatch(
      updateEffectCommands(pageOf(stack), 'p1', ['r1'], 0, { blur: 24, color: '#3300FF' }),
      { label: '效果参数' },
    );

    const effect = pageOf(stack).nodes.r1?.effects[0];
    expect(effect).toMatchObject({
      type: 'drop_shadow',
      blur: 24,
      color: '#3300FF',
      offsetX: 0, // 未涉及的参数保留
      offsetY: 4,
    });

    // 值无变化 → 不产生空命令；越界序号同样为空
    const page = pageOf(stack);
    expect(updateEffectCommands(page, 'p1', ['r1'], 0, { blur: 24 })).toEqual([]);
    expect(updateEffectCommands(page, 'p1', ['r1'], 3, { blur: 1 })).toEqual([]);
  });

  it('批量改效果参数：一次事务作用全选（撤销一次全还原）', () => {
    const stack = new CommandStack(fixture());
    // 预置两个节点各一个投影（一条事务：1 条历史）
    stack.dispatch(
      [
        {
          type: 'node.update',
          pageId: 'p1',
          nodeId: 'r1',
          patch: { effects: [dropShadow('#000000', 0, 4, 10)] },
        },
        {
          type: 'node.update',
          pageId: 'p1',
          nodeId: 'r2',
          patch: { effects: [dropShadow('#000000', 0, 4, 10)] },
        },
      ],
      { label: '预置效果' },
    );

    stack.dispatch(updateEffectCommands(pageOf(stack), 'p1', ['r1', 'r2'], 0, { offsetY: 8 }), {
      label: '效果参数',
    });
    expect(pageOf(stack).nodes.r1?.effects[0]).toMatchObject({ offsetY: 8 });
    expect(pageOf(stack).nodes.r2?.effects[0]).toMatchObject({ offsetY: 8 });
    expect(stack.history().undo).toHaveLength(2); // 预置 1 条 + 批量 1 条

    expect(stack.undo()).toBe(true);
    expect(pageOf(stack).nodes.r1?.effects[0]).toMatchObject({ offsetY: 4 });
    expect(pageOf(stack).nodes.r2?.effects[0]).toMatchObject({ offsetY: 4 });
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
