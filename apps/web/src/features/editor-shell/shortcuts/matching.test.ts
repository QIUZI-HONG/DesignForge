// @vitest-environment jsdom
/**
 * 快捷键解析与匹配测试（纯逻辑 + 可编辑区判定）。
 *
 * 期望值来自 Figma 本体中文界面的快捷键口径（briefs/fe-03.md §1：E7/E8），
 * 不从实现反推：例如 `⌘+` 在美式布局下报 `key='+'`、部分布局报 `'='`，两者都必须命中。
 */
import { describe, expect, it } from 'vitest';

import { hasModifier, isEditableTarget, matchesShortcut, parseShortcut } from './matching';

/** 造一个键盘事件形状。 */
function event(
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>> = {},
) {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

describe('parseShortcut', () => {
  it('解析符号修饰键与末位键', () => {
    expect(parseShortcut('⌘K')).toEqual({ keys: ['k'], meta: true, shift: false, alt: false });
    expect(parseShortcut('⇧⌘Z')).toEqual({ keys: ['z'], meta: true, shift: true, alt: false });
    expect(parseShortcut('⌥⌘K')).toEqual({ keys: ['k'], meta: true, shift: false, alt: true });
  });

  it('解析字母类修饰词（含 + 分隔）', () => {
    expect(parseShortcut('Cmd+K')).toEqual({ keys: ['k'], meta: true, shift: false, alt: false });
    expect(parseShortcut('Ctrl+Shift+K')).toEqual({
      keys: ['k'],
      meta: true,
      shift: true,
      alt: false,
    });
    expect(parseShortcut('Meta+Shift+0')).toEqual({
      keys: ['0'],
      meta: true,
      shift: true,
      alt: false,
    });
    expect(parseShortcut('Shift0')).toEqual({ keys: ['0'], meta: false, shift: true, alt: false });
  });

  it('无修饰键的单键（工具键）', () => {
    expect(parseShortcut('V')).toEqual({ keys: ['v'], meta: false, shift: false, alt: false });
    expect(parseShortcut('H')).toEqual({ keys: ['h'], meta: false, shift: false, alt: false });
  });

  it('符号键与别名', () => {
    expect(parseShortcut('⌘/')).toEqual({ keys: ['/'], meta: true, shift: false, alt: false });
    expect(parseShortcut('⌘+')).toEqual({ keys: ['+', '='], meta: true, shift: false, alt: false });
    expect(parseShortcut('⌘=')).toEqual({ keys: ['+', '='], meta: true, shift: false, alt: false });
    expect(parseShortcut('⌘-')).toEqual({ keys: ['-', '_'], meta: true, shift: false, alt: false });
    expect(parseShortcut('⌘]')).toEqual({ keys: [']'], meta: true, shift: false, alt: false });
  });

  it('空串与「只有修饰词」返回 null', () => {
    expect(parseShortcut('')).toBeNull();
    expect(parseShortcut('   ')).toBeNull();
    expect(parseShortcut('⌘')).toBeNull();
    expect(parseShortcut('Shift')).toBeNull();
  });

  it('修饰词后的尾随 + 视为「加号键」而非分隔符（⌘+ 与 Cmd+ 同解）', () => {
    expect(parseShortcut('Cmd+')).toEqual({
      keys: ['+', '='],
      meta: true,
      shift: false,
      alt: false,
    });
    expect(parseShortcut('Ctrl++')).toEqual({
      keys: ['+', '='],
      meta: true,
      shift: false,
      alt: false,
    });
  });

  it('hasModifier 区分有无修饰键', () => {
    expect(hasModifier(parseShortcut('⌘K') as never)).toBe(true);
    expect(hasModifier(parseShortcut('V') as never)).toBe(false);
  });
});

describe('matchesShortcut', () => {
  it('⌘ 认 Meta（mac）与 Ctrl（Windows/Linux）两者', () => {
    const parsed = parseShortcut('⌘K') as never;
    expect(matchesShortcut(event('k', { metaKey: true }), parsed)).toBe(true);
    expect(matchesShortcut(event('k', { ctrlKey: true }), parsed)).toBe(true);
    expect(matchesShortcut(event('k'), parsed)).toBe(false);
  });

  it('末位键大小写不敏感，Shift 精确匹配', () => {
    const redo = parseShortcut('⇧⌘Z') as never;
    expect(matchesShortcut(event('z', { metaKey: true, shiftKey: true }), redo)).toBe(true);
    expect(matchesShortcut(event('Z', { metaKey: true, shiftKey: true }), redo)).toBe(true);
    expect(matchesShortcut(event('z', { metaKey: true }), redo)).toBe(false);
  });

  it('多按修饰键不算命中（精确匹配，避免误触）', () => {
    const palette = parseShortcut('⌘K') as never;
    expect(matchesShortcut(event('k', { metaKey: true, altKey: true }), palette)).toBe(false);
    expect(matchesShortcut(event('k', { metaKey: true, shiftKey: true }), palette)).toBe(false);
  });

  it("⌘+ 在 `key='+'` 与 `key='='` 两种报法下都命中", () => {
    const zoomIn = parseShortcut('⌘+') as never;
    expect(matchesShortcut(event('+', { metaKey: true, shiftKey: true }), zoomIn)).toBe(true);
    expect(matchesShortcut(event('=', { metaKey: true }), zoomIn)).toBe(true);
    expect(matchesShortcut(event('=', { ctrlKey: true }), zoomIn)).toBe(true);
  });

  it('⇧0 命中 Shift+0（100% 视图口径）', () => {
    const zoom100 = parseShortcut('⇧0') as never;
    expect(matchesShortcut(event('0', { shiftKey: true }), zoom100)).toBe(true);
    expect(matchesShortcut(event('0'), zoom100)).toBe(false);
  });
});

describe('isEditableTarget', () => {
  it('输入框/文本域/下拉/内容可编辑为可编辑区', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const plain = document.createElement('div');

    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(textarea)).toBe(true);
    expect(isEditableTarget(select)).toBe(true);
    expect(isEditableTarget(editable)).toBe(true);
    expect(isEditableTarget(plain)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('按钮类 input 与按钮不算文字输入区（不能拦掉 V/F 等工具键）', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const submit = document.createElement('input');
    submit.type = 'submit';
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(submit)).toBe(false);
  });
});
