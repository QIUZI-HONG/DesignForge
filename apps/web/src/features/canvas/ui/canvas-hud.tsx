'use client';

/**
 * C20 画布 HUD：**11 号字反白小条**（`--dfg-font-size-11`）；**拖动出现、松手消失**。
 *
 * 分工说明（跨票排序）：正式接口是 FE-03 的 `useCanvasHud()`（`show/hide`）。
 * FE-03 尚未落地（integration/p0 上还没有 editor-shell），本票在自己的特征目录里
 * 实现同形状的内部 HUD 作为占位——**签名一致**（`show(text)` / `hide()`），
 * 待 FE-03 合入后由编辑器路由布局切换成 `useCanvasHud()`（改动点只有 CanvasStage 一处）。
 */

import { useStore } from 'zustand';

import type { CanvasSession } from '../state/session';

/** 画布 HUD 契约（与 FE-03 `useCanvasHud()` 同形）。 */
export interface CanvasHudSink {
  show(text: string): void;
  hide(): void;
}

/** HUD 组件 props。 */
export interface CanvasHudProps {
  session: CanvasSession;
}

/** HUD 文案条。 */
export function CanvasHud({ session }: CanvasHudProps) {
  const text = useStore(session.store, (state) => state.hud);
  if (text === null) return null;
  return (
    <div className="dfc-canvas-hud" data-df-canvas-hud="" role="status" aria-live="polite">
      {text}
    </div>
  );
}
