// @vitest-environment jsdom
/**
 * 命令面板集成测试（工单 08）。
 *
 * seam：**真实接线形态**——壳层（全局键盘派发 + 内置命令）+ 本域登记项（⌘/ 接管
 * `view.commandPalette`）+ overlays 插槽挂面板，与 `app/editor/editor-bootstrap.tsx`
 * 的声明一一对应。断言走可观测行为：键位开关、角色（dialog/combobox/listbox/option）、
 * 过滤结果、aria-activedescendant 漫游、执行后的 store 变化与焦点落点。
 *
 * 键位口径（规格 §3-14）：改版后面板开关是 **⌘/**（经 shortcuts 惯例注册全局键），
 * ⌘K 不再是面板键位。
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CanvasHudProvider,
  EditorShell,
  registerCommand,
  registerEditorSlotItem,
  resetCommandRegistry,
  resetEditorSlots,
  useEditorUi,
  useEditorView,
} from '../editor-shell';
import { CommandPaletteSlot, registerCommandPalette } from './register';

/** 挂真实接线：壳层 + 本域命令接管 + overlays 插槽（引导声明表的测试等价物）。 */
function mountPalette() {
  const view = render(
    <CanvasHudProvider>
      <EditorShell />
    </CanvasHudProvider>,
  );
  act(() => {
    registerCommandPalette();
    registerEditorSlotItem('overlays', {
      id: 'rw-08-command-palette',
      render: () => <CommandPaletteSlot />,
    });
  });
  return view;
}

/** 在 window 上按一次键（全局派发的入口）。 */
function press(key: string, options: KeyboardEventInit = {}): void {
  fireEvent.keyDown(window, { key, ...options });
}

beforeEach(() => {
  resetCommandRegistry();
  resetEditorSlots();
  useEditorView.setState({ zoom: 1, activeTool: 'move' });
  useEditorUi.setState({ commandPaletteOpen: false, shortcutsOpen: false });
});

afterEach(() => {
  resetCommandRegistry();
  resetEditorSlots();
  useEditorView.setState({ zoom: 1, activeTool: 'move' });
  useEditorUi.setState({ commandPaletteOpen: false, shortcutsOpen: false });
});

describe('开关（⌘/，经 shortcuts 惯例注册全局键）', () => {
  it('⌘/ 打开命令面板，焦点落入搜索框', async () => {
    mountPalette();
    press('/', { metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: '命令面板' });
    const input = within(dialog).getByRole('combobox');
    expect(document.activeElement).toBe(input);
  });

  it('⌘K 不再是面板键位（改版后无命令占用 ⌘K）', async () => {
    mountPalette();
    press('k', { metaKey: true });
    expect(screen.queryByRole('dialog', { name: '命令面板' })).toBeNull();
  });

  it('Esc 关闭面板（浮层栈语义，焦点回落原焦点元素）', async () => {
    mountPalette();
    const entry = screen.getByRole('button', { name: '键盘快捷键' });
    entry.focus();

    press('/', { metaKey: true });
    await screen.findByRole('dialog', { name: '命令面板' });

    fireEvent.keyDown(screen.getByRole('dialog', { name: '命令面板' }), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '命令面板' })).toBeNull();
    });
    expect(document.activeElement).toBe(entry);
  });

  it('点击遮罩关闭', async () => {
    mountPalette();
    press('/', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });

    fireEvent.click(dialog);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '命令面板' })).toBeNull();
    });
  });
});

describe('可达性与内容（命令源唯一）', () => {
  it('面板列出全部已注册命令：内置 + 后续票注册的都会出现（分组标题可见）', async () => {
    mountPalette();
    act(() => {
      registerCommand({
        id: 'review.present.start',
        title: '演示',
        group: '评审',
        run: () => undefined,
      });
    });

    press('/', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });

    expect(within(dialog).getByRole('listbox')).toBeDefined();
    expect(within(dialog).getByText('工具')).toBeDefined();
    expect(within(dialog).getByText('视图')).toBeDefined();
    expect(within(dialog).getByText('评审')).toBeDefined();
    expect(within(dialog).getByRole('option', { name: /演示/ })).toBeDefined();
  });

  it('空查询默认态：全命令按分组列出，不出现「最近使用」组（本期不做，不撒谎）', async () => {
    mountPalette();
    press('/', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });

    expect(within(dialog).queryByText('最近使用')).toBeNull();
    expect(within(dialog).getAllByRole('option').length).toBeGreaterThanOrEqual(10);
  });

  it('高亮条目命中字符（span.dfg-cmdk__hit）；id/分组兜底命中不带高亮', async () => {
    mountPalette();
    press('/', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });
    const input = within(dialog).getByRole('combobox');

    // 「矩形工具」连续包含 → 一段高亮包住「矩形」
    fireEvent.change(input, { target: { value: '矩形' } });
    const option = within(dialog).getByRole('option', { name: /矩形工具/ });
    expect(option.querySelectorAll('span.dfg-cmdk__hit')).toHaveLength(1);

    // id 兜底（zoom → 放大）：标题无高亮
    fireEvent.change(input, { target: { value: 'zoom' } });
    const zoomOption = within(dialog).getByRole('option', { name: /放大/ });
    expect(zoomOption.querySelectorAll('span.dfg-cmdk__hit')).toHaveLength(0);
  });
});

