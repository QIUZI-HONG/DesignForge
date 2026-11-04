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
 *
 * arch-02：数值编辑的**语义**测试集中在 `@dforge/ui` 的 NumberField（含 299/300 边界、
 * Esc-after-blur、拖拽停顿等对抗用例）；本文件保留 InspectorPanel → 命令栈的**集成**断言
 * （一次修改一条历史 / Esc 零历史 / 混选单事务）。
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
