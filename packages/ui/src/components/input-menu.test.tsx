/**
 * 输入件与弹出菜单行为测试（F3 弹出菜单族）。
 *
 * 断言角度：可访问名/描述关联、键盘可达（漫游、选择、Esc 归还焦点）、
 * 禁用项的不可选语义与原因提示、菜单分组与分隔线。
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ICONS } from '../icons/index';
import { Button } from './Button';
import { DropdownMenu, type MenuSectionSpec } from './DropdownMenu';
import { Input } from './Input';

describe('Input', () => {
  it('fieldLabel 与控件关联（读屏可读）', () => {
    render(<Input fieldLabel="图层名" defaultValue="矩形 1" />);
    const input = screen.getByLabelText('图层名') as HTMLInputElement;
    expect(input.value).toBe('矩形 1');
  });

  it('输入回调与受控值', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input defaultValue="" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'abc');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('错误态：aria-invalid + describedby 指向错误文案（F14 校验类）', () => {
    render(<Input fieldLabel="画布宽" defaultValue="abc" errorMessage="请输入数字" />);
    const input = screen.getByLabelText('画布宽');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const error = screen.getByRole('alert');
    expect(error.textContent).toContain('请输入数字');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
  });

  it('错误文案覆盖 invalid 开关（给出文案即错误态）', () => {
    render(<Input fieldLabel="画布宽" invalid />);
    expect(screen.getByLabelText('画布宽').getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('禁用态不可输入且标 disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input fieldLabel="只读" disabled onChange={onChange} />);
    const input = screen.getByLabelText('只读') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    await user.click(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('搜索态带前置放大镜、数字态用 number 输入', () => {
    const { container } = render(<Input kind="search" placeholder="搜索" />);
    const search = screen.getByPlaceholderText('搜索') as HTMLInputElement;
    expect(search.type).toBe('search');
    expect(container.querySelector('svg')).not.toBeNull();

    const { container: numberBox } = render(<Input kind="number" aria-label="宽度" />);
    expect((numberBox.querySelector('input') as HTMLInputElement).type).toBe('number');
  });

  it('提示文案经 describedby 关联', () => {
    render(<Input fieldLabel="宽度" hint="单位：像素" />);
    const input = screen.getByLabelText('宽度');
    const hint = screen.getByText('单位：像素');
    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
  });
});

const sections: MenuSectionSpec[] = [
  {
    id: 'edit',
    items: [
      { id: 'copy', label: '复制', icon: <ICONS.CopyIcon />, shortcut: '⌘C' },
      { id: 'paste', label: '粘贴', shortcut: '⌘V' },
    ],
  },
  {
    id: 'danger',
    label: '危险操作',
    items: [
      {
        id: 'delete',
        label: '删除',
        icon: <ICONS.TrashIcon />,
        disabled: true,
        disabledReason: '只读文档不可删除',
      },
    ],
  },
];

function renderMenu(onSelect = vi.fn()) {
  const view = render(
    <DropdownMenu
      label="文件操作"
      sections={sections.map((section) => ({
        ...section,
        items: section.items.map((item) => ({ ...item, onSelect: () => onSelect(item.id) })),
      }))}
      tooltipDelay={0}
      trigger={({ triggerProps }) => <Button {...triggerProps}>更多</Button>}
    />,
  );
  return { ...view, onSelect, trigger: screen.getByRole('button', { name: '更多' }) };
}

describe('DropdownMenu（F3 弹出菜单族）', () => {
  it('触发器声明 menu 语义，点击展开具名菜单', async () => {
    const user = userEvent.setup();
    const { trigger, onSelect } = renderMenu();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: '文件操作' })).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('条目/分组名/快捷键/分隔线齐备', async () => {
    const user = userEvent.setup();
    const { trigger } = renderMenu();
    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: /复制/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /粘贴/ })).toBeTruthy();
    expect(screen.getByText('危险操作')).toBeTruthy();
    expect(screen.getByText('⌘C')).toBeTruthy();
    expect(screen.getAllByRole('separator').length).toBeGreaterThan(0);
  });

  it('键盘：ArrowDown 进入首项并漫游，Enter 选择后关闭', async () => {
    const user = userEvent.setup();
    const { trigger, onSelect } = renderMenu();
    await user.click(trigger);
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('复制');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('粘贴');
    // 下一项是禁用条目 → 漫游跳过，回到首项
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('复制');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('copy');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  it('Esc 关闭菜单并把焦点归还触发器', async () => {
    const user = userEvent.setup();
    const { trigger } = renderMenu();
    await user.click(trigger);
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('禁用条目标 aria-disabled、点击不触发，悬停给出原因提示', async () => {
    const user = userEvent.setup();
    const { trigger, onSelect } = renderMenu();
    await user.click(trigger);
    const item = screen.getByRole('menuitem', { name: /删除/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    await user.click(item);
    expect(onSelect).not.toHaveBeenCalled();
    await user.hover(item);
    expect((await screen.findByRole('tooltip')).textContent).toContain('只读文档不可删除');
  });

  it('点击菜单外关闭', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <div data-testid="outside">外部区域</div>
        <DropdownMenu
          label="文件操作"
          sections={sections}
          trigger={({ triggerProps }) => <Button {...triggerProps}>更多</Button>}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: '更多' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.click(screen.getByTestId('outside'));
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });
});
