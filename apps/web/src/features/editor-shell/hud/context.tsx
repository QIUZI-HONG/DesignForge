'use client';

/**
 * 画布 HUD（C20 清单）——**FE-03 冻结接口 ②**：`useCanvasHud()` → `{ show(text), hide() }`。
 *
 * 消费分工（冻结）：
 * - **FE-03（本票）**：实现 `CanvasHudProvider`（挂在编辑器路由布局）与 HUD 组件 `CanvasHud`；
 * - **FE-06（画布）**：只调用 `useCanvasHud().show(text)` / `hide()`，不关心 DOM 与样式。
 *
 * 为什么 Provider 之外还有全局控制器（`canvasHud`）：触发时机常在非 React 路径
 * （指针回调、命令执行体），且单元测试里画布组件可能脱离 Provider 渲染；
 * `useCanvasHud()` 在无 Provider 时**优雅退回**全局控制器（其可见性仍由 HUD 宿主广播），
 * 而不是抛错——HUD 缺席不该让画布崩掉。
 */
import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react';

import { cx } from '../utils/cx';
import {
  type CanvasHudApi,
  canvasHud,
  getCanvasHudSnapshot,
  subscribeCanvasHud,
} from './controller';

const CanvasHudContext = createContext<CanvasHudApi | null>(null);

/** HUD Provider（编辑器路由布局挂载；值即全局控制器——单一真源）。 */
export function CanvasHudProvider({ children }: { children: ReactNode }) {
  return <CanvasHudContext.Provider value={canvasHud}>{children}</CanvasHudContext.Provider>;
}

/** 取 HUD 命令式接口（无 Provider 时退回全局控制器，行为一致）。 */
export function useCanvasHud(): CanvasHudApi {
  return useContext(CanvasHudContext) ?? canvasHud;
}

/** HUD 组件 props。 */
export interface CanvasHudProps {
  /** 交互层类名（门禁取样/状态强制用）。 */
  className?: string;
}

/**
 * HUD 反白小条（11px，`--dfg-font-size-11`）。
 *
 * 位置由宿主容器给（编辑器壳把它放在画布区顶部居中），组件自身只管条的外观；
 * 不可见时渲染 `null`（不占位、不被读屏与截图采到）。
 * 语义：`role="status"` + `aria-live="polite"`——测量值播报不打断当前朗读。
 */
export function CanvasHud({ className }: CanvasHudProps) {
  const { text } = useSyncExternalStore(
    subscribeCanvasHud,
    getCanvasHudSnapshot,
    getCanvasHudSnapshot, // SSR：与客户端首帧同源（初始恒不可见）
  );
  if (text === null) return null;
  return (
    <div
      className={cx('dfg-editor-hud', className)}
      role="status"
      aria-live="polite"
      data-df-preview="editor/hud"
    >
      {text}
    </div>
  );
}
