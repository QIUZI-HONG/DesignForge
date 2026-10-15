/**
 * Present 翻页状态机（C13）——纯 reducer + 键盘映射 + 控制条自动隐藏规则。
 *
 * 为什么单独抽出来：翻页边界、键盘映射、自动隐藏时序都能在 jsdom 里逐值断言，
 * Presenter 组件只负责「读状态 → 渲染 + 绑定事件 → 派发意图」。
 */
/** 翻页意图（组件与键盘映射共用）。 */
export type PresentAction = 'next' | 'prev' | 'exit';

/** 控制条静止多久后自动隐藏（Figma 量级：3 秒）。 */
export const AUTO_HIDE_DELAY_MS = 3000;

/** Present 状态。 */
export interface PresenterState {
  /** 当前幻灯片下标（0 基）。 */
  index: number;
  /** 控制条是否可见（静态呈现 + 静止超时后隐藏）。 */
  barVisible: boolean;
}

/** 初始状态：第一张、控制条可见（进入 Present 先亮一下）。 */
export function createPresenterState(_total: number): PresenterState {
  return { index: 0, barVisible: true };
}

/** 翻页（边界不越界；空序列恒为 0）。 */
export function stepPresentation(
  state: PresenterState,
  delta: number,
  total: number,
): PresenterState {
  if (total <= 0) return { ...state, index: 0 };
  const next = Math.min(total - 1, Math.max(0, state.index + delta));
  if (next === state.index) return state;
  return { ...state, index: next };
}

/** 键盘 → 翻页意图（←/→ 翻页、Esc 退出；其余键不响应）。 */
export function keyboardActionOf(key: string): PresentAction | null {
  switch (key) {
    case 'ArrowLeft':
      return 'prev';
    case 'ArrowRight':
      return 'next';
    case 'Escape':
      return 'exit';
    default:
      return null;
  }
}

/**
 * 自动隐藏规则（纯函数，便于断言时序）：
 * 距最近一次活动（鼠标移动/翻页）超过 `AUTO_HIDE_DELAY_MS` 即隐藏。
 * `lastActivityAt` 与 `now` 都是毫秒时间戳（同一时间源）。
 */
export function barsVisibleAfterIdle(lastActivityAt: number, now: number): boolean {
  return now - lastActivityAt < AUTO_HIDE_DELAY_MS;
}

/** 控制条可见性推进（组件用 setInterval 调它；纯函数）。 */
export function advanceBar(
  state: PresenterState,
  lastActivityAt: number,
  now: number,
): PresenterState {
  const visible = barsVisibleAfterIdle(lastActivityAt, now);
  if (visible === state.barVisible) return state;
  return { ...state, barVisible: visible };
}
