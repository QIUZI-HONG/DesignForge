/**
 * 回归 · 禁用条目不得并排（FE-03 实测暴露的上游缺陷）。
 *
 * 缺陷：带 `disabledReason` 的条目被 `Tooltip` 的 `inline-flex` 锚点 span 包裹后，
 * 多条禁用条目在菜单里**并排渲染成一行**（正常条目是整宽行，禁用条目变成行内块），
 * 且 `role="menuitem"` 被塞进一个无语义的 span 里，破坏菜单的 ARIA 父子层级。
 *
 * 修复口径（本测试即契约）：
 * 1. 菜单里**不允许**出现 `dfg-tooltip-anchor` 包裹——提示行为直接挂在条目本身（`asChild`）；
 * 2. 每个条目是具名分组容器 `dfg-menu__section` 的**直接子元素**，分组容器的直接子元素
 *    只允许「整宽条目 / 分隔线 / 组标题」（提示浮层自身是绝对定位，跳出文档流）；
 * 3. 样式语义：条目 `display:flex` + `width:100%`（整宽一行），分组容器 `display:block`；
 * 4. 修复不得牺牲 F15 的原因提示（禁用条目悬停仍出 tooltip）。
 *
 * 为什么注入真实 `components.css`：jsdom 的计算样式来自文档里的样式表，
 * 把本包的样式表挂进 `<head>` 后就能断言「块级整宽」这类布局语义，
 * 而不是只断言类名（类名相同但样式回退时也应当被这条测试逮住）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import { Button } from './Button';
import { DropdownMenu, type MenuSectionSpec } from './DropdownMenu';

const componentsCss = readFileSync(resolve(process.cwd(), 'src/components.css'), 'utf8');

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = componentsCss;
  document.head.append(style);
});

const sections: MenuSectionSpec[] = [
  {
    id: 'edit',
    items: [
      { id: 'copy', label: '复制' },
      { id: 'paste', label: '粘贴' },
    ],
  },
  {
    id: 'danger',
    label: '危险操作',
    items: [
      { id: 'delete', label: '删除', disabled: true, disabledReason: '只读文档不可删除' },
      { id: 'archive', label: '归档', disabled: true, disabledReason: '只读文档不可归档' },
    ],
  },
];

/** 打开菜单（两条禁用条目 + 两条正常条目）。 */
async function openMenu() {
  const user = userEvent.setup();
  render(
    <DropdownMenu
      label="文件操作"
      sections={sections}
      tooltipDelay={0}
      trigger={({ triggerProps }) => <Button {...triggerProps}>更多</Button>}
    />,
  );
  await user.click(screen.getByRole('button', { name: '更多' }));
  return user;
}

/** 分组容器的直接子元素里，允许出现在行布局中的三类 + 绝对定位的提示浮层。 */
function isAllowedRowChild(child: Element): boolean {
  return (
    child.classList.contains('dfg-menu__item') ||
    child.classList.contains('dfg-menu__separator') ||
    child.classList.contains('dfg-menu__group-label') ||
    child.getAttribute('role') === 'tooltip'
  );
}

describe('回归 · 禁用条目不得并排（多条 disabledReason）', () => {
  it('菜单里不得出现 Tooltip 锚点包裹（否则禁用条目会并排成一行）', async () => {
    await openMenu();
    const menu = screen.getByRole('menu');
    expect(menu.querySelectorAll('.dfg-tooltip-anchor')).toHaveLength(0);
  });

  it('禁用条目与普通条目一样是分组容器的直接子元素（结构上各自成行）', async () => {
    await openMenu();
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(4);
    for (const item of items) {
      const parent = item.parentElement;
      expect(parent?.className, `${item.textContent ?? ''} 未落在具名分组容器里`).toContain(
        'dfg-menu__section',
      );
      const children = [...(parent?.children ?? [])];
      expect(children.every(isAllowedRowChild)).toBe(true);
      // 条目内部不得再嵌条目（防「并排」的另一种形态：条目被塞进条目）
      expect(item.querySelector('[role="menuitem"]')).toBeNull();
    }
  });

  it('样式语义：每条目整宽成行（display:flex + width:100%），分组容器为块级', async () => {
    await openMenu();
    const menu = screen.getByRole('menu');
    const section = menu.querySelector('.dfg-menu__section');
    expect(section).not.toBeNull();
    expect(getComputedStyle(section as Element).display).toBe('block');
    for (const item of screen.getAllByRole('menuitem')) {
      const computed = getComputedStyle(item);
      expect(computed.display, `${item.textContent ?? ''} 不是整宽块级行`).toBe('flex');
      expect(computed.width).toBe('100%');
    }
  });

  it('禁用条目悬停仍给出原因提示（F15 不被修复破坏）', async () => {
    const user = await openMenu();
    await user.hover(screen.getByRole('menuitem', { name: /删除/ }));
    expect((await screen.findByRole('tooltip')).textContent).toContain('只读文档不可删除');
  });
});
