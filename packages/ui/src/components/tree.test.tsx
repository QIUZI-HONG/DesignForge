/**
 * Tree 树控件行为测试（RW-07 · 图层树基础件）。
 *
 * 断言角度（验收标准 §2 + §5）：树语义（role/aria）、展开/折叠、选中、键盘漫游
 （WAI-ARIA tree 模式）、重命名入口、禁用/加载/错误/空态、拖拽排序接口——
 * 只测可观测行为，不测内部状态实现。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Tree, type TreeNodeSpec } from './Tree';

/** 拿到某个节点的可交互行（treeitem 本身即可聚焦行）。 */
function rowOf(name: string): HTMLElement {
  return screen.getByRole('treeitem', { name });
}

/** 拿到某个节点行上的展开钮（纯视觉 affordance，键盘等价路径是方向键）。 */
function toggleOf(name: string): HTMLElement {
  const toggle = rowOf(name).querySelector('.dfg-tree__toggle');
  expect(toggle, `${name} 缺少展开钮`).not.toBeNull();
  return toggle as HTMLElement;
}

describe('Tree · 树语义与渲染', () => {
  const nodes: TreeNodeSpec[] = [
    {
      id: 'frame',
      label: '首页画板',
      children: [
        { id: 'rect', label: '背景矩形' },
        { id: 'text', label: '标题文本' },
      ],
    },
    { id: 'group', label: '导航组' },
  ];

  it('树容器/节点行具备 tree 语义与可访问名', () => {
    render(<Tree label="图层" nodes={nodes} />);
    expect(screen.getByRole('tree', { name: '图层' })).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: '首页画板' }).getAttribute('aria-level')).toBe('1');
    expect(screen.getByRole('treeitem', { name: '首页画板' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    // 叶子节点不声明 expanded（aria-expanded 缺省）
    expect(
      screen.getByRole('treeitem', { name: '导航组' }).getAttribute('aria-expanded'),
    ).toBeNull();
  });

  it('初始折叠：子行不可见；点击展开钮后可见，再点收起', async () => {
    const user = userEvent.setup();
    render(<Tree label="图层" nodes={nodes} />);
    expect(screen.queryByRole('treeitem', { name: '背景矩形' })).toBeNull();

    const item = screen.getByRole('treeitem', { name: '首页画板' });
    await user.click(toggleOf('首页画板'));
    expect(item.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('treeitem', { name: '背景矩形' }).getAttribute('aria-level')).toBe('2');

    await user.click(toggleOf('首页画板'));
    expect(item.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('treeitem', { name: '背景矩形' })).toBeNull();
  });

  it('受控展开：expandedIds 驱动，开合回调上报最新集合', async () => {
    const user = userEvent.setup();
    const onExpandedChange = vi.fn();
    const { rerender } = render(
      <Tree label="图层" nodes={nodes} expandedIds={[]} onExpandedChange={onExpandedChange} />,
    );
    await user.click(toggleOf('首页画板'));
    expect(onExpandedChange).toHaveBeenCalledWith(['frame']);

    rerender(
      <Tree
        label="图层"
        nodes={nodes}
        expandedIds={['frame']}
        onExpandedChange={onExpandedChange}
      />,
    );
    expect(screen.getByRole('treeitem', { name: '背景矩形' })).toBeTruthy();
    await user.click(toggleOf('首页画板'));
    expect(onExpandedChange).toHaveBeenCalledWith([]);
  });
});

