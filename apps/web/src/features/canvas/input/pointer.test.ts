// @vitest-environment jsdom
/**
 * 指针适配器测试（jsdom）：浏览器事件 → 会话语义输入的机械翻译。
 *
 * 覆盖：局部坐标换算、按键归一化、修饰键（Ctrl 视作 ⌘）、滚轮缩放/平移、
 * 右键回调（C11 菜单开点）、光标更新、dispose 解绑。
 */

import { createDocument, createIdFactory, createPage, createRect } from '@dforge/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type CanvasSession, createCanvasSession } from '../state/session';
import { attachPointerAdapter, buttonOf, localPoint, modifiersOf } from './pointer';

/** 建容器（jsdom 里 getBoundingClientRect 全 0，测试用 stub 给出 100/50 偏移）。 */
function container(): HTMLDivElement {
  const element = document.createElement('div');
  document.body.appendChild(element);
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
  return element;
}

function fixture(): CanvasSession {
  const rect = createRect({ id: 'n_rect', x: 10, y: 10, width: 50, height: 30 });
  const page = createPage({ id: 'page_1', rootIds: ['n_rect'], nodes: { n_rect: rect } });
  return createCanvasSession({
    document: createDocument({ id: 'doc_1', pages: [page] }),
    ids: createIdFactory(1),
    snapEnabled: false,
  });
}

/** 造指针事件（clientX/Y 相对视口；容器偏移 100/50）。 */
function pointerEvent(
  type: string,
  point: { x: number; y: number },
  options: { button?: number; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 100 + point.x,
    clientY: 50 + point.y,
    button: options.button ?? 0,
    shiftKey: options.shiftKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
  });
  return event as PointerEvent;
}

let session: CanvasSession;
let element: HTMLDivElement;
let dispose: () => void;
/** 重画请求计数（适配器每处理一个事件都应请求重画）。 */
let renderCount = 0;

beforeEach(() => {
  session = fixture();
  element = container();
  renderCount = 0;
  dispose = attachPointerAdapter({
    element,
    session,
    requestRender: () => {
      renderCount += 1;
    },
  }).dispose;
});

describe('归一化函数', () => {
  it('局部坐标 = 客户端坐标 − 容器偏移', () => {
    expect(localPoint(element, { clientX: 130, clientY: 90 })).toEqual({ x: 30, y: 40 });
  });

  it('按键归一化：0/1/2 → left/middle/right', () => {
    expect(buttonOf({ button: 0 })).toBe('left');
    expect(buttonOf({ button: 1 })).toBe('middle');
    expect(buttonOf({ button: 2 })).toBe('right');
  });

  it('Ctrl 视作 ⌘（deep 选择与快捷键在非 mac 平台可用）', () => {
    expect(modifiersOf({ shiftKey: false, altKey: false, metaKey: false, ctrlKey: true })).toEqual({
      shift: false,
      alt: false,
      meta: true,
    });
  });
});

describe('指针适配器', () => {
  it('pointerdown/up 换算世界坐标并完成点选', () => {
    element.dispatchEvent(pointerEvent('pointerdown', { x: 30, y: 20 }));
    element.dispatchEvent(pointerEvent('pointerup', { x: 30, y: 20 }));
    expect(session.selection().ids).toEqual(['n_rect']);
    expect(renderCount).toBeGreaterThan(0);
  });

  it('pointermove 悬停命中并同步光标样式', () => {
    element.dispatchEvent(pointerEvent('pointermove', { x: 30, y: 20 }));
    expect(session.store.getState().hoverId).toBe('n_rect');
    expect(element.style.cursor).toBe('move');
    element.dispatchEvent(pointerEvent('pointermove', { x: 300, y: 300 }));
    expect(session.store.getState().hoverId).toBeNull();
    expect(element.style.cursor).toBe('default');
  });

  it('拖拽：move 推进交互、up 提交命令', () => {
    element.dispatchEvent(pointerEvent('pointerdown', { x: 30, y: 20 }));
    element.dispatchEvent(pointerEvent('pointermove', { x: 70, y: 60 }));
    expect(session.store.getState().interaction.kind).toBe('move');
    element.dispatchEvent(pointerEvent('pointerup', { x: 70, y: 60 }));
    expect(session.page().nodes.n_rect?.x).toBe(50);
  });

  it('⌘/Ctrl + 滚轮缩放（锚点缩放），普通滚轮平移', () => {
    const wheelZoom = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
      ctrlKey: true,
      clientX: 100,
      clientY: 50,
    });
    element.dispatchEvent(wheelZoom);
    expect(session.viewport().zoom).toBeGreaterThan(1);
    expect(wheelZoom.defaultPrevented).toBe(true);

    const before = session.viewport().panY;
    element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 30 }));
    expect(session.viewport().panY).toBe(before - 30);
  });

  it('右键触发菜单回调并交给 DOM 层（不进入交互态）', () => {
    const onContextMenu = vi.fn();
    const adapter = attachPointerAdapter({ element, session, onContextMenu });
    element.dispatchEvent(pointerEvent('pointerdown', { x: 30, y: 20 }, { button: 2 }));
    expect(session.store.getState().interaction.kind).toBe('idle');
    element.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 130, clientY: 70 }),
    );
    expect(onContextMenu).toHaveBeenCalledWith({ x: 30, y: 20 });
    adapter.dispose();
  });

  it('dblclick 进入文本编辑（文本节点）', () => {
    const text = session.createTextAt({ x: 200, y: 200 });
    text.toString();
    element.dispatchEvent(pointerEvent('dblclick', { x: 250, y: 210 }));
    expect(session.store.getState().editing?.nodeId).toBe(text);
  });

  it('中键按下不进入选择而是平移，且阻止 autoscroll', () => {
    const event = pointerEvent('pointerdown', { x: 30, y: 20 }, { button: 1 });
    element.dispatchEvent(event);
    expect(session.store.getState().interaction.kind).toBe('pan');
    expect(event.defaultPrevented).toBe(true);
  });

  it('dispose 解绑所有监听', () => {
    dispose();
    element.dispatchEvent(pointerEvent('pointerdown', { x: 30, y: 20 }));
    expect(session.store.getState().interaction.kind).toBe('idle');
  });
});
