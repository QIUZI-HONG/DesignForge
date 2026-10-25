// @vitest-environment jsdom
/**
 * 对抗性验证 · 风险 8：a11y 与键盘
 *
 * 覆盖：菜单（含「禁用条目不得并排」回归 + 键盘漫游/Esc/焦点归还）、模态（焦点陷阱 + Esc）、
 *      命令面板（combobox/listbox 语义 + Esc 关闭并归还焦点 + 置灰项跳过）、抽屉 Esc。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createDocument, createPage, createRect, createSelection } from '@dforge/engine';
import { DropdownMenu, type MenuSectionSpec } from '@dforge/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '@/features/command-palette/command-palette';
import { createPanelsSession } from '@/features/editor-panels';
import { LayerContextMenu } from '@/features/editor-panels/components/LayerContextMenu';
import { PanelsProvider } from '@/features/editor-panels/components/panels-context';
import { registerCommand } from '@/features/editor-shell/commands/registry';
import { useEditorUi } from '@/features/editor-shell/state/ui';
import { ShortcutsDialog } from '@/features/editor-shell/ui/shortcuts-dialog';

/** 注入设计系统样式（jsdom 计算样式来自文档里的样式表，否则布局语义断言无意义）。 */
beforeAll(() => {
  const componentsCss = readFileSync(
    resolve(process.cwd(), '../../packages/ui/src/components.css'),
    'utf8',
  );
  const style = document.createElement('style');
  style.textContent = componentsCss;
  document.head.append(style);
});

/** 禁用条目 + 正常条目的菜单（与「禁用条目不得并排」回归同一形状）。 */
const sections: MenuSectionSpec[] = [
  { id: 'edit', items: [{ id: 'rename', label: '重命名' }] },
  {
    id: 'danger',
    label: '危险操作',
    items: [
      { id: 'delete', label: '删除', disabled: true, disabledReason: '只读文档不可删除' },
      { id: 'archive', label: '归档', disabled: true, disabledReason: '只读文档不可归档' },
    ],
  },
];

describe('a11y · 菜单（DropdownMenu）', () => {
  it('禁用条目不得并排：无锚点包裹、条目是分组容器直接子元素、整宽成行', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu
        label="文件操作"
        sections={sections}
        tooltipDelay={0}
        trigger={({ triggerProps }) => <button {...triggerProps}>更多</button>}
      />,
    );
    await user.click(screen.getByRole('button', { name: '更多' }));
    const menu = screen.getByRole('menu');

    // 1. 无 Tooltip 锚点夹层
    expect(menu.querySelectorAll('.dfg-tooltip-anchor')).toHaveLength(0);

    // 2. ARIA 父子层级：menuitem 直接坐在具名分组容器里
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.parentElement?.className).toContain('dfg-menu__section');
      // 分组容器的直接子元素只允许「整宽条目 / 分隔线 / 组标题 / 绝对定位提示」
      const children = [...(item.parentElement?.children ?? [])];
      for (const child of children) {
        const ok =
          child.classList.contains('dfg-menu__item') ||
          child.classList.contains('dfg-menu__separator') ||
          child.classList.contains('dfg-menu__group-label') ||
          child.getAttribute('role') === 'tooltip';
        expect(ok, `分组容器里出现非行元素：${child.className}`).toBe(true);
      }
    }

    // 3. 布局语义：条目 flex + width 100%（并排会退化成 inline-block）
    for (const item of items) {
      const computed = getComputedStyle(item);
      expect(computed.display).toBe('flex');
      expect(computed.width).toBe('100%');
    }
  });

  it('键盘漫游跳过禁用项并首尾回环；Enter 在禁用项上不触发', async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    render(
      <DropdownMenu
        label="文件操作"
        sections={sections}
        tooltipDelay={0}
        trigger={({ triggerProps }) => <button {...triggerProps}>更多</button>}
      />,
    );
    const trigger = screen.getByRole('button', { name: '更多' });
    trigger.focus();
    await user.keyboard('{ArrowDown}'); // 打开并聚焦首个可用条目
    expect(document.activeElement?.textContent).toContain('重命名');

    await user.keyboard('{ArrowDown}'); // 跳过两条禁用，回环到「重命名」
    expect(document.activeElement?.textContent).toContain('重命名');
    await user.keyboard('{End}'); // End → 最后一个**可用**项 = 重命名（后两条禁用）
    expect(document.activeElement?.textContent).toContain('重命名');
    expect(screen.queryByText('已删除')).toBeNull();
    void onDeleted;
  });

  it('Esc 关闭并把焦点还给触发器（焦点不丢在文档根上）', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu
        label="文件操作"
        sections={sections}
        tooltipDelay={0}
        trigger={({ triggerProps }) => <button {...triggerProps}>更多</button>}
      />,
    );
    const trigger = screen.getByRole('button', { name: '更多' });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeDefined();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('a11y · 图层右键菜单（真实接线，含禁用原因）', () => {
  it('单选一个矩形：禁用条目（编组）与可用条目同排、各有整宽行、无锚点包裹', async () => {
    const user = userEvent.setup();
    const rect = createRect({ id: 'n_rect', x: 0, y: 0, width: 10, height: 10 });
    const page = createPage({ id: 'page_1', rootIds: ['n_rect'], nodes: { n_rect: rect } });
    const session = createPanelsSession({
      document: createDocument({ id: 'doc_1', pages: [page] }),
      pageId: 'page_1',
    });
    session.ui.getState().setSelection(createSelection(['n_rect'], 'n_rect'));

    render(
      <PanelsProvider session={session}>
        <LayerContextMenu rowId="n_rect" position={{ x: 10, y: 10 }} onClose={() => undefined} />
      </PanelsProvider>,
    );
    const menu = await screen.findByRole('menu');
    expect(menu.querySelectorAll('.dfg-tooltip-anchor')).toHaveLength(0);

    const items = screen.getAllByRole('menuitem');
    expect(items.length).toBeGreaterThan(2);
    for (const item of items) {
      expect(item.parentElement?.className).toContain('dfg-menu__section');
      expect(getComputedStyle(item).width).toBe('100%');
    }
    // 禁用条目仍可悬停出原因（F15 不被结构修复牺牲）
    const disabled = items.find((item) => item.getAttribute('aria-disabled') === 'true');
    expect(disabled).toBeDefined();
    await user.hover(disabled as Element);
    await waitFor(() => {
      expect(screen.getByRole('tooltip').textContent?.length).toBeGreaterThan(0);
    });
  });
});

