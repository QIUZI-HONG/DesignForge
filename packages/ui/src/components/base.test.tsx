/**
 * 基础件行为测试（按钮/图标按钮/提示/分段控件/转圈）。
 *
 * 断言角度（验收标准 §2 + §5 状态覆盖）：可观测行为——可访问名、键盘、态类、
 * 禁用/加载对交互的影响；不测内部实现（不查 state、不查私有函数）。
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ICONS } from '../icons/index';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { SegmentedControl } from './SegmentedControl';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';

describe('Button', () => {
  it('渲染按钮与文本，点击回调触发', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>保存</Button>);
    const button = screen.getByRole('button', { name: '保存' });
    expect(button.getAttribute('type')).toBe('button');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('变体与尺寸落到约定类名（供样式与截图门禁装订）', () => {
    const { rerender } = render(
      <Button variant="primary" size="sm">
        主
      </Button>,
    );
    let button = screen.getByRole('button');
    expect(button.className).toContain('dfg-btn--primary');
    expect(button.className).toContain('dfg-btn--sm');
    rerender(
      <Button variant="danger" size="lg">
        危险
      </Button>,
    );
    button = screen.getByRole('button');
    expect(button.className).toContain('dfg-btn--danger');
    expect(button.className).toContain('dfg-btn--lg');
  });

  it('禁用态：不可点击且不可键盘激活', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        删除
      </Button>,
    );
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.click(button);
    button.focus();
    await user.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('加载态：标注 aria-busy、禁点、宽度结构保留（文本仍在）', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { container } = render(
      <Button loading onClick={onClick}>
        导出
      </Button>,
    );
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
    expect(container.querySelector('.dfg-spinner')).not.toBeNull();
    expect(button.textContent).toContain('导出');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('前置图标与整宽修饰', () => {
    const { container } = render(
      <Button icon={<ICONS.PlusIcon />} fullWidth>
        新建
      </Button>,
    );
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('button').className).toContain('dfg-btn--full');
  });

  it('禁用原因经提示给出（F15：灰化 + tooltip 原因）', async () => {
    const user = userEvent.setup();
    render(
      <Button disabled disabledReason="只读文档不可编辑">
        删除
      </Button>,
    );
    await user.hover(screen.getByRole('button'));
    expect((await screen.findByRole('tooltip')).textContent).toContain('只读文档不可编辑');
  });
});

describe('IconButton', () => {
  it('以 label 作为可访问名（纯图标按钮必须具名）', () => {
    render(<IconButton label="更多操作" icon={<ICONS.MoreHorizontalIcon />} />);
    expect(screen.getByRole('button', { name: '更多操作' })).toBeTruthy();
  });

  it('按下的开关态经 aria-pressed 表达', () => {
    const { rerender } = render(
      <IconButton label="显示网格" icon={<ICONS.FrameIcon />} pressed={false} />,
    );
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false');
    rerender(<IconButton label="显示网格" icon={<ICONS.FrameIcon />} pressed />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
  });

  it('禁用与加载都不可点击', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <IconButton label="删除" icon={<ICONS.TrashIcon />} disabled onClick={onClick} />,
    );
    await user.click(screen.getByRole('button'));
    rerender(<IconButton label="删除" icon={<ICONS.TrashIcon />} loading onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('true');
  });
});

describe('Spinner', () => {
  it('给 label 时是可读的状态区，否则为装饰性', () => {
    const { rerender } = render(<Spinner label="正在加载" />);
    expect(screen.getByRole('status', { name: '正在加载' })).toBeTruthy();
    rerender(<Spinner />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Tooltip', () => {
  it('悬停出现、移出消失（含 aria-describedby 关联）', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="删除所选图层" delay={0}>
        <button type="button">删除</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: '删除' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.hover(trigger);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toContain('删除所选图层');
    await user.unhover(trigger);
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeNull();
    });
  });

  it('键盘聚焦也出现（可达性：不只鼠标）', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="快捷键说明" delay={0}>
        <button type="button">说明</button>
      </Tooltip>,
    );
    await user.tab();
    expect((await screen.findByRole('tooltip')).textContent).toContain('快捷键说明');
  });

  it('Esc 关闭提示', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="提示" delay={0}>
        <button type="button">锚点</button>
      </Tooltip>,
    );
    await user.hover(screen.getByRole('button'));
    await screen.findByRole('tooltip');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeNull();
    });
  });

  it('placement 决定方位类名（截图门禁按方位取样）', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="提示" placement="left" delay={0}>
        <button type="button">锚点</button>
      </Tooltip>,
    );
    await user.hover(screen.getByRole('button'));
    expect((await screen.findByRole('tooltip')).className).toContain('dfg-tooltip--left');
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'grid', label: '网格' },
    { value: 'list', label: '列表' },
    { value: 'timeline', label: '时间线', disabled: true },
  ];

  it('单选语义：radiogroup + 原生 checked', () => {
    render(<SegmentedControl label="视图" options={options} value="grid" onChange={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: '视图' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '网格', checked: true })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '列表', checked: false })).toBeTruthy();
  });

  it('点击与方向键都能切换选中', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <SegmentedControl label="视图" options={options} value="grid" onChange={onChange} />,
    );
    await user.click(screen.getByRole('radio', { name: '列表' }));
    expect(onChange).toHaveBeenCalledWith('list');
    rerender(<SegmentedControl label="视图" options={options} value="list" onChange={onChange} />);
    screen.getByRole('radio', { name: '列表' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('grid');
  });

  it('禁用项不可选、不参与键盘漫游，并给出原因提示', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl label="视图" options={options} value="list" onChange={onChange} />);
    const disabledItem = screen.getByRole('radio', { name: '时间线' }) as HTMLInputElement;
    expect(disabledItem.disabled).toBe(true);
    await user.click(disabledItem);
    expect(onChange).not.toHaveBeenCalled();
    // 方向键漫游跳过禁用项：「列表」向后应当是「网格」（「时间线」被跳过，不落点）
    screen.getByRole('radio', { name: '列表' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('grid');
  });
});
