/**
 * 指针适配器（DOM 事件 → 会话语义输入）。
 *
 * 分层理由：会话（`state/session.ts`）只认「世界坐标 + 屏幕坐标 + 按键 + 修饰键」，
 * 浏览器事件的坐标换算、按键归一化、光标与滚轮默认行为都收在这一层——
 * 这样交互状态机可以脱离 DOM 测（vitest/node），DOM 层只剩机械翻译。
 *
 * 坐标口径：容器内 **CSS 像素**。渲染器内部按 `dpr` 放大 backing store，
 * 因此「指针坐标空间」与「视口平移/缩放空间」始终一致（不需要乘 dpr）。
 *
 * 交互收口（§E4）：pointerdown 进入交互/建画草稿即尝试 `setPointerCapture`（真实浏览器里
 * 拖出画布仍持续收到 move/up）；另设 window 级 `pointerup`/`pointercancel` 兜底监听——
 * 捕获未生效（jsdom、个别浏览器异常）时画布外松开也能结束交互，且按「最后已知交互位置」
 * 结算（画布外从未见过的 move 不得让节点瞬移）。Esc 取消路径在 keyboard 层，不经此处。
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

  /**
   * 指针捕获（真实浏览器）：拖出画布后 move/up 仍重定向到容器，交互跟随不中断。
   * jsdom 未实现 `setPointerCapture`（typeof 守卫跳过）——回归用例打在 window 级兜底
   * 监听上（用例策略票 #09 内定案：window 兜底的可测性优先）。
   */
  const capturePointer = (event: PointerEvent): void => {
    if (typeof element.setPointerCapture !== 'function') return;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // 指针可能已释放（InvalidPointerId）：不影响交互本身，window 级兜底仍在
    }
  };

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
    // 只有真的进入交互/建画草稿才捕获：文本编辑等由覆盖层接管的状态不得抢事件
    const afterDown = session.store.getState();
    if (afterDown.interaction.kind !== 'idle' || afterDown.draft !== null) {
      capturePointer(event);
    }
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

  /** pointerUp 结算（输入点由调用方决定：画布上用事件点，window 兜底用最后已知交互点）。 */
  const settleUp = (
    point: { screen: { x: number; y: number }; world: { x: number; y: number } },
    modifiers: Modifiers,
  ): void => {
    guard(session, () =>
      session.pointerUp({
        screen: point.screen,
        world: point.world,
        modifiers,
      }),
    );
    requestRender();
  };

  /**
   * window 兜底的结算输入：优先取**交互已知的最后位置**。
   * 理由：捕获未生效时（jsdom、个别浏览器异常），画布外的 move 从未到达——若按松开点结算，
   * 节点会瞬移到用户从未拖到的位置。按「最后已知位置」结算 = 提交用户在画布上实际看到的状态
   * （与捕获生效时浏览器持续重定向 move 的结果一致）。
   */
  const lastKnownUpPoint = (
    event: PointerEvent,
  ): { screen: { x: number; y: number }; world: { x: number; y: number } } => {
    const interaction = session.store.getState().interaction;
    if (interaction.kind === 'pan') {
      const screen = interaction.currentScreen;
      return { screen, world: toWorld(session, screen) };
    }
    if (interaction.kind !== 'idle') {
      return { screen: toScreen(session, interaction.current), world: interaction.current };
    }
    // 建画草稿：pointerUp 的草稿分支不读坐标，给事件自身的位置即可
    const local = localPoint(element, event);
    return { screen: local, world: toWorld(session, local) };
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.button === 2) return;
    if (!isCanvasSurface(event.target)) return;
    const local = localPoint(element, event);
    settleUp({ screen: local, world: toWorld(session, local) }, modifiersOf(event));
  };

  const onWindowPointerUp = (event: PointerEvent): void => {
    // 画布表面上的松开由 element 级监听结算（冒泡到 window 时已结算，这里直接跳过）
    if (isCanvasSurface(event.target)) return;
    const state = session.store.getState();
    if (state.interaction.kind === 'idle' && state.draft === null) return; // 无未结算交互
    settleUp(lastKnownUpPoint(event), modifiersOf(event));
  };

  const onWindowPointerCancel = (): void => {
    // 指针被系统取消（触摸打断/设备切换）：与 Esc 同径，取消而非提交
    const state = session.store.getState();
    if (state.interaction.kind === 'idle' && state.draft === null) return;
    guard(session, () => session.cancelActiveInteraction());
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
  // window 级兜底（§E4）：画布外松开/取消也能结束交互——节点不再「粘」在光标上。
  // 常驻监听（事件内按状态早退），而非按下时挂/松开时摘：无簿记、无漏摘泄漏面。
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerCancel);

  return {
    dispose(): void {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointerleave', onPointerLeave);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('contextmenu', onContextMenu);
      element.removeEventListener('dblclick', onDoubleClick);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerCancel);
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

/** 世界坐标 → 屏幕（容器内 CSS 像素；toWorld 的逆变换，window 兜底结算用）。 */
function toScreen(session: CanvasSession, world: { x: number; y: number }) {
  const viewport = session.viewport();
  return {
    x: world.x * viewport.zoom + viewport.panX,
    y: world.y * viewport.zoom + viewport.panY,
  };
}
