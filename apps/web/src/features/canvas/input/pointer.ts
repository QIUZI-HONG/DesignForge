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
  /**
   * 判定事件目标是否属于「画布表面」。
   * 默认只认容器自身与 `<canvas>`——工具条/右键菜单/文本覆盖层/宿主壳的按钮点击
   * **不能**被当成画布操作（否则点工具条会清空选择、按钮还会在 pointerdown 后被卸载而导致 click 不触发）。
   */
  isCanvasSurface?: (target: EventTarget | null) => boolean;
}

/** 默认的「画布表面」判定：容器自身或 canvas 元素。 */
function defaultSurfaceCheck(element: HTMLElement) {
  return (target: EventTarget | null): boolean => {
    if (target === null) return false;
    if (target === element) return true;
    return target instanceof HTMLCanvasElement;
  };
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

/**
 * 会话调用兜底（事件处理器里异常**不得逃逸**）。
 *
 * 为什么必须有：pointer 事件处理器是「种子事件」——异常从这里冒泡出去会变成
 * 未捕获异常（真实用户看到的是整块画布失效）。会话内部已按文档真值修剪失效集合
 * （见 `state/session.ts` 的 `liveSelectionIds`），这里只兜底**未知**异常：
 * 记进会话错误态（可观测）并把交互拉回一致态，然后继续响应后续事件。
 */
function guard(session: CanvasSession, action: () => void): void {
  try {
    action();
  } catch (error) {
    session.setError(error instanceof Error ? error.message : String(error));
    session.cancelActiveInteraction();
  }
}

/** 绑定指针/滚轮事件到容器。 */
export function attachPointerAdapter(options: PointerAdapterOptions): PointerAdapter {
  const { element, session } = options;
  const requestRender = options.requestRender ?? ((): void => undefined);
  const isCanvasSurface = options.isCanvasSurface ?? defaultSurfaceCheck(element);

  const onPointerDown = (event: PointerEvent): void => {
    if (!isCanvasSurface(event.target)) return;
    // 中键：阻止 autoscroll；右键：交给 contextmenu（这里不动默认行为）
    if (event.button === 1) event.preventDefault();
    if (event.button === 2) return;
    element.focus?.();
    const local = localPoint(element, event);
    guard(session, () =>
      session.pointerDown({
        screen: local,
        world: toWorld(session, local),
        button: buttonOf(event),
        modifiers: modifiersOf(event),
        deep: event.metaKey || event.ctrlKey,
      }),
    );
    requestRender();
  };

  const onPointerMove = (event: PointerEvent): void => {
    // 悬停只在画布表面更新（移过工具条/菜单不应改悬停高亮）
    if (!isCanvasSurface(event.target)) {
      if (session.store.getState().hoverId !== null) {
        session.store.setState({ hoverId: null, hoverCursor: 'default' });
        requestRender();
      }
      return;
    }
    const local = localPoint(element, event);
    guard(session, () =>
      session.pointerMove({
        screen: local,
        world: toWorld(session, local),
        modifiers: modifiersOf(event),
      }),
    );
    const cursor = session.store.getState().hoverCursor;
    if (element.style.cursor !== cursor) element.style.cursor = cursor;
    requestRender();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.button === 2) return;
    if (!isCanvasSurface(event.target)) return;
    const local = localPoint(element, event);
    guard(session, () =>
      session.pointerUp({
        screen: local,
        world: toWorld(session, local),
        modifiers: modifiersOf(event),
      }),
    );
    requestRender();
  };

  const onPointerLeave = (): void => {
    if (session.store.getState().hoverId !== null) {
      session.store.setState({ hoverId: null, hoverCursor: 'default' });
      requestRender();
    }
  };

  const onWheel = (event: WheelEvent): void => {
    if (!isCanvasSurface(event.target)) return;
    // 画布消费滚轮：不再滚动页面；⌘/Ctrl + 滚轮 = 缩放（Figma 口径）
    event.preventDefault();
    const local = localPoint(element, event);
    guard(session, () =>
      session.wheel({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        zoom: event.metaKey || event.ctrlKey,
        screen: local,
      }),
    );
    requestRender();
  };

  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    options.onContextMenu?.(localPoint(element, event));
  };

  const onDoubleClick = (event: MouseEvent): void => {
    if (!isCanvasSurface(event.target)) return;
    const local = localPoint(element, event);
    guard(session, () =>
      session.doubleClick({
        screen: local,
        world: toWorld(session, local),
        button: buttonOf(event),
        modifiers: modifiersOf(event),
      }),
    );
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
