/**
 * 快捷键分发表测试：命中、抑制、以及「说明表可派生」（FE-03/FE-08 复用）。
 */

import {
  createDocument,
  createIdFactory,
  createPage,
  createRect,
  createText,
} from '@dforge/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type CanvasSession, createCanvasSession } from '../state/session';
import {
  handleKeyDown,
  handleSpaceDown,
  handleSpaceUp,
  type KeyInput,
  SHORTCUTS,
  type ShortcutContext,
  shortcutTable,
} from './keyboard';

const CONTEXT: ShortcutContext = {
  screenSize: { width: 800, height: 600 },
  screenCenter: { x: 400, y: 300 },
};

/** 纯查表：命中的快捷键 id（不执行副作用；用于「分派是否正确」的断言）。 */
function matchedId(input: KeyInput): string | null {
  return SHORTCUTS.find((shortcut) => shortcut.match(input))?.id ?? null;
}

/** 造按键输入。 */
function key(keyName: string, options: Partial<Omit<KeyInput, 'key'>> = {}): KeyInput {
  return {
    key: keyName,
    meta: options.meta ?? false,
    ctrl: options.ctrl ?? false,
    shift: options.shift ?? false,
    alt: options.alt ?? false,
  };
}

function fixture(): CanvasSession {
  const rect = createRect({ id: 'n_rect', x: 0, y: 0, width: 10, height: 10 });
  const rect2 = createRect({ id: 'n_rect2', x: 20, y: 0, width: 10, height: 10 });
  const text = createText({ id: 'n_text', x: 0, y: 40, width: 60, height: 16 });
  const page = createPage({
    id: 'page_1',
    rootIds: ['n_rect', 'n_rect2', 'n_text'],
    nodes: { n_rect: rect, n_rect2: rect2, n_text: text },
  });
  return createCanvasSession({
    document: createDocument({ id: 'doc_1', pages: [page] }),
    ids: createIdFactory(10),
    snapEnabled: false,
  });
}

let session: CanvasSession;
beforeEach(() => {
  session = fixture();
});

