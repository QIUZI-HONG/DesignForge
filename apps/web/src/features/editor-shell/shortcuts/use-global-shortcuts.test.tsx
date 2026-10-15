// @vitest-environment jsdom
/**
 * 全局快捷键派发行为测试（E8 键盘可达半边）。
 *
 * 断言的是「按键 → 命令」的可观测链路与保护规则：
 * 命中即执行并阻止默认、输入区不打单键工具、浮层打开时让路、置灰命令不吞键。
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerCommand, resetCommandRegistry } from '../commands/registry';
import { useEditorUi } from '../state/ui';
import { useGlobalShortcuts } from './use-global-shortcuts';

/** 挂载派发器的探针组件。 */
function Dispatcher() {
  useGlobalShortcuts();
  return <input data-testid="field" />;
}

/** 在 window 上派发一次 keydown。 */
function press(
  key: string,
  options: KeyboardEventInit = {},
  target: EventTarget = window,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

/** 让 effect/命令的微任务结算。 */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  cleanup();
  resetCommandRegistry();
  useEditorUi.setState({ commandPaletteOpen: false, shortcutsOpen: false });
});

describe('useGlobalShortcuts', () => {
  it('⌘K 命中命令面板命令并阻止默认行为', async () => {
    const run = vi.fn();
    registerCommand({
      id: 'view.commandPalette',
      title: '命令面板',
      group: '视图',
      shortcut: '⌘K',
      run,
    });
    render(<Dispatcher />);

    const event = press('k', { metaKey: true });
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Windows 上 Ctrl 等价于 ⌘（同一份快捷键表跨平台）', async () => {
    const run = vi.fn();
    registerCommand({ id: 'x', title: 'X', group: '视图', shortcut: '⌘K', run });
    render(<Dispatcher />);
    press('k', { ctrlKey: true });
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('单键工具在输入区内不派发（搜索框里打 v 只能是输入 v）', async () => {
    const run = vi.fn();
    registerCommand({ id: 'tool.move', title: '移动工具', group: '工具', shortcut: 'V', run });
    const { getByTestId } = render(<Dispatcher />);
    const field = getByTestId('field');

    field.focus();
    press('v', {}, field);
    await settle();
    expect(run).not.toHaveBeenCalled();

    // 同一按键在非输入区（画布侧）照常派发
    press('v', {}, window);
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('浮层占键盘时全局派发让路（Esc 归浮层）', async () => {
    const run = vi.fn();
    registerCommand({ id: 'x', title: 'X', group: '视图', shortcut: '⌘K', run });
    render(<Dispatcher />);

    useEditorUi.setState({ commandPaletteOpen: true });
    press('k', { metaKey: true });
    await settle();
    expect(run).not.toHaveBeenCalled();
  });

  it('置灰命令不吞键（继续找后续命令，都不命中则放行）', async () => {
    const disabled = vi.fn();
    const enabled = vi.fn();
    registerCommand({
      id: 'a',
      title: 'A',
      group: '工具',
      shortcut: 'V',
      enabled: () => false,
      run: disabled,
    });
    registerCommand({ id: 'b', title: 'B', group: '工具', shortcut: 'V', run: enabled });
    render(<Dispatcher />);

    press('v');
    await settle();
    expect(disabled).not.toHaveBeenCalled();
    expect(enabled).toHaveBeenCalledTimes(1);
  });

  it('命令抛错被收口（不炸渲染树，不阻断其它快捷键）', async () => {
    registerCommand({
      id: 'boom',
      title: '炸',
      group: '工具',
      shortcut: 'V',
      run: () => {
        throw new Error('炸了');
      },
    });
    const after = vi.fn();
    registerCommand({ id: 'after', title: '后续', group: '视图', shortcut: '⌘K', run: after });
    render(<Dispatcher />);

    press('v');
    await settle();
    press('k', { metaKey: true });
    await settle();
    expect(after).toHaveBeenCalledTimes(1);
  });
});
