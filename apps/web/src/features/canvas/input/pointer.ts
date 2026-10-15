/**
 * 指针适配器（DOM 事件 → 会话语义输入）。
 *
 * 分层理由：会话（`state/session.ts`）只认「世界坐标 + 屏幕坐标 + 按键 + 修饰键」，
 * 浏览器事件的坐标换算、按键归一化、光标与滚轮默认行为都收在这一层——
 * 这样交互状态机可以脱离 DOM 测（vitest/node），DOM 层只剩机械翻译。
 *
 * 坐标口径：容器内 **CSS 像素**。渲染器内部按 `dpr` 放大 backing store，
 * 因此「指针坐标空间」与「视口平移/缩放空间」始终一致（不需要乘 dpr）。
 */

import type { Modifiers } from '@dforge/engine';

import type { CanvasSession, PointerButton } from '../state/session';

/** 适配器选项。 */
export interface PointerAdapterOptions {
  /** 事件容器（通常是包裹 canvas 的定位容器）。 */
  element: HTMLElement;
  session: CanvasSession;
  /** 需要重画时调用（悬停/交互变化都会触发；rAF 合并由帧循环负责）。 */
  requestRender?: () => void;
  /** 右键按下时的回调（C11 菜单开在局部坐标处）。 */
  onContextMenu?: (point: { x: number; y: number }) => void;
}

/** 适配器句柄。 */
export interface PointerAdapter {
  dispose(): void;
}

/** 容器内局部坐标（CSS 像素）。 */
export function localPoint(element: HTMLElement, event: { clientX: number; clientY: number }) {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/** 修饰键归一化。 */
export function modifiersOf(event: {
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): Modifiers {
  return {
    shift: event.shiftKey,
    alt: event.altKey,
    // ⌘ 与 Ctrl 在快捷键/深选语义上等价（Linux/Windows 无 ⌘ 键）
    meta: event.metaKey || event.ctrlKey,
  };
}

/** 按键归一化。 */
export function buttonOf(event: { button: number }): PointerButton {
  if (event.button === 1) return 'middle';
  if (event.button === 2) return 'right';
  return 'left';
}

/** 绑定指针/滚轮事件到容器。 */
export function attachPointerAdapter(options: PointerAdapterOptions): PointerAdapter {
  const { element, session } = options;
  const requestRender = options.requestRender ?? ((): void => undefined);

  const onPointerDown = (event: PointerEvent): void => {
    // 中键：阻止 autoscroll；右键：交给 contextmenu（这里不动默认行为）
    if (event.button === 1) event.preventDefault();
    if (event.button === 2) return;
    element.focus?.();
    const local = localPoint(element, event);
    session.pointerDown({
      screen: local,
      world: toWorld(session, local),
      button: buttonOf(event),
      modifiers: modifiersOf(event),
      deep: event.metaKey || event.ctrlKey,
    });
    requestRender();
  };

  const onPointerMove = (event: PointerEvent): void => {
    const local = localPoint(element, event);
    session.pointerMove({
      screen: local,
      world: toWorld(session, local),
      modifiers: modifiersOf(event),
    });
    const cursor = session.store.getState().hoverCursor;
    if (element.style.cursor !== cursor) element.style.cursor = cursor;
    requestRender();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.button === 2) return;
    const local = localPoint(element, event);
    session.pointerUp({
      screen: local,
      world: toWorld(session, local),
      modifiers: modifiersOf(event),
    });
    requestRender();
  };

  const onPointerLeave = (): void => {
    if (session.store.getState().hoverId !== null) {
      session.store.setState({ hoverId: null, hoverCursor: 'default' });
      requestRender();
    }
  };

  const onWheel = (event: WheelEvent): void => {
    // 画布消费滚轮：不再滚动页面；⌘/Ctrl + 滚轮 = 缩放（Figma 口径）
    event.preventDefault();
    const local = localPoint(element, event);
    session.wheel({
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      zoom: event.metaKey || event.ctrlKey,
      screen: local,
    });
    requestRender();
  };

  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    options.onContextMenu?.(localPoint(element, event));
  };

  const onDoubleClick = (event: MouseEvent): void => {
    const local = localPoint(element, event);
    session.doubleClick({
      screen: local,
      world: toWorld(session, local),
      button: buttonOf(event),
      modifiers: modifiersOf(event),
    });
    requestRender();
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointerleave', onPointerLeave);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('contextmenu', onContextMenu);
  element.addEventListener('dblclick', onDoubleClick);

  return {
    dispose(): void {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointerleave', onPointerLeave);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('contextmenu', onContextMenu);
      element.removeEventListener('dblclick', onDoubleClick);
    },
  };
}

/** 屏幕（容器内 CSS 像素）→ 世界坐标。 */
function toWorld(session: CanvasSession, local: { x: number; y: number }) {
  const viewport = session.viewport();
  return {
    x: (local.x - viewport.panX) / viewport.zoom,
    y: (local.y - viewport.panY) / viewport.zoom,
  };
}
