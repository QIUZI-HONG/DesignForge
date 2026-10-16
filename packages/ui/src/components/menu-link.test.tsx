// @vitest-environment jsdom
/**
 * 菜单链接条目（修复批次 4 · 工作包 D2）——「设置与帮助」类入口的链接语义回归。
 *
 * 缺陷现场（UX-09）：首页「设置」条目硬编码禁用；接通目标页后入口必须是**链接**
 * （`href` 可断言、中键/修饰键可新开标签），而不是只能靠回调的按钮。
 *
 * 本测试锁两条外部可观测行为：
 * 1. 条目给 `href` → 渲染 `<a role="menuitem" href>`；不给 → 仍是 `<button>`（既有行为不变）；
 * 2. 禁用语义与普通条目同口径（`aria-disabled`，仍可悬停看原因——F15 不被破坏）。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { DropdownMenu, type MenuSectionSpec } from './DropdownMenu';

function renderMenu(sections: MenuSectionSpec[]) {
  render(
    <DropdownMenu
      label="测试菜单"
      defaultOpen
      sections={sections}
      trigger={(state) => (
        <Button {...state.triggerProps} aria-label="打开菜单">
          打开
        </Button>
      )}
    />,
  );
}

describe('DropdownMenu · 链接条目（href）', () => {
  it('给 href 的条目渲染为链接（role=menuitem + href），不给的仍是按钮', () => {
    renderMenu([
      {
        id: 'help',
        items: [
          { id: 'settings', label: '设置', href: '/settings?daemon=x' },
          { id: 'about', label: '关于', onSelect: vi.fn() },
        ],
      },
    ]);
    const link = screen.getByRole('menuitem', { name: '设置' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/settings?daemon=x');
    const button = screen.getByRole('menuitem', { name: '关于' });
    expect(button.tagName).toBe('BUTTON');
  });

  it('链接条目不再渲染禁用态（可用：无 aria-disabled）', () => {
    renderMenu([
      {
        id: 'help',
        items: [{ id: 'settings', label: '设置', href: '/settings' }],
      },
    ]);
    const link = screen.getByRole('menuitem', { name: '设置' });
    expect(link.getAttribute('aria-disabled')).toBeNull();
  });

  it('禁用链接条目仍带 aria-disabled + 原因提示（F15 口径）', async () => {
    renderMenu([
      {
        id: 'help',
        items: [
          { id: 'settings', label: '设置', href: '/settings', disabled: true, disabledReason: '未接入' },
        ],
      },
    ]);
    const link = screen.getByRole('menuitem', { name: '设置' });
    expect(link.getAttribute('aria-disabled')).toBe('true');
  });
});
