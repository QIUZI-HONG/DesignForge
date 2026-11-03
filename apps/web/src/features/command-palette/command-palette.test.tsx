// @vitest-environment jsdom
/**
 * 命令面板集成测试（工单 08 建域；票 04 · spec P0-4 全局化后行为）。
 *
 * seam：**真实接线形态**——编辑器 = 壳层（全局键盘派发，主键位与别名都消费）+
 * 本域全局宿主（`GlobalCommandPalette`：注册 `view.commandPalette` ⌘K + ⌘/ 别名、
 * 渲染面板），与根布局 + 编辑器页的真实组合一致。断言走可观测行为：键位开关、
 * 角色（dialog/combobox/listbox/option）、过滤结果、aria-activedescendant 漫游、
 * 执行后的 store 变化与焦点落点。
 *
 * 键位口径（票 04）：**⌘K 全局**（首页/设置/编辑器均可呼出——首页/设置页的接线
 * 断言在 `app/global-command-palette.test.tsx`），⌘/ 保留为编辑器别名。
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CanvasHudProvider,
  EditorShell,
  getCommand,
  registerCommand,
  resetCommandRegistry,
  useEditorUi,
  useEditorView,
} from '../editor-shell';
import { GlobalCommandPalette } from './register';

/** 挂真实接线：编辑器壳层（全局派发器）+ 根布局全局宿主（注册 + 面板）。 */
function mountPalette() {
  return render(
    <CanvasHudProvider>
      <EditorShell />
      <GlobalCommandPalette />
    </CanvasHudProvider>,
  );
}

/** 在 window 上按一次键（全局派发的入口）。 */
function press(key: string, options: KeyboardEventInit = {}): void {
  fireEvent.keyDown(window, { key, ...options });
}

beforeEach(() => {
  resetCommandRegistry();
  useEditorView.setState({ zoom: 1, activeTool: 'move' });
  useEditorUi.setState({ commandPaletteOpen: false, shortcutsOpen: false });
  window.localStorage.clear();
});

afterEach(() => {
  resetCommandRegistry();
  useEditorView.setState({ zoom: 1, activeTool: 'move' });
  useEditorUi.setState({ commandPaletteOpen: false, shortcutsOpen: false });
  window.localStorage.clear();
});

describe('开关（⌘K 全局主键位 + ⌘/ 编辑器别名，经 shortcuts 惯例注册）', () => {
  it('⌘/ 打开命令面板（编辑器别名），焦点落入搜索框', async () => {
    mountPalette();
    press('/', { metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: '命令面板' });
    const input = within(dialog).getByRole('combobox');
    expect(document.activeElement).toBe(input);
  });

  it('⌘K 同样呼出（票 04：全局主键位，别名共用同一命令），焦点落搜索框与 ⌘/ 同口径', async () => {
    mountPalette();
    press('k', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });
    expect(document.activeElement).toBe(within(dialog).getByRole('combobox'));
  });

  it('注册形状：主键位 ⌘K，附加键位 ⌘/', () => {
    mountPalette();
    const command = getCommand('view.commandPalette');
    expect(command?.shortcut).toBe('⌘K');
    expect(command?.shortcutAliases).toEqual(['⌘/']);
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

  it('空查询且无最近记录：全命令按分组列出，不出现「最近使用」组（记录为空不出组，不撒谎）', async () => {
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
    // （执行过一条 → 最近使用组与工具组各有一行「文本工具」，取第一行点击）
    press('/', { metaKey: true });
    const reopened = await screen.findByRole('dialog', { name: '命令面板' });
    const textOptions = within(reopened).getAllByRole('option', { name: /文本工具/ });
    expect(textOptions.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(textOptions[0] as HTMLElement);
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

describe('最近使用（票 04 · spec P0-4：本地记录最近执行的 5 条）', () => {
  /** 搜到指定命令并以回车执行（面板关闭即执行完成）。 */
  async function runBySearch(dialog: HTMLElement, term: string): Promise<void> {
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: term } });
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Enter' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '命令面板' })).toBeNull();
    });
  }

  it('执行过的命令在重开面板时进入「最近使用」置顶组，组内按最近序排列', async () => {
    mountPalette();
    press('/', { metaKey: true });
    await runBySearch(await screen.findByRole('dialog', { name: '命令面板' }), '矩形');
    press('/', { metaKey: true });
    await runBySearch(await screen.findByRole('dialog', { name: '命令面板' }), '文本');

    press('/', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });

    // 置顶组在前，组内最近序：文本工具（刚执行）→ 矩形工具
    const recentGroup = within(dialog)
      .getAllByRole('option')
      .slice(0, 2)
      .map((option) => option.getAttribute('data-df-command'));
    expect(recentGroup).toEqual(['tool.text', 'tool.rect']);
    expect(within(dialog).getByText('最近使用')).toBeDefined();
  });

  it('重复执行去重：同一命令在「最近使用」组里只出现一次', async () => {
    mountPalette();
    press('/', { metaKey: true });
    await runBySearch(await screen.findByRole('dialog', { name: '命令面板' }), 'zoomIn');
    press('/', { metaKey: true });
    await runBySearch(await screen.findByRole('dialog', { name: '命令面板' }), 'zoomIn');

    press('/', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });
    const zoomOptions = within(dialog).getAllByRole('option', { name: /放大/ });
    // 去重后最近组只有一行「放大」；另一行来自常规「视图」组
    expect(zoomOptions).toHaveLength(2);
    expect(zoomOptions[0]?.getAttribute('data-df-command')).toBe('view.zoomIn');
  });

  it('上限 5 条：第 6 条执行后最旧的退出「最近使用」组', async () => {
    mountPalette();
    for (const term of ['zoomIn', 'zoomOut', 'zoom100', '画板', '抓手', '矩形']) {
      press('/', { metaKey: true });
      await runBySearch(await screen.findByRole('dialog', { name: '命令面板' }), term);
    }

    press('/', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });
    const recentIds = within(dialog)
      .getAllByRole('option')
      .slice(0, 5)
      .map((option) => option.getAttribute('data-df-command'));
    expect(recentIds).toEqual([
      'tool.rect',
      'tool.hand',
      'tool.frame',
      'view.zoom100',
      'view.zoomOut',
    ]);
    // 最旧的 zoomIn 已被挤出（只剩常规视图组那一行）
    expect(within(dialog).getAllByRole('option', { name: /放大/ }).length).toBe(1);
  });

  it('本地持久：组件重挂（模拟页面切换）后记录仍在', async () => {
    const first = mountPalette();
    press('/', { metaKey: true });
    await runBySearch(await screen.findByRole('dialog', { name: '命令面板' }), '矩形');
    first.unmount();

    mountPalette();
    press('/', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });
    expect(document.querySelector('[role="option"]')?.getAttribute('data-df-command')).toBe(
      'tool.rect',
    );
    expect(within(dialog).getByText('最近使用')).toBeDefined();
  });
});
