// @vitest-environment jsdom
/**
 * 画布舞台键盘 a11y（票 10 · 报告 §E3）：交互控件焦点下，激活键放行、快捷键不劫持。
 *
 * 缺陷本体：canvas-stage 的 document 级 keydown 守卫只有 INPUT/TEXTAREA——
 * 焦点在 BUTTON/A/SELECT 上按空格 → preventDefault 吞掉按钮激活且画布进平移预备；
 * 按 Enter → 误触 editText 快捷键。键盘用户对画布内按钮两条激活键全断。
 *
 * 断言口径：真实挂载 CanvasStage（CanvasKit 桩住永不 resolve——键盘接线与渲染解耦），
 * userEvent 走真实键盘序列断言「按钮原生激活（click 分发）+ 会话状态」；
 * 画布本体的既有口径与组合键不回归用 fireEvent 精确注入。
 */

import {
  createDocument,
  createIdFactory,
  createPage,
  createRect,
  createText,
} from '@dforge/engine';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type CanvasSession, createCanvasSession } from '../state/session';
import { CanvasStage } from './canvas-stage';

// jsdom 无 WebGL/CanvasKit：桩住加载器（永不 resolve），键盘接线独立于渲染可测
vi.mock('../runtime/canvaskit-loader', () => ({
  loadCanvasKit: () => new Promise<never>(() => {}),
}));

/** 建带矩形 + 文本节点的会话。 */
function fixture(): CanvasSession {
  const rect = createRect({ id: 'n_rect', x: 0, y: 0, width: 10, height: 10 });
  const text = createText({ id: 'n_text', x: 0, y: 40, width: 60, height: 16 });
  const page = createPage({
    id: 'page_1',
    rootIds: ['n_rect', 'n_text'],
    nodes: { n_rect: rect, n_text: text },
  });
  return createCanvasSession({
    document: createDocument({ id: 'doc_1', pages: [page] }),
    ids: createIdFactory(10),
  });
}

let session: CanvasSession;

beforeEach(() => {
  session = fixture();
  session.setSelection(['n_text']);
});

describe('画布舞台键盘 a11y（交互控件焦点下激活键放行）', () => {
  it('焦点在工具条按钮上按空格：按钮原生激活（删除生效），不进平移预备', async () => {
    const user = userEvent.setup();
    render(<CanvasStage session={session} />);
    const del = screen.getByRole('button', { name: '删除' });
    const clicks = vi.fn();
    del.addEventListener('click', clicks);
    del.focus();
    await user.keyboard(' ');
    // 空格没有进画布平移预备（劫持缺陷回归时这里红）
    expect(session.store.getState().spacePressed).toBe(false);
    // 按钮被原生激活：click 分发 → 删除执行
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(session.page().nodes.n_text).toBeUndefined();
  });

  it('焦点在工具条按钮上按 Enter：按钮激活、不误触「编辑文本」快捷键', async () => {
    const user = userEvent.setup();
    render(<CanvasStage session={session} />);
    const del = screen.getByRole('button', { name: '删除' });
    const clicks = vi.fn();
    del.addEventListener('click', clicks);
    del.focus();
    await user.keyboard('{Enter}');
    // Enter 没被劫持去开文本编辑（§E3 验证者新发现：Enter 误触 editText）
    expect(session.store.getState().editing).toBeNull();
    // 按钮原生激活 → 删除执行
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(session.page().nodes.n_text).toBeUndefined();
  });

  it('contentEditable 焦点：空格/Enter 全放行（不进平移预备、不误触 editText）', async () => {
    const user = userEvent.setup();
    render(<CanvasStage session={session} />);
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.append(editable);
    editable.focus();
    await user.keyboard(' ');
    expect(session.store.getState().spacePressed).toBe(false);
    await user.keyboard('{Enter}');
    expect(session.store.getState().editing).toBeNull();
    editable.remove();
  });

  it('按钮焦点下 ⌘Z 仍走画布分派（放行只针对激活键，组合键不回归）', () => {
    render(<CanvasStage session={session} />);
    session.setSelection(['n_rect']);
    const del = screen.getByRole('button', { name: '删除' });
    del.focus();
    session.nudge(5, 0);
    expect(session.page().nodes.n_rect?.x).toBe(5);
    fireEvent.keyDown(del, { key: 'z', metaKey: true });
    expect(session.page().nodes.n_rect?.x).toBe(0);
  });

  it('画布本体焦点口径不变：空格仍进平移预备（既有行为不回归）', () => {
    render(<CanvasStage session={session} />);
    const shell = document.querySelector('[data-df-canvas-shell]');
    expect(shell).not.toBeNull();
    fireEvent.keyDown(shell as HTMLElement, { key: ' ' });
    expect(session.store.getState().spacePressed).toBe(true);
    fireEvent.keyUp(document.body, { key: ' ' });
    expect(session.store.getState().spacePressed).toBe(false);
  });
});
