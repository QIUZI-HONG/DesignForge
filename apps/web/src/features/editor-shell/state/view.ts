'use client';

/**
 * 编辑器缩放 UI 态与当前工具（Zustand；_shared §3 允许的「视口」类 UI 态）。
 *
 * 职责边界（关键）：
 * - **本 store 是外壳（chrome）的显示真源**：缩放菜单 C16 的百分比、工具条 C2 的 active 高亮；
 * - **画布视口本体归 FE-06**（引擎 `Viewport` + 渲染）。FE-06 接入时二选一：
 *   ① 它把真实视口 zoom 写回 `setZoom(...)`（推荐：一处真源，外壳自动跟随）；
 *   ② 它用同 id 覆盖 `view.zoomIn`/`view.zoomOut`/`view.zoom100` 命令（命令表 last wins）。
 * - 缩放档位**取自 `@dforge/engine` 的 `ZOOM_LEVELS`**（引擎注释即标明「C16 缩放菜单的百分比档位」），
 *   保证外壳菜单与画布缩放步进同一份档位表。
 */
import { clampZoom, MAX_ZOOM, MIN_ZOOM, ZOOM_LEVELS } from '@dforge/engine';
import { create } from 'zustand';

/** 缩放展示用百分比（四舍五入取整；2% 这类小档不显示小数）。 */
export function toZoomPercent(zoom: number): number {
  return Math.round(zoom * 100);
}

/**
 * 在档位表上步进（与引擎 `zoomStep` 同语义：落到下一个/上一个档位，越界夹住）。
 *
 * @param zoom 当前倍率
 * @param steps 步数（+1 放大 / -1 缩小）
 */
export function stepZoom(zoom: number, steps: number): number {
  if (steps === 0) return zoom;
  const index = ZOOM_LEVELS.findIndex((level) => level >= zoom - 1e-9);
  const start = index < 0 ? ZOOM_LEVELS.length - 1 : index;
  const target = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, start + steps));
  return ZOOM_LEVELS[target] ?? zoom;
}

/**
 * 工具标识（白名单交互的 UI 侧入口；语义以引擎为准）。
 *
 * `move` 是 Figma 词表的「移动工具」，落到画布会话即选择工具（映射见
 * `features/canvas/workspace/tool-bridge.ts` 的 `SHELL_TO_CANVAS`）。
 */
export type EditorTool = 'move' | 'frame' | 'rect' | 'ellipse' | 'text' | 'hand';

/** 缩放/工具 UI 态。 */
export interface EditorViewState {
  /** 当前缩放倍率（1 = 100%）。 */
  zoom: number;
  /** 当前工具（工具条 active 高亮的真源；画布按它切交互模式）。 */
  activeTool: EditorTool;
  /**
   * 当前文档名（顶栏文件名真源）。
   * `null` = 尚未落盘/未载入真实文档 → 顶栏显示「未命名设计文件」占位文案；
   * 非 null 时显示真实文档名（由画布工作区在载入/落盘后写回，D-2/UX-03）。
   */
  documentName: string | null;
  setZoom(zoom: number): void;
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
  setActiveTool(tool: EditorTool): void;
  setDocumentName(name: string | null): void;
}

/** 缩放/工具 store。 */
export const useEditorView = create<EditorViewState>((set, get) => ({
  zoom: 1,
  activeTool: 'move',
  documentName: null,
  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  zoomIn: () => set({ zoom: stepZoom(get().zoom, 1) }),
  zoomOut: () => set({ zoom: stepZoom(get().zoom, -1) }),
  resetZoom: () => set({ zoom: 1 }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  setDocumentName: (name) => set({ documentName: name }),
}));

/** 当前缩放百分比（命令与 HUD 用；命令式可达）。 */
export function currentZoomPercent(): number {
  return toZoomPercent(useEditorView.getState().zoom);
}

/** 缩放上下限（再导出，供 UI 展示「到顶了」这类判定，避免外壳重复写死）。 */
export const ZOOM_LIMITS = { min: MIN_ZOOM, max: MAX_ZOOM } as const;
