/**
 * 画布 HUD 状态机（C20 清单 · **FE-03 冻结接口 ② 的实现核心**）。
 *
 * 形态（清单 C20）：**11 号反白小条**（`--dfg-font-size-11`）；拖动出现、松手消失。触发时机归画布（FE-06）——
 * 它在拖动/缩放过程中调 `show(text)`，松手调 `hide()`；本模块只负责「显示什么、是否可见」。
 *
 * 为什么状态机在模块单例而不是 React state：
 * - 触发方常常是**非 React 路径**（指针事件回调、引擎侧订阅、命令执行体），
 *   命令式 `show/hide` 必须随时可达；
 * - React 侧（HUD 组件）用 `useSyncExternalStore` 订阅同一状态——单一真源，不会两处打架。
 *
 * 语义：
 * - `show(text)` 立即显示；`autoHideMs > 0` 时**自动淡出**（重复 show 会重置计时）——
 *   滚轮缩放这类「一次性动作」用它，拖动这类「持续状态」用缺省（常驻到 `hide()`）；
 * - `hide()` 清文本并取消计时；未显示时调用是 no-op（不通知订阅者）；
 * - 快照引用稳定（仅内容变化时换新对象）——`useSyncExternalStore` 的硬要求。
 */

/** `show` 的可选参数（冻结签名 `show(text)` 的超集：省略即常驻）。 */
export interface CanvasHudShowOptions {
  /** 自动消失时长（毫秒）；缺省或 `0` = 常驻，直到 `hide()`。 */
  autoHideMs?: number;
}

/**
 * HUD 命令式接口（**冻结**：`briefs/fe-03.md` §2 —— FE-06 只调用这两个方法）。
 */
export interface CanvasHudApi {
  /** 显示反白小条（文案由调用方给，如 `'1200 × 800'` 测量值或 `'150%'` 缩放值）。 */
  show(text: string, options?: CanvasHudShowOptions): void;
  /** 隐藏（松手/退出交互时调用）。 */
  hide(): void;
}

/** HUD 可见性快照（HUD 组件的渲染依据）。 */
export interface CanvasHudSnapshot {
  /** 当前文案；`null` = 不可见。 */
  text: string | null;
}

const HIDDEN: CanvasHudSnapshot = { text: null };

let snapshot: CanvasHudSnapshot = HIDDEN;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/** 清掉自动隐藏计时器。 */
function clearHideTimer(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

/** 提交新快照并通知订阅者（引用稳定：内容不变则不通知）。 */
function setSnapshot(next: CanvasHudSnapshot): void {
  if (next.text === snapshot.text) return;
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

/** 全局 HUD 控制器（单例；命令与非 React 路径直接调用）。 */
export const canvasHud: CanvasHudApi = {
  show(text: string, options?: CanvasHudShowOptions): void {
    clearHideTimer();
    setSnapshot({ text });
    const autoHideMs = options?.autoHideMs ?? 0;
    if (autoHideMs > 0) {
      hideTimer = setTimeout(() => {
        hideTimer = null;
        setSnapshot(HIDDEN);
      }, autoHideMs);
    }
  },
  hide(): void {
    clearHideTimer();
    setSnapshot(HIDDEN);
  },
};

/** 订阅 HUD 状态变化（React 外部入口；组件内走 `useCanvasHud()`/`CanvasHud`）。 */
export function subscribeCanvasHud(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 稳定引用的 HUD 快照（`useSyncExternalStore` 专用）。
 *
 * SSR 首帧与客户端首帧同源（模块初始态恒为「不可见」），不存在水合不一致。
 */
export function getCanvasHudSnapshot(): CanvasHudSnapshot {
  return snapshot;
}