describe('Tree · 选中与键盘', () => {
  const nodes: TreeNodeSpec[] = [
    {
      id: 'frame',
      label: '首页画板',
      children: [{ id: 'rect', label: '背景矩形' }],
    },
    { id: 'group', label: '导航组' },
  ];

  it('点击行触发选中，aria-selected 表达当前选中', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(
      <Tree label="图层" nodes={nodes} selectedId={null} onSelect={onSelect} />,
    );
    await user.click(rowOf('导航组'));
    expect(onSelect).toHaveBeenCalledWith('group');

    rerender(<Tree label="图层" nodes={nodes} selectedId="group" onSelect={onSelect} />);
    expect(screen.getByRole('treeitem', { name: '导航组' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('treeitem', { name: '首页画板' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('键盘 Enter/Space 选中，方向键在可见行间漫游', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Tree label="图层" nodes={nodes} selectedId="frame" onSelect={onSelect} />);
    const first = rowOf('首页画板');
    first.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('frame');

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(rowOf('导航组'));

    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(first);
  });

  it('ArrowRight 展开当前行，再按进入首个子行；ArrowLeft 折叠回归', async () => {
    const user = userEvent.setup();
    render(<Tree label="图层" nodes={nodes} selectedId="frame" />);
    const frame = rowOf('首页画板');
    frame.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: '首页画板' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    // 已展开时右方向键进入子行
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(rowOf('背景矩形'));
    // 左方向键回到父行
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(frame);
    // 父行已展开，左方向键折叠
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('treeitem', { name: '首页画板' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(screen.queryByRole('treeitem', { name: '背景矩形' })).toBeNull();
  });

  it('键盘漫游跳过禁用行', async () => {
    const user = userEvent.setup();
    const disabledNodes: TreeNodeSpec[] = [
      { id: 'a', label: '可用甲' },
      { id: 'b', label: '禁用乙', disabled: true },
      { id: 'c', label: '可用丙' },
    ];
    render(<Tree label="图层" nodes={disabledNodes} selectedId="a" />);
    rowOf('可用甲').focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(rowOf('可用丙'));
  });
});

describe('Tree · 重命名入口', () => {
  const nodes: TreeNodeSpec[] = [{ id: 'rect', label: '背景矩形' }];

  it('双击进入行内编辑，Enter 提交 onRename', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<Tree label="图层" nodes={nodes} onRename={onRename} />);
    await user.dblClick(rowOf('背景矩形'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('背景矩形');
    await user.clear(input);
    await user.type(input, '底色矩形');
    await user.keyboard('{Enter}');
    expect(onRename).toHaveBeenCalledWith('rect', '底色矩形');
    // 提交后退出编辑态
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Esc 取消重命名，不改名', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<Tree label="图层" nodes={nodes} onRename={onRename} />);
    await user.dblClick(rowOf('背景矩形'));
    await user.keyboard('{Escape}');
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('未提供 onRename 时不进入编辑（重命名入口由调用方开关）', async () => {
    const user = userEvent.setup();
    render(<Tree label="图层" nodes={nodes} />);
    await user.dblClick(rowOf('背景矩形'));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('F2 也能进入重命名（键盘入口，不只鼠标）', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<Tree label="图层" nodes={nodes} onRename={onRename} />);
    rowOf('背景矩形').focus();
    await user.keyboard('{F2}');
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});

describe('Tree · 禁用 / 加载 / 错误 / 空态', () => {
  it('禁用节点不可选中且标注 aria-disabled', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const nodes: TreeNodeSpec[] = [
      { id: 'locked', label: '锁定图层', disabled: true },
      { id: 'normal', label: '普通图层' },
    ];
    render(<Tree label="图层" nodes={nodes} onSelect={onSelect} />);
    const item = screen.getByRole('treeitem', { name: '锁定图层' });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    await user.click(rowOf('锁定图层'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('加载中节点：行内转圈 + aria-busy，子行暂不渲染', () => {
    const nodes: TreeNodeSpec[] = [
      { id: 'big', label: '大画板', loading: true, children: [{ id: 'x', label: '子层' }] },
    ];
    const { container } = render(<Tree label="图层" nodes={nodes} />);
    const item = screen.getByRole('treeitem', { name: '大画板' });
    expect(item.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('.dfg-spinner')).not.toBeNull();
    expect(screen.queryByRole('treeitem', { name: '子层' })).toBeNull();
  });

  it('错误节点：点击行触发重试而非选中', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onSelect = vi.fn();
    const nodes: TreeNodeSpec[] = [{ id: 'bad', label: '加载失败组', error: true }];
    render(<Tree label="图层" nodes={nodes} onRetry={onRetry} onSelect={onSelect} />);
    expect(screen.getByRole('treeitem', { name: '加载失败组' }).className).toContain(
      'dfg-tree__node--error',
    );
    await user.click(rowOf('加载失败组'));
    expect(onRetry).toHaveBeenCalledWith('bad');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('空树渲染调用方给的空态内容', () => {
    render(<Tree label="图层" nodes={[]} emptyContent={<span>还没有图层</span>} />);
    expect(screen.getByRole('tree', { name: '图层' })).toBeTruthy();
    expect(screen.getByText('还没有图层')).toBeTruthy();
  });
});

describe('Tree · 拖拽排序接口', () => {
  it('行可拖拽（draggable），拖 A 落到 B 触发 onReorder(source, target)', () => {
    const onReorder = vi.fn();
    const nodes: TreeNodeSpec[] = [
      { id: 'a', label: '图层甲' },
      { id: 'b', label: '图层乙' },
    ];
    render(<Tree label="图层" nodes={nodes} onReorder={onReorder} />);
    const source = rowOf('图层甲');
    expect(source.getAttribute('draggable')).toBe('true');

    fireEvent.dragStart(source);
    fireEvent.dragOver(rowOf('图层乙'));
    fireEvent.drop(rowOf('图层乙'));
    fireEvent.dragEnd(source);
    expect(onReorder).toHaveBeenCalledWith('a', 'b');
  });

  it('拖拽落回自身不触发 onReorder', () => {
    const onReorder = vi.fn();
    const nodes: TreeNodeSpec[] = [{ id: 'a', label: '图层甲' }];
    render(<Tree label="图层" nodes={nodes} onReorder={onReorder} />);
    fireEvent.dragStart(rowOf('图层甲'));
    fireEvent.drop(rowOf('图层甲'));
    fireEvent.dragEnd(rowOf('图层甲'));
    expect(onReorder).not.toHaveBeenCalled();
  });
});
