// @vitest-environment jsdom
/**
 * 文本内联编辑进入路径测试（票 13 / spec P2 画布项）：**双击路径与 Enter 路径行为一致**。
 *
 * 断言口径（spec「Testing Decisions」：只测外部行为）：
 * - 双击 = 真实 DOM 事件序列（pointerdown/up ×2 + dblclick，与浏览器派发次序一致）经
 *   `attachPointerAdapter` 进入会话——而不是直接调 `session.beginTextEditing`（那跳过了
 *   巡检翻车的 DOM 接线层）；
 * - 覆盖层出现在正确世界坐标（世界 × zoom + pan，与 `text-overlay.test.tsx` 同一口径）；
 * - Enter 路径（快捷键 `editText`）与双击路径进入**同一个**编辑态（同 nodeId、同覆盖层挂点）。
 */

import {
  createDocument,
  createIdFactory,
  createPage,
  createText,
  resolveNode,
  TEXT_CHARACTERS_MAX_LENGTH,
} from '@dforge/engine';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { type CanvasSession, createCanvasSession } from '../state/session';
import { attachPointerAdapter } from '../input/pointer';
import { dispatchKeyDown } from '../input/keyboard';
import { TextOverlay } from './text-overlay';

/** 建带文本节点的会话（初始视口：zoom 2、pan 40/30，验证坐标换算）。 */
function fixture(): CanvasSession {
  const text = createText({
    id: 'n_text',
    x: 100,
    y: 50,
    width: 200,
    height: 24,
    text: {
      characters: '标题',
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
    snapEnabled: false,
    viewport: { zoom: 2, panX: 40, panY: 30 },
  });
}

let session: CanvasSession;
let element: HTMLDivElement;
let disposeAdapter: () => void;

beforeEach(() => {
  session = fixture();
  element = document.createElement('div');
  document.body.appendChild(element);
  // jsdom 无真实布局：stub 容器矩形（与 pointer.test.ts 同一口径，偏移 100/50）
  element.getBoundingClientRect = () =>
    ({
      x: 100,
      y: 50,
      left: 100,
      top: 50,
      right: 500,
      bottom: 450,
      width: 400,
      height: 400,
      toJSON: () => ({}),
    }) as DOMRect;
  disposeAdapter = attachPointerAdapter({ element, session }).dispose;
  render(<TextOverlay session={session} />);
});

/** 派发一轮真实浏览器的双击事件序列（两击 + dblclick，坐标为容器内局部坐标）。 */
function doubleClickAt(local: { x: number; y: number }): void {
  act(() => {
    for (const type of ['pointerdown', 'pointerup', 'pointerdown', 'pointerup'] as const) {
      element.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: 100 + local.x,
          clientY: 50 + local.y,
          button: 0,
        }),
      );
    }
    element.dispatchEvent(
      new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        clientX: 100 + local.x,
        clientY: 50 + local.y,
        button: 0,
      }),
    );
  });
}

describe('文本编辑进入路径（票 13）', () => {
  it('双击文本节点进入编辑态：覆盖层挂点出现且在世界坐标对齐处', () => {
    // 文本盒 (100,50,200,24) 世界坐标；双击其中心 (200,62)；屏幕 = ×2 + pan
    doubleClickAt({ x: 200 * 2 + 40, y: 62 * 2 + 30 });
    const editing = session.store.getState().editing;
    expect(editing?.nodeId).toBe('n_text');
    const overlay = screen.getByRole('textbox');
    expect(overlay.getAttribute('data-df-text-overlay')).toBe('n_text');
    expect(overlay.style.left).toBe(`${100 * 2 + 40}px`);
    expect(overlay.style.top).toBe(`${50 * 2 + 30}px`);
  });

  it('双击空白处不进入编辑', () => {
    doubleClickAt({ x: 20, y: 20 });
    expect(session.store.getState().editing).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Enter 路径与双击路径进入同一编辑态（选中单节点后按 Enter）', () => {
    doubleClickAt({ x: 200 * 2 + 40, y: 62 * 2 + 30 });
    expect(session.store.getState().editing?.nodeId).toBe('n_text');
    session.cancelText();
    // Enter 路径：画布快捷键 editText（选中该节点时）
    session.setSelection(['n_text']);
    dispatchKeyDown(
      session,
      { key: 'Enter', meta: false, ctrl: false, shift: false, alt: false },
      { screenSize: { width: 400, height: 400 }, screenCenter: { x: 200, y: 200 } },
    );
    const editing = session.store.getState().editing;
    expect(editing?.nodeId).toBe('n_text');
    // 两条路径的覆盖层是同一个挂点、同一份几何口径
    const overlay = screen.getByRole('textbox');
    expect(overlay.getAttribute('data-df-text-overlay')).toBe('n_text');
    expect(overlay.style.left).toBe(`${100 * 2 + 40}px`);
  });

  it('双击进入后 Esc 取消不落盘；再双击编辑、失焦提交落盘（两路径同一提交语义）', async () => {
    const user = userEvent.setup();
    doubleClickAt({ x: 200 * 2 + 40, y: 62 * 2 + 30 });
    const overlay = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.clear(overlay);
    await user.type(overlay, '临时稿');
    await user.keyboard('{Escape}');
    expect(session.store.getState().editing).toBeNull();
    const before = resolveNode(session.page(), 'n_text');
    expect(before?.type === 'text' && before.text.characters).toBe('标题');

    // 失焦提交：重新双击进入（这次通过 Esc 后的第二次双击验证进入路径可重复）
    doubleClickAt({ x: 200 * 2 + 40, y: 62 * 2 + 30 });
    const reopened = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.clear(reopened);
    await user.type(reopened, '改标题');
    await user.click(document.body);
    expect(session.store.getState().editing).toBeNull();
    const after = resolveNode(session.page(), 'n_text');
    expect(after?.type === 'text' && after.text.characters).toBe('改标题');
  });

  it(' dispose 后双击不再进入编辑（适配器解绑生效）', () => {
    disposeAdapter();
    doubleClickAt({ x: 200 * 2 + 40, y: 62 * 2 + 30 });
    expect(session.store.getState().editing).toBeNull();
  });

  it('超长输入钳制：覆盖层 onChange 通道（整段替换）不越过字符数上限（票 13）', () => {
    doubleClickAt({ x: 200 * 2 + 40, y: 62 * 2 + 30 });
    const overlay = screen.getByRole('textbox') as HTMLTextAreaElement;
    // 粘贴/输入法上屏在 DOM 里落到 value，onChange 即覆盖层的整段替换通道
    fireEvent.change(overlay, { target: { value: '超'.repeat(TEXT_CHARACTERS_MAX_LENGTH + 50) } });
    const editing = session.store.getState().editing;
    expect(editing?.content.characters.length).toBe(TEXT_CHARACTERS_MAX_LENGTH);
  });
});
