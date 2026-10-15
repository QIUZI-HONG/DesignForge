/**
 * Present UI store（C13）——开启/退出、当前幻灯片、控制条可见性。
 *
 * 为什么单独一个 store 而不是组件内 state：**顶栏的「演示」按钮与全屏浮层是两个组件**
 * （按钮属于 FE-03 的顶栏插槽，浮层是 FE-07 的 Presenter），两者必须读同一份状态；
 * 同时「Present 开着没有」也是壳层要读的（开着时快捷键应让位给翻页）。
 * 翻页/自动隐藏的规则复用纯函数（`controller.ts`），store 只做状态读写。
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { AUTO_HIDE_DELAY_MS, type PresenterState, stepPresentation } from './controller';

/** Present UI 态 + 动作。 */
export interface PresentUiState {
  /** 是否在演示中。 */
  open: boolean;
  /** 当前幻灯片下标（0 基）。 */
  index: number;
  /** 控制条是否可见（静止超时自动隐藏）。 */
  barVisible: boolean;
  /** 最近一次活动的时间戳（毫秒；自动隐藏的计时基准）。 */
  lastActivityAt: number;

  /** 进入演示（恒从第一张开始；无画板也允许进入 → 组件呈现空态）。 */
  openPresentation: () => void;
  /** 退出演示（下次开启从第一张开始）。 */
  exitPresentation: () => void;
  /** ←/→ 翻页（边界不越界；翻页视为活动）。 */
  step: (delta: number, total: number) => void;
  /** 跳转到指定页（控制条/键盘 Home/End 等用；越界即夹到边界）。 */
  goTo: (index: number, total: number) => void;
  /** 鼠标/键盘活动：重置自动隐藏计时并让控制条可见。 */
  markActivity: () => void;
  /** 时间推进：按纯规则决定控制条是否隐藏（组件用 setInterval 调）。 */
  tick: () => void;
  setBarVisible: (visible: boolean) => void;
  hideBar: () => void;
}

/** Present store 句柄。 */
export type PresentStore = StoreApi<PresentUiState>;

/** createPresentStore 选项。 */
export interface PresentStoreOptions {
  /** 时间源（毫秒；测试注入假时钟，保证「活动 → 隐藏」的时序可断言）。 */
  now?: () => number;
}

/** 建 Present store。 */
export function createPresentStore(
  initial: PresenterState = { index: 0, barVisible: true },
  options: PresentStoreOptions = {},
): PresentStore {
  const now = options.now ?? (() => Date.now());
  return createStore<PresentUiState>((set, get) => ({
    open: false,
    index: initial.index,
    barVisible: initial.barVisible,
    lastActivityAt: 0,

    openPresentation: () => {
      set({ open: true, index: 0, barVisible: true, lastActivityAt: now() });
    },

    exitPresentation: () => {
      if (!get().open) return;
      set({ open: false, index: 0, barVisible: true });
    },

    step: (delta, total) => {
      const next = stepPresentation(
        { index: get().index, barVisible: get().barVisible },
        delta,
        total,
      );
      set({ index: next.index, barVisible: true, lastActivityAt: now() });
    },

    goTo: (index, total) => {
      if (total <= 0) return;
      const clamped = Math.min(total - 1, Math.max(0, Math.trunc(index)));
      set({ index: clamped, barVisible: true, lastActivityAt: now() });
    },

    markActivity: () => {
      set({ barVisible: true, lastActivityAt: now() });
    },

    tick: () => {
      const visible = now() - get().lastActivityAt < AUTO_HIDE_DELAY_MS;
      if (visible === get().barVisible) return;
      set({ barVisible: visible });
    },

    setBarVisible: (visible) => {
      if (get().barVisible === visible) return;
      set({ barVisible: visible });
    },

    hideBar: () => {
      get().setBarVisible(false);
    },
  }));
}