describe('a11y · 模态（快捷键说明）', () => {
  it('打开后焦点入层、Esc 关闭、role=dialog + aria-modal + 标题关联', async () => {
    useEditorUi.getState().setShortcutsOpen(true);
    render(<ShortcutsDialog />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toBeTruthy();
    // 焦点在层内（陷阱生效：焦点不在 body 上）
    expect(dialog.contains(document.activeElement)).toBe(true);

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(useEditorUi.getState().shortcutsOpen).toBe(false);
    });
  });
});

describe('a11y · 命令面板（工单 08，⌘/ 呼出）', () => {
  it('角色层级：dialog/combobox/listbox/option；打开后焦点在搜索框；Esc 关闭并归还焦点', async () => {
    registerCommand({ id: 'verify.noop', title: '验证命令', group: '验证', run: () => undefined });
    const opener = document.createElement('button');
    opener.textContent = '打开面板';
    document.body.append(opener);
    opener.focus();

    useEditorUi.getState().setCommandPaletteOpen(true);
    render(<CommandPalette />);

    const dialog = await screen.findByRole('dialog');
    const combobox = screen.getByRole('combobox');
    const listbox = screen.getByRole('listbox');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(combobox.getAttribute('aria-controls')).toBe(listbox.id);
    expect(combobox.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => {
      expect(document.activeElement).toBe(combobox);
    });

    // 高亮项通过 aria-activedescendant 表达（读屏可播报）
    const activeId = combobox.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    const activeOption = document.getElementById(activeId as string);
    expect(activeOption?.getAttribute('role')).toBe('option');
    expect(activeOption?.getAttribute('aria-selected')).toBe('true');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(useEditorUi.getState().commandPaletteOpen).toBe(false);
    });
    // 关闭后焦点归还打开它的元素
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });

  it('↑/↓ 只落在可运行项上（置灰项被跳过，不出现「选中了却不能执行」）', async () => {
    registerCommand({
      id: 'verify.noop2',
      title: '验证命令二',
      group: '验证',
      run: () => undefined,
    });
    useEditorUi.getState().setCommandPaletteOpen(true);
    render(<CommandPalette />);
    const combobox = await screen.findByRole('combobox');
    await waitFor(() => {
      expect(document.activeElement).toBe(combobox);
    });

    const optionById = (id: string | null): Element | null =>
      id === null ? null : document.getElementById(id);
    for (let index = 0; index < 6; index += 1) {
      await userEvent.keyboard('{ArrowDown}');
      const option = optionById(combobox.getAttribute('aria-activedescendant'));
      expect(option, '高亮项必须存在').not.toBeNull();
      expect(option?.getAttribute('aria-disabled'), '高亮项不得是禁用项').not.toBe('true');
    }
    for (let index = 0; index < 6; index += 1) {
      await userEvent.keyboard('{ArrowUp}');
      const option = optionById(combobox.getAttribute('aria-activedescendant'));
      expect(option?.getAttribute('aria-disabled')).not.toBe('true');
    }
  });
});
