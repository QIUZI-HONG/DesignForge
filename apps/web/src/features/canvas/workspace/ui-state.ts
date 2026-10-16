'use client';

/**
 * 工作区界面态（Zustand）——右栏页签与 AI 抽屉开合。
 *
 * 为什么需要这个小 store（修复批次 4 · 工作包 D1/D-7）：这两个状态各有**非 React 的写入方**——
 * `view.ai` / `file.export` 命令的 `run` 闭包（命令面板、文件菜单经命令表触发）；
 * 而读取方是插槽组件（`RightPanelSlot` / `AiDrawerSlot`）。组件内 `useState` 无法被命令写，
 * 状态必须落在命令式可达的最小 store 上（与 `editor-shell/state/ui.ts` 同口径）。
 *
 * 边界：本 store 只放「界面态」；文档真值在 `PanelsSession` 的命令栈（本模块不碰）。
 */

import { create } from 'zustand';

/** 右栏页签（顺序即展示顺序；`image` 为出图面板入口，修复批次 4 · D1）。 */
export const RIGHT_PANEL_TABS = ['inspect', 'code', 'export', 'image'] as const;

/** 右栏页签 id。 */
export type RightPanelTab = (typeof RIGHT_PANEL_TABS)[number];

/** 工作区界面态。 */
export interface WorkspaceUiState {
  /** 右栏当前页签（检查 / 代码 / 导出 / 出图）。 */
  rightPanelTab: RightPanelTab;
  /** AI 抽屉（`AiDrawerSlot`）是否打开。 */
  aiDrawerOpen: boolean;
  setRightPanelTab(tab: RightPanelTab): void;
  setAiDrawerOpen(open: boolean): void;
}

/** 工作区界面态 store（命令式访问用 `useWorkspaceUi.getState()`，组件内用选择器订阅）。 */
export const useWorkspaceUi = create<WorkspaceUiState>((set) => ({
  rightPanelTab: 'inspect',
  aiDrawerOpen: false,
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  setAiDrawerOpen: (aiDrawerOpen) => set({ aiDrawerOpen }),
}));
