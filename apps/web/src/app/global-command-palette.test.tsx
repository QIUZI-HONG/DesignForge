// @vitest-environment jsdom
/**
 * 命令面板全局入口接线测试（票 04 · spec P0-4：⌘K 全局键位，⌘/ 编辑器别名）。
 *
 * 巡检断点三：清单写「任意页 ⌘K」，实现只在编辑器内 ⌘/ 可用，首页/设置按 ⌘K 无反应。
 * 修复形态：全局宿主（`GlobalCommandPalette`）挂根布局——命令 `view.commandPalette`
 * 以 ⌘K 注册（⌘/ 为编辑器别名，经 `shortcutAliases`），面板组件随宿主全路由可用。
 *
 * seam：真实路由组合——根布局（宿主挂载点）+ 首页 / 设置页 / 编辑器壳，断言可观测行为：
 * 按键 → dialog 出现与否、焦点落点、注册形状。
 */
import { ToastProvider } from '@dforge/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalCommandPalette } from '@/features/command-palette/register';
import {
  EditorShell,
  getCommand,
  resetCommandRegistry,
  useEditorUi,
  useEditorView,
} from '@/features/editor-shell';
import RootLayout from './layout';
import HomePage from './page';
import SettingsRoute from './settings/page';

// 首页/设置页的导航回调不触发（只断言 ⌘K 呼出），替身掉 Next 路由运行时。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

/** 设置页数据面挂起（停在 loading 态，不真实出网）。 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCommandRegistry();
  useEditorUi.setState({ commandPaletteOpen: false, shortcutsOpen: false });
  useEditorView.setState({ zoom: 1, activeTool: 'move' });
  window.localStorage.clear();
});

/** 在 window 上按一次键（全局派发入口）。 */
function press(key: string, options: KeyboardEventInit = {}): void {
  fireEvent.keyDown(window, { key, ...options });
}

describe('根布局全局宿主（任意路由共享的注册点）', () => {
  it('渲染根布局后 view.commandPalette 以 ⌘K 注册，⌘/ 为编辑器别名', () => {
    render(
      <RootLayout>
        <span>页面</span>
      </RootLayout>,
    );

    const command = getCommand('view.commandPalette');
    expect(command).toBeDefined();
    expect(command?.shortcut).toBe('⌘K');
    expect(command?.shortcutAliases).toEqual(['⌘/']);
  });
});

describe('首页（/）与设置页（/settings）· ⌘K 呼出', () => {
  it('首页按 ⌘K 呼出命令面板，焦点落入搜索框；Esc 关闭', async () => {
    // 根布局给全树包 ToastProvider（首页消费 useToast）；宿主同层，组合与真实布局一致
    render(
      <ToastProvider>
        <HomePage />
        <GlobalCommandPalette />
      </ToastProvider>,
    );

    press('k', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });
    expect(document.activeElement).toBe(within(dialog).getByRole('combobox'));

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '命令面板' })).toBeNull();
    });
  });

  it('首页按 ⌘/ 不响应（编辑器别名不外溢）', async () => {
    render(
      <ToastProvider>
        <HomePage />
        <GlobalCommandPalette />
      </ToastProvider>,
    );

    press('/', { metaKey: true });
    expect(screen.queryByRole('dialog', { name: '命令面板' })).toBeNull();
  });

  it('设置页按 ⌘K 呼出命令面板（Windows 口径：Ctrl+K 同样生效）', async () => {
    render(
      <>
        <SettingsRoute />
        <GlobalCommandPalette />
      </>,
    );

    press('k', { ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: '命令面板' })).toBeDefined();
  });
});

describe('编辑器（/editor）· ⌘K 全局 + ⌘/ 别名并存', () => {
  /** 编辑器真实接线形态：壳层（全局派发）+ 根布局全局宿主。 */
  function mountEditor() {
    return render(
      <>
        <EditorShell />
        <GlobalCommandPalette />
      </>,
    );
  }

  it('⌘K 呼出命令面板', async () => {
    mountEditor();
    press('k', { metaKey: true });
    expect(await screen.findByRole('dialog', { name: '命令面板' })).toBeDefined();
  });

  it('⌘/ 保留为编辑器别名（与全局 ⌘K 同一命令）', async () => {
    mountEditor();
    press('/', { metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });
    expect(document.activeElement).toBe(within(dialog).getByRole('combobox'));
  });

  it('面板开着时 ⌘K 不再派发（浮层占键盘时全局派发让路，Esc 归浮层）', async () => {
    mountEditor();
    press('k', { metaKey: true });
    await screen.findByRole('dialog', { name: '命令面板' });

    press('k', { metaKey: true });
    expect(screen.queryByRole('dialog', { name: '命令面板' })).not.toBeNull();
  });
});
