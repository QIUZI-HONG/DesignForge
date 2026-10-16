// @vitest-environment jsdom
/**
 * 对抗性验证 · 风险 3：Inspector 300ms 提交语义（C5）
 *
 * 三条规格（briefs 口径）：
 * 1. 连续输入/拖拽（一次修改）= 只落**一条**命令（撤销粒度 = 一次修改）；
 * 2. Esc 回滚零历史（草稿从未进文档）；
 * 3. 批量修改一次撤销全还原。
 *
 * 对抗手法：fake timers 边界（299/300/301ms）+ 中途 Esc + 中途失焦 + 拖拽中停顿 > 300ms。
 */
import {
  CommandStack,
  createDocument,
  createPage,
  createRect,
  createSelection,
  getPage,
  type SceneNode,
} from '@dforge/engine';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectorPanel } from '@/features/inspector/components/InspectorPanel';
import { NumberField } from '@/features/inspector/components/NumberField';

/** 单节点文档（矩形 x=10）。 */
function makeStack(): CommandStack {
  const rect = createRect({ id: 'n_rect', x: 10, y: 20, width: 100, height: 50 });
  const page = createPage({ id: 'page_1', rootIds: ['n_rect'], nodes: { n_rect: rect } });
  return new CommandStack(createDocument({ id: 'doc_1', pages: [page] }));
}

/** 读节点（断言文档真值用）。 */
function nodeOf(stack: CommandStack, id: string): SceneNode {
  return getPage(stack.getSnapshot(), 'page_1').nodes[id] as SceneNode;
}