describe('中文模糊搜索', () => {
  it('子序列命中：搜「命面」直达「命令面板」', async () => {
    mountPalette();
    press('/', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });
    const input = within(dialog).getByRole('combobox');

    fireEvent.change(input, { target: { value: '命面' } });
    expect(within(dialog).getByRole('option', { name: /命令面板/ })).toBeDefined();
    expect(within(dialog).queryByRole('option', { name: /矩形工具/ })).toBeNull();
  });

  it('无命中显示空结果态', async () => {
    mountPalette();
    press('/', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '绝不存在' } });

    const empty = within(dialog).getByText('没有匹配的命令');
    expect(empty.getAttribute('data-df-state')).toBe('empty');
  });
});

describe('键盘导航', () => {
  /** 内置命令铺平：移动(0,当前工具→置灰) 画板(1) 矩形(2) 文本(3) 抓手(4) 命令面板(5) 放大(6) 缩小(7) 缩放100(8) 快捷键(9)。 */
  async function openPalette() {
    mountPalette();
    press('/', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });
    return { dialog, input: within(dialog).getByRole('combobox') };
  }

  it('初始高亮首个可运行项（跳过当前工具的置灰项）', async () => {
    const { input } = await openPalette();
    const activeId = input.getAttribute('aria-activedescendant');
    expect(activeId).not.toBeNull();
    const active = document.getElementById(activeId as string);
    expect(active?.getAttribute('data-df-command')).toBe('tool.frame');
  });

  it('↓ 跳过置灰项；Home 回首；End 跳尾', async () => {
    const { input } = await openPalette();

    // 键从搜索框（焦点所在）冒泡到卡片统一处理
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(
      document
        .getElementById(input.getAttribute('aria-activedescendant') as string)
        ?.getAttribute('data-df-command'),
    ).toBe('tool.rect');

    fireEvent.keyDown(input, { key: 'Home' });
    expect(
      document
        .getElementById(input.getAttribute('aria-activedescendant') as string)
        ?.getAttribute('data-df-command'),
    ).toBe('tool.frame');

    fireEvent.keyDown(input, { key: 'End' });
    expect(
      document
        .getElementById(input.getAttribute('aria-activedescendant') as string)
        ?.getAttribute('data-df-command'),
    ).toBe('help.shortcuts');
  });

  it('↑ 从首项回环到末项（跳过置灰项）', async () => {
    const { input } = await openPalette();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(
      document
        .getElementById(input.getAttribute('aria-activedescendant') as string)
        ?.getAttribute('data-df-command'),
    ).toBe('help.shortcuts');
  });

  it('置灰条目渲染 aria-disabled（可见但不可运行）', async () => {
    const { dialog } = await openPalette();
    const option = within(dialog).getByRole('option', { name: /移动工具/ });
    expect(option.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('执行', () => {
  it('Enter 执行高亮命令并关闭面板；打开前焦点在 body → 回落画布', async () => {
    mountPalette();
    press('/', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });
    const input = within(dialog).getByRole('combobox');

    fireEvent.change(input, { target: { value: '矩形工具' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(useEditorView.getState().activeTool).toBe('rect');
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '命令面板' })).toBeNull();
    });
    const canvas = document.querySelector<HTMLElement>('main[data-df-slot="canvas"]');
    expect(canvas).not.toBeNull();
    expect(document.activeElement).toBe(canvas);
  });

  it('点击条目执行；置灰条目点击不执行', async () => {
    mountPalette();
    press('/', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });

    fireEvent.click(within(dialog).getByRole('option', { name: /文本工具/ }));
    await waitFor(() => {
      expect(useEditorView.getState().activeTool).toBe('text');
    });

    // 再开面板：当前工具已是 text → 「文本工具」置灰，点击不产生变化
    press('/', { metaKey: true });
    const reopened = await screen.findByRole('dialog', { name: '命令面板' });
    fireEvent.click(within(reopened).getByRole('option', { name: /文本工具/ }));
    expect(useEditorView.getState().activeTool).toBe('text');
  });

  it('执行抛错的命令就地报错（role=alert），面板不关', async () => {
    mountPalette();
    act(() => {
      registerCommand({
        id: 'boom.command',
        title: '会炸的命令',
        group: '工具',
        run: () => {
          throw new Error('炸了');
        },
      });
    });
    press('/', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });

    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '会炸' } });
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('会炸的命令');
    });
    expect(screen.queryByRole('dialog', { name: '命令面板' })).not.toBeNull();
  });
});
