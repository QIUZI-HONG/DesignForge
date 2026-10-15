'use client';

/**
 * 编辑器界面态（Zustand；_shared §3：**Zustand 只放 UI 态**——面板开合、视口、临时交互）。
 *
 * 为什么命令面板/快捷键说明的开合放在 store 而不是组件 state：
 * 打开它们的入口有三处——全局快捷键、顶栏帮助菜单的命令、命令面板自身的 Esc——
 * 其中「命令的 run」是**非 React 闭包**，需要命令式可达的状态。
 *
 * 文档态（Design IR / 选择 / 命令栈）**不在这里**（归 `@dforge/engine`）。
 */
import { create } from 'zustand';

/** 编辑器界面态。 */
export interface EditorUiState {
  /** 命令面板（E7）是否打开。 */
  commandPaletteOpen: boolean;
  /** 快捷键说明（E8）是否打开。 */
  shortcutsOpen: boolean;
  setCommandPaletteOpen(open: boolean): void;
  setShortcutsOpen(open: boolean): void;
}

/** 界面态 store（命令式访问用 `useEditorUi.getState()`，组件内用选择器订阅）。 */
export const useEditorUi = create<EditorUiState>((set) => ({
  commandPaletteOpen: false,
  shortcutsOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
}));

/** 是否有浮层占着键盘（全局快捷键据此让路）。 */
export function isEditorOverlayOpen(): boolean {
  const state = useEditorUi.getState();
  return state.commandPaletteOpen || state.shortcutsOpen;
}