describe('NumberField · 300ms 提交（fake timers 对抗）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderField(onCommit: (value: number) => void, value = 10) {
    render(<NumberField label="X" fieldName="x" value={value} onCommit={onCommit} />);
    const input = screen.getByLabelText('X') as HTMLInputElement;
    const handle = screen.getByTestId('numberfield-scrub-x');
    return { input, handle };
  }

  it('连续敲键（每次间隔 < 300ms）只提交一次，且只提交最终值', () => {
    const onCommit = vi.fn();
    const { input } = renderField(onCommit);

    fireEvent.change(input, { target: { value: '1' } });
    act(() => vi.advanceTimersByTime(299));
    fireEvent.change(input, { target: { value: '12' } });
    act(() => vi.advanceTimersByTime(299));
    fireEvent.change(input, { target: { value: '123' } });
    expect(onCommit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(123);
  });

  it('299ms 边界不提交，300ms 才提交（计时口径钉死）', () => {
    const onCommit = vi.fn();
    const { input } = renderField(onCommit);
    fireEvent.change(input, { target: { value: '77' } });
    act(() => vi.advanceTimersByTime(299));
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('Esc 取消：零提交、零历史；随后的 blur 也不得提交（取消不能变提交）', () => {
    const onCommit = vi.fn();
    const { input } = renderField(onCommit);
    fireEvent.change(input, { target: { value: '999' } });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    act(() => vi.advanceTimersByTime(5000));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('中途失焦立刻提交一次，且不再有第二次（计时器被清）', () => {
    const onCommit = vi.fn();
    const { input } = renderField(onCommit);
    fireEvent.change(input, { target: { value: '42' } });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5000));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('Enter 立即提交（不用等 300ms）', () => {
    const onCommit = vi.fn();
    const { input } = renderField(onCommit);
    fireEvent.change(input, { target: { value: '8' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('拖拽 scrub：连续位移只提交一次；中途停顿超过 300ms 也不提交（由松手收口）', () => {
    const onCommit = vi.fn();
    const { handle } = renderField(onCommit);
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 110, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 120, pointerId: 1 });
    act(() => vi.advanceTimersByTime(900)); // 拖拽中停顿：不得被 trailing debounce 截断
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerMove(handle, { clientX: 130, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(40); // 起点 10 + 位移 30（step 1）
  });

  it('拖拽中途 Esc：丢弃草稿，之后松手不得提交', () => {
    const onCommit = vi.fn();
    const { input, handle } = renderField(onCommit);
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    act(() => vi.advanceTimersByTime(5000));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('空串/非法值不产生提交（避免空历史）', () => {
    const onCommit = vi.fn();
    const { input } = renderField(onCommit);
    fireEvent.change(input, { target: { value: '' } });
    act(() => vi.advanceTimersByTime(300));
    fireEvent.change(input, { target: { value: 'abc' } });
    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('InspectorPanel · 300ms 提交接到命令栈（集成）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('一次修改 = 一条历史；每次输入都重置计时（连打 3 次仍 1 条）', () => {
    const stack = makeStack();
    render(
      <InspectorPanel
        stack={stack}
        pageId="page_1"
        selection={createSelection(['n_rect'], 'n_rect')}
      />,
    );
    const input = screen.getByLabelText('X');
    fireEvent.change(input, { target: { value: '1' } });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.change(input, { target: { value: '2' } });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.change(input, { target: { value: '3' } });
    act(() => vi.advanceTimersByTime(300));

    expect(stack.history().undo).toHaveLength(1);
    expect(nodeOf(stack, 'n_rect').x).toBe(3);
  });

  it('中途 Esc：历史零增长且文档不变', () => {
    const stack = makeStack();
    render(
      <InspectorPanel
        stack={stack}
        pageId="page_1"
        selection={createSelection(['n_rect'], 'n_rect')}
      />,
    );
    const input = screen.getByLabelText('X');
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(5000));
    expect(stack.history().undo).toHaveLength(0);
    expect(nodeOf(stack, 'n_rect').x).toBe(10);
  });

  it('中间停顿被 300ms 截断时的真实历史条数（记录现状，供口径对齐）', () => {
    const stack = makeStack();
    render(
      <InspectorPanel
        stack={stack}
        pageId="page_1"
        selection={createSelection(['n_rect'], 'n_rect')}
      />,
    );
    const input = screen.getByLabelText('X');
    fireEvent.change(input, { target: { value: '11' } });
    act(() => vi.advanceTimersByTime(400)); // 停顿 > 300ms → 第一次提交发生
    fireEvent.change(input, { target: { value: '22' } });
    act(() => vi.advanceTimersByTime(400));
    // 停下来再改 = 两次修改 = 两条历史（不是缺陷，是语义）
    expect(stack.history().undo).toHaveLength(2);
    stack.undo();
    expect(nodeOf(stack, 'n_rect').x).toBe(11);
    stack.undo();
    expect(nodeOf(stack, 'n_rect').x).toBe(10);
  });

  it('混选批量修改：一次撤销全还原（两个节点同时回退）', () => {
    const rectA = createRect({ id: 'n_a', x: 0, y: 0, width: 10, height: 10 });
    const rectB = createRect({ id: 'n_b', x: 100, y: 0, width: 10, height: 10 });
    const page = createPage({
      id: 'page_1',
      rootIds: ['n_a', 'n_b'],
      nodes: { n_a: rectA, n_b: rectB },
    });
    const stack = new CommandStack(createDocument({ id: 'doc_1', pages: [page] }));

    render(
      <InspectorPanel stack={stack} pageId="page_1" selection={createSelection(['n_a', 'n_b'])} />,
    );
    const input = screen.getByLabelText('X');
    fireEvent.change(input, { target: { value: '55' } });
    act(() => vi.advanceTimersByTime(300));

    expect(nodeOf(stack, 'n_a').x).toBe(55);
    expect(nodeOf(stack, 'n_b').x).toBe(55);
    expect(stack.history().undo).toHaveLength(1);

    stack.undo();
    expect(nodeOf(stack, 'n_a').x).toBe(0);
    expect(nodeOf(stack, 'n_b').x).toBe(100);
    // 一次撤销后重做回到批量值（往返恒等）
    stack.redo();
    expect(nodeOf(stack, 'n_a').x).toBe(55);
    expect(nodeOf(stack, 'n_b').x).toBe(55);
  });

  it('混选态（值不同）显示占位且提交作用于全选', () => {
    const rectA = createRect({ id: 'n_a', x: 0, y: 0, width: 10, height: 10 });
    const rectB = createRect({ id: 'n_b', x: 100, y: 0, width: 10, height: 10 });
    const page = createPage({
      id: 'page_1',
      rootIds: ['n_a', 'n_b'],
      nodes: { n_a: rectA, n_b: rectB },
    });
    const stack = new CommandStack(createDocument({ id: 'doc_1', pages: [page] }));
    render(
      <InspectorPanel stack={stack} pageId="page_1" selection={createSelection(['n_a', 'n_b'])} />,
    );
    const input = screen.getByLabelText('X') as HTMLInputElement;
    expect(input.value).toBe('—');
    fireEvent.change(input, { target: { value: '7' } });
    act(() => vi.advanceTimersByTime(300));
    expect(nodeOf(stack, 'n_a').x).toBe(7);
    expect(nodeOf(stack, 'n_b').x).toBe(7);
  });
});
