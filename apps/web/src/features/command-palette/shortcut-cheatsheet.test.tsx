// @vitest-environment jsdom
/**
 * 快捷键速查浮层测试（工单 08）。
 *
 * 口径（期望值独立给出，时间阈值 400ms 是写死在断言里的独立事实）：
 * - **长按**修饰键（≥400ms）才显示——组合键（⌘Z/⌘/ 这类先修饰后击键）不闪卡；
 * - **松开即消失**（修饰键全部松开、窗口失焦）；
 * - 浮层随上下文：画布（全部键位）/ 文本编辑（只留带修饰键的）/ 面板（面板导航键位）；
 * - **不抢焦点**：浮层无焦点语义（无控件、不改 activeElement、pointer-events 关），
 *   与命令面板互不抢焦点。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerCommand, resetCommandRegistry, useEditorUi } from '../editor-shell';
import { ShortcutCheatSheetSlot } from './register';

beforeEach(() => {
  resetCommandRegistry();
  useEditorUi.setState({ commandPaletteOpen: false, shortcutsOpen: false });
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetCommandRegistry();
  useEditorUi.setState({ commandPaletteOpen: false, shortcutsOpen: false });
});

/** 注册两条键位形态不同的命令（单键 V vs 修饰键 ⌘Z）。 */
function seedCommands(): void {
  act(() => {
    registerCommand({ id: 'tool.move', title: '移动工具', group: '工具', shortcut: 'V', run: () => undefined });
    registerCommand({ id: 'edit.undo', title: '撤销', group: '编辑', shortcut: '⌘Z', run: () => undefined });
  });
}

describe('显隐（长按修饰键）', () => {
  it('按住不足阈值不显示；达到阈值（400ms）显示', () => {
    seedCommands();
    render(<ShortcutCheatSheetSlot />);

    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(screen.queryByRole('dialog', { name: '快捷键速查' })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('dialog', { name: '快捷键速查' })).toBeDefined();
  });

  it('松开修饰键立即消失', () => {
    seedCommands();
    render(<ShortcutCheatSheetSlot />);

    fireEvent.keyDown(window, { key: 'Meta', metaKey: true });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole('dialog', { name: '快捷键速查' })).toBeDefined();

    fireEvent.keyUp(window, { key: 'Meta', metaKey: false });
    expect(screen.queryByRole('dialog', { name: '快捷键速查' })).toBeNull();
  });

  it('组合键不闪卡：按住后先击了别的键，速查卡不出（面板/快捷键不受影响）', () => {
    seedCommands();
    render(<ShortcutCheatSheetSlot />);

    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole('dialog', { name: '快捷键速查' })).toBeNull();
  });

  it('窗口失焦即消失（按住期间切走不残留浮层）', () => {
    seedCommands();
    render(<ShortcutCheatSheetSlot />);

    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole('dialog', { name: '快捷键速查' })).toBeDefined();

    fireEvent.blur(window);
    expect(screen.queryByRole('dialog', { name: '快捷键速查' })).toBeNull();
  });
});

describe('随上下文显示键位（画布 / 文本编辑 / 面板）', () => {
  it('画布上下文：全部键位按分组展示（含单键工具键）', () => {
    seedCommands();
    render(<ShortcutCheatSheetSlot />);

    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const card = screen.getByRole('dialog', { name: '快捷键速查' });
    expect(card.getAttribute('data-df-context')).toBe('canvas');
    expect(card.textContent).toContain('移动工具');
    expect(card.textContent).toContain('V');
    expect(card.textContent).toContain('撤销');
    expect(card.textContent).toContain('⌘Z');
  });

  it('文本编辑上下文：只显示带修饰键的键位（单键在输入区不派发，卡上不撒谎）', () => {
    seedCommands();
    render(<ShortcutCheatSheetSlot />);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const card = screen.getByRole('dialog', { name: '快捷键速查' });
    expect(card.getAttribute('data-df-context')).toBe('text');
    expect(card.textContent).toContain('撤销');
    expect(card.textContent).not.toContain('移动工具');

    input.remove();
  });

  it('面板上下文：命令面板开着时长按，显示面板导航键位', () => {
    act(() => {
      useEditorUi.getState().setCommandPaletteOpen(true);
    });
    render(<ShortcutCheatSheetSlot />);

    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const card = screen.getByRole('dialog', { name: '快捷键速查' });
    expect(card.getAttribute('data-df-context')).toBe('palette');
    expect(card.textContent).toContain('选择命令');
    expect(card.textContent).toContain('执行命令');
    expect(card.textContent).toContain('关闭面板');
  });
});

describe('与面板互不抢焦点', () => {
  it('浮层不夺焦点：显示期间 activeElement 不变，卡内无任何可聚焦控件', () => {
    seedCommands();
    render(<ShortcutCheatSheetSlot />);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const card = screen.getByRole('dialog', { name: '快捷键速查' });

    expect(document.activeElement).toBe(input);
    expect(card.querySelectorAll('button, input, textarea, select, [tabindex]')).toHaveLength(0);

    input.remove();
  });
});
