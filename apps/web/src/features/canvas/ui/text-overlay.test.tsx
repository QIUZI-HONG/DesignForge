// @vitest-environment jsdom
/**
 * 文本内联编辑覆盖层测试（C10）：世界坐标对齐、缩放跟随、输入回灌、失焦提交、Esc 取消。
 *
 * 断言口径：DOM 可观测行为（覆盖层的几何与文本、会话状态变化），不测实现细节。
 */

import {
  createDocument,
  createIdFactory,
  createPage,
  createText,
  resolveNode,
} from '@dforge/engine';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { type CanvasSession, createCanvasSession } from '../state/session';
import { TextOverlay } from './text-overlay';

/** 建带文本节点的会话（初始视口：zoom 2、pan 40/30，便于验证坐标换算）。 */
function fixture(options: { zoom?: number; panX?: number; panY?: number } = {}): CanvasSession {
  const text = createText({
    id: 'n_text',
    x: 100,
    y: 50,
    width: 200,
    height: 24,
    rotation: 0,
    text: {
      characters: '初始',
      fontFamily: 'Noto Sans SC',
      fontSize: 14,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: 0,
      align: 'left',
      autoResize: 'none',
    },
  });
  const page = createPage({ id: 'page_1', rootIds: ['n_text'], nodes: { n_text: text } });
  return createCanvasSession({
    document: createDocument({ id: 'doc_1', pages: [page] }),
    ids: createIdFactory(1),
    viewport: { zoom: options.zoom ?? 2, panX: options.panX ?? 40, panY: options.panY ?? 30 },
  });
}

let session: CanvasSession;

beforeEach(() => {
  session = fixture();
});

describe('文本覆盖层（C10）', () => {
  it('按世界坐标 + 视口缩放/平移对齐（含字号随缩放）', () => {
    session.beginTextEditing('n_text', { selectAll: true });
    render(<TextOverlay session={session} />);
    const overlay = screen.getByRole('textbox');
    // left/top = 世界坐标 × zoom + pan；宽高与字号同样随 zoom
    expect(overlay.style.left).toBe(`${100 * 2 + 40}px`);
    expect(overlay.style.top).toBe(`${50 * 2 + 30}px`);
    expect(overlay.style.width).toBe(`${200 * 2}px`);
    expect(overlay.style.height).toBe(`${24 * 2}px`);
    expect(overlay.style.fontSize).toBe(`${14 * 2}px`);
    expect(overlay.style.lineHeight).toBe('1.4');
    expect(overlay.getAttribute('data-df-text-overlay')).toBe('n_text');
  });

  it('进入编辑即聚焦并套用会话选区（全选入口）', () => {
    session.beginTextEditing('n_text', { selectAll: true });
    render(<TextOverlay session={session} />);
    const overlay = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(overlay);
    expect(overlay.selectionStart).toBe(0);
    expect(overlay.selectionEnd).toBe(2);
  });

  it('输入回灌到引擎会话（整段替换 + 保留排版属性）', async () => {
    session.beginTextEditing('n_text', { selectAll: true });
    render(<TextOverlay session={session} />);
    const overlay = screen.getByRole('textbox');
    await userEvent.clear(overlay);
    await userEvent.type(overlay, '设界画布');
    const editing = session.store.getState().editing;
    expect(editing?.content.characters).toBe('设界画布');
    expect(editing?.content.fontSize).toBe(14);
    // 文档仍未写入（提交前）
    const node = resolveNode(session.page(), 'n_text');
    expect(node?.type === 'text' && node.text.characters).toBe('初始');
  });

  it('失焦提交：写入文档且编辑会话关闭（一条命令）', async () => {
    session.beginTextEditing('n_text', { selectAll: true });
    render(
      <>
        <TextOverlay session={session} />
        <button type="button">外侧</button>
      </>,
    );
    // 注：jsdom 不模拟「输入替换选区」，所以这里显式清空（真实浏览器里全选后直接输入即可替换）
    const overlay = screen.getByRole('textbox');
    await userEvent.clear(overlay);
    await userEvent.type(overlay, '标题');
    await userEvent.click(screen.getByRole('button', { name: '外侧' }));
    expect(session.store.getState().editing).toBeNull();
    const node = resolveNode(session.page(), 'n_text');
    expect(node?.type === 'text' && node.text.characters).toBe('标题');
  });

  it('Esc 取消：丢弃会话且不写文档（随后的 blur 不再提交）', async () => {
    session.beginTextEditing('n_text', { selectAll: true });
    render(
      <>
        <TextOverlay session={session} />
        <button type="button">外侧</button>
      </>,
    );
    await userEvent.type(screen.getByRole('textbox'), '临时');
    await userEvent.keyboard('{Escape}');
    expect(session.store.getState().editing).toBeNull();
    const node = resolveNode(session.page(), 'n_text');
    expect(node?.type === 'text' && node.text.characters).toBe('初始');
  });

  it('⌘⏎ 提交（Enter 本身换行，不提交）', async () => {
    session.beginTextEditing('n_text', { selectAll: true });
    render(<TextOverlay session={session} />);
    const overlay = screen.getByRole('textbox');
    await userEvent.type(overlay, '{Enter}第二行');
    expect(session.store.getState().editing).not.toBeNull();
    expect(session.store.getState().editing?.content.characters).toContain('\n');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(session.store.getState().editing).toBeNull();
  });

  it('未进入编辑时不渲染覆盖层', () => {
    render(<TextOverlay session={session} />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
