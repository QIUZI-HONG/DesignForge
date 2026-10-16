'use client';

/**
 * 壳层视口 → 评审视口来源的桥（FE-03 ⇄ FE-07）。
 *
 * 编辑器缩放的真源分两层（见 `editor-shell/state/view.ts` 头注释）：外壳的缩放菜单显示
 * `useEditorView.zoom`，而**画布视口本体归 FE-06**。在 FE-06 落地前，把外壳的 zoom
 * 桥成评审侧的 `ViewportSource`，评论钉点就能跟着缩放菜单走（平移暂缺——外壳此时没有 pan）。
 * FE-06 接入后，把它持有的引擎 `Viewport` 直接以 `createReviewSession({ viewport })` 注入，
 * 本桥即退役（本模块头注释即迁移说明）。
 *
 * 稳定性（硬要求）：`getViewport` 喂的是 `useSyncExternalStore`，**引用不稳定会无限重渲染**——
 * 因此按 zoom 值做单槽缓存：zoom 未变时返回同一个对象。
 */
import { createViewport, type Viewport } from '@dforge/engine';

import { useEditorView } from '@/features/editor-shell';

import type { ViewportSource } from './session';

/** 建「外壳缩放」视口来源（引用稳定：同 zoom 同对象）。 */
export function createShellViewportSource(): ViewportSource {
  let lastZoom = useEditorView.getState().zoom;
  let cached: Viewport = createViewport(lastZoom);
  return {
    getViewport: () => {
      const zoom = useEditorView.getState().zoom;
      if (zoom !== lastZoom) {
        lastZoom = zoom;
        cached = createViewport(zoom);
      }
      return cached;
    },
    subscribeViewport: (listener) => useEditorView.subscribe(listener),
  };
}
