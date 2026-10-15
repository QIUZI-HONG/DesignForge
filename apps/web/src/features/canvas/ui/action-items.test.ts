/**
 * 动作清单测试（C9 工具条 / C11 右键菜单同源）：条目、可用性、快捷键右对齐的展示串。
 */

import { createDocument, createIdFactory, createPage, createRect } from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { type CanvasSession, createCanvasSession } from '../state/session';
import {
  canvasActions,
  contextMenuSections,
  shortcutDisplay,
  TOOLBAR_ACTION_IDS,
  type Translate,
} from './action-items';

/** 假 i18n：直接回键名（断言用，避免把文案锁死在测试里）。 */
const t: Translate = (key) => key;

function fixture(): CanvasSession {
  const rect = createRect({ id: 'n_rect', x: 0, y: 0, width: 40, height: 40 });
  const rect2 = createRect({ id: 'n_rect2', x: 80, y: 0, width: 40, height: 40 });
  const page = createPage({
    id: 'page_1',
    rootIds: ['n_rect', 'n_rect2'],
    nodes: { n_rect: rect, n_rect2: rect2 },
  });
  return createCanvasSession({
    document: createDocument({ id: 'doc_1', pages: [page] }),
    ids: createIdFactory(5),
  });
}

describe('快捷键展示串', () => {
  it('取自快捷键分发表（菜单右侧的键位不会与实际键位漂移）', () => {
    expect(shortcutDisplay('copy')).toBe('⌘C');
    expect(shortcutDisplay('undo')).toBe('⌘Z');
    expect(shortcutDisplay('group')).toBe('⌘G');
    expect(shortcutDisplay('nudge')).toBe('↑↓←→');
    expect(shortcutDisplay('不存在的动作')).toBeUndefined();
  });
});

describe('动作可用性（空选 / 单选 / 多选）', () => {
  it('空选：删除/复制/层级/对齐不可用；粘贴与视图动作可用', () => {
    const session = fixture();
    const actions = canvasActions(session, t);
    const byId = new Map(actions.map((action) => [action.id, action]));
    expect(byId.get('delete')?.disabled).toBe(true);
    expect(byId.get('copy')?.disabled).toBe(true);
    expect(byId.get('bringForward')?.disabled).toBe(true);
    expect(byId.get('alignLeft')?.disabled).toBe(true);
    expect(byId.get('paste')?.disabled).toBe(false);
    expect(byId.get('zoomFit')?.disabled).toBe(false);
    expect(byId.get('toggleRulers')?.disabled).toBe(false);
  });

  it('单选：对齐/分布/编组不可用，编辑文本只对文本节点可用', () => {
    const session = fixture();
    session.setSelection(['n_rect']);
    const byId = new Map(canvasActions(session, t).map((action) => [action.id, action]));
    expect(byId.get('alignLeft')?.disabled).toBe(true);
    expect(byId.get('distributeHorizontal')?.disabled).toBe(true);
    expect(byId.get('group')?.disabled).toBe(true);
    expect(byId.get('delete')?.disabled).toBe(false);
    expect(byId.get('editText')?.disabled).toBe(true); // 矩形不是文本
  });

  it('多选：对齐可用、分布需要 ≥3；编组可用', () => {
    const session = fixture();
    session.setSelection(['n_rect', 'n_rect2']);
    const byId = new Map(canvasActions(session, t).map((action) => [action.id, action]));
    expect(byId.get('alignLeft')?.disabled).toBe(false);
    expect(byId.get('distributeHorizontal')?.disabled).toBe(true);
    expect(byId.get('group')?.disabled).toBe(false);
  });

  it('文本节点单选：编辑文本可用', () => {
    const session = fixture();
    const textId = session.createTextAt({ x: 200, y: 200 });
    session.setSelection([textId]);
    const byId = new Map(canvasActions(session, t).map((action) => [action.id, action]));
    expect(byId.get('editText')?.disabled).toBe(false);
  });
});

describe('动作执行（工具条与菜单共用执行体）', () => {
  it('复制 → 粘贴 → 删除按选择集生效', async () => {
    const session = fixture();
    session.setSelection(['n_rect']);
    const byId = new Map(canvasActions(session, t).map((action) => [action.id, action]));
    byId.get('copy')?.run();
    await session.paste();
    expect(Object.keys(session.page().nodes)).toHaveLength(3);
    byId.get('delete')?.run();
    expect(Object.keys(session.page().nodes)).toHaveLength(2);
  });

  it('层级动作按方向生效（上移一层 / 置于顶层）', () => {
    const session = fixture();
    session.setSelection(['n_rect']);
    const byId = new Map(canvasActions(session, t).map((action) => [action.id, action]));
    byId.get('bringForward')?.run();
    expect(session.page().rootIds.indexOf('n_rect')).toBe(1);
    byId.get('bringToFront')?.run();
    expect(session.page().rootIds.indexOf('n_rect')).toBe(1);
    byId.get('sendToBack')?.run();
    expect(session.page().rootIds.indexOf('n_rect')).toBe(0);
  });

  it('视图动作切换标尺并重置缩放', () => {
    const session = fixture();
    const byId = new Map(canvasActions(session, t).map((action) => [action.id, action]));
    const rulersBefore = session.store.getState().rulers;
    byId.get('toggleRulers')?.run();
    expect(session.store.getState().rulers).toBe(!rulersBefore);
    session.zoomIn({ x: 0, y: 0 });
    byId.get('zoomReset')?.run();
    expect(session.viewport().zoom).toBe(1);
  });
});

describe('C11 菜单分组', () => {
  it('分组齐全且每组条目非空、快捷键随条目带出', () => {
    const session = fixture();
    session.setSelection(['n_rect', 'n_rect2']);
    const sections = contextMenuSections(session, t);
    const ids = sections.map((section) => section.id);
    expect(ids).toEqual(['edit', 'clipboard', 'arrange', 'align', 'view']);
    for (const section of sections) {
      expect(section.items.length).toBeGreaterThan(0);
      expect(section.label).toBe(`canvas.menu.section.${section.id}`);
    }
    const clipboard = sections.find((section) => section.id === 'clipboard');
    const copy = clipboard?.items.find((item) => item.id === 'copy');
    expect(copy?.shortcut).toBe('⌘C');
    const arrange = sections.find((section) => section.id === 'arrange');
    expect(arrange?.items.find((item) => item.id === 'bringForward')?.shortcut).toBe('⌘]');
    const del = clipboard?.items.find((item) => item.id === 'delete');
    expect(del?.danger).toBe(true);
  });

  it('工具条子集都在动作表里（避免两处硬编码漂移）', () => {
    const session = fixture();
    const ids = new Set(canvasActions(session, t).map((action) => action.id));
    for (const id of TOOLBAR_ACTION_IDS) expect(ids.has(id), `工具条动作缺失：${id}`).toBe(true);
  });
});