describe('快捷键分派', () => {
  it('Ctrl 与 ⌘ 等价（Linux/Windows 无 ⌘ 键，CI 必须能用）', () => {
    session.setSelection(['n_rect']);
    const metaResult = handleKeyDown(session, key('c', { meta: true }), CONTEXT);
    expect(metaResult).toBe('copy');
    const ctrlResult = handleKeyDown(session, key('c', { ctrl: true }), CONTEXT);
    expect(ctrlResult).toBe('copy');
  });

  it('未修饰的字母键不劫持（避免吞掉输入）', () => {
    expect(handleKeyDown(session, key('c'), CONTEXT)).toBeNull();
    expect(handleKeyDown(session, key('g'), CONTEXT)).toBeNull();
  });

  it('撤销/重做：⌘Z 与 ⇧⌘Z 分派到不同动作', () => {
    session.setSelection(['n_rect']);
    session.nudge(5, 0);
    expect(handleKeyDown(session, key('z', { meta: true }), CONTEXT)).toBe('undo');
    expect(session.page().nodes.n_rect?.x).toBe(0);
    expect(handleKeyDown(session, key('z', { meta: true, shift: true }), CONTEXT)).toBe('redo');
    expect(session.page().nodes.n_rect?.x).toBe(5);
  });

  it('层级：⌘] / ⌘[ / ⇧⌘] / ⇧⌘[ 四个方向各就各位', () => {
    session.setSelection(['n_rect']);
    const indexOf = (): number => session.page().rootIds.indexOf('n_rect');
    const count = (): number => session.page().rootIds.length;
    expect(handleKeyDown(session, key(']', { meta: true }), CONTEXT)).toBe('bringForward');
    expect(indexOf()).toBe(1);
    expect(handleKeyDown(session, key('[', { meta: true }), CONTEXT)).toBe('sendBackward');
    expect(indexOf()).toBe(0);
    expect(handleKeyDown(session, key(']', { meta: true, shift: true }), CONTEXT)).toBe(
      'bringToFront',
    );
    expect(indexOf()).toBe(count() - 1);
    expect(handleKeyDown(session, key('[', { meta: true, shift: true }), CONTEXT)).toBe(
      'sendToBack',
    );
    expect(indexOf()).toBe(0);
  });

  it('编组/解组：⌘G / ⇧⌘G', () => {
    session.setSelection(['n_rect', 'n_rect2']);
    expect(handleKeyDown(session, key('g', { meta: true }), CONTEXT)).toBe('group');
    const groupId = session.selection().ids[0] as string;
    expect(session.page().nodes[groupId]?.type).toBe('group');
    expect(handleKeyDown(session, key('g', { meta: true, shift: true }), CONTEXT)).toBe('ungroup');
    expect(session.page().nodes[groupId]).toBeUndefined();
  });

  it('复制/粘贴/副本：⌘C 后 ⌘V 得到新对象，⌘D 原地副本', async () => {
    session.setSelection(['n_rect']);
    // 分派正确性（纯查表，不执行副作用）
    expect(matchedId(key('c', { meta: true }))).toBe('copy');
    expect(matchedId(key('v', { meta: true }))).toBe('paste');
    expect(matchedId(key('d', { meta: true }))).toBe('duplicate');
    // 行为：复制 → 粘贴 → 副本
    handleKeyDown(session, key('c', { meta: true }), CONTEXT);
    const before = Object.keys(session.page().nodes).length;
    await session.paste();
    expect(Object.keys(session.page().nodes).length).toBe(before + 1);
    session.duplicate();
    expect(Object.keys(session.page().nodes).length).toBe(before + 2);
  });

  it('空格：按下/松开切换临时手型（编辑中不劫持）', () => {
    handleSpaceDown(session);
    expect(session.store.getState().spacePressed).toBe(true);
    handleSpaceUp(session);
    expect(session.store.getState().spacePressed).toBe(false);
  });

  it('Esc 优先级：文本编辑 > 交互 > 清空选择', () => {
    session.setSelection(['n_text']);
    session.beginTextEditing('n_text');
    expect(session.store.getState().editing?.nodeId).toBe('n_text');
    handleKeyDown(session, key('Escape'), CONTEXT);
    expect(session.store.getState().editing).toBeNull();
    expect(session.selection().ids).toEqual(['n_text']);

    handleKeyDown(session, key('Escape'), CONTEXT);
    expect(session.selection().ids).toEqual([]);
  });

  it('文本编辑中只放行 Esc，其余按键交给输入框', () => {
    session.beginTextEditing('n_text');
    expect(handleKeyDown(session, key('c', { meta: true }), CONTEXT)).toBeNull();
    expect(handleKeyDown(session, key('z', { meta: true }), CONTEXT)).toBeNull();
    expect(handleKeyDown(session, key('Escape'), CONTEXT)).toBe('cancel');
  });

  it('⇧R 切换标尺、⇧1 适应画布', () => {
    expect(handleKeyDown(session, key('R', { shift: true }), CONTEXT)).toBe('toggleRulers');
    expect(session.store.getState().rulers).toBe(false);
    expect(handleKeyDown(session, key('1', { shift: true }), CONTEXT)).toBe('zoomFit');
  });

  it('说明表可派生且条目完整（每条都有 i18n 键与展示串）', () => {
    const table = shortcutTable();
    expect(table).toHaveLength(SHORTCUTS.length);
    for (const entry of table) {
      expect(entry.labelKey.startsWith('canvas.action.')).toBe(true);
      expect(entry.display.length).toBeGreaterThan(0);
    }
    // 13 类白名单覆盖度自检：每类至少有一个入口（选择/平移由指针与空格覆盖）
    const ids = new Set(table.map((entry) => entry.id));
    for (const required of [
      'copy',
      'paste',
      'duplicate',
      'delete',
      'group',
      'ungroup',
      'bringForward',
      'sendBackward',
      'undo',
      'redo',
      'zoomIn',
      'zoomOut',
      'zoomReset',
      'nudge',
      'editText',
      'cancel',
    ]) {
      expect(ids.has(required), `缺少快捷键条目：${required}`).toBe(true);
    }
  });

  it('Alt 组合不误触（保留给 Inspector 等）', () => {
    const spy = vi.spyOn(session, 'copy');
    expect(handleKeyDown(session, key('c', { meta: true, alt: true }), CONTEXT)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
