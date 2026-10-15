'use client';

/**
 * 引擎接缝的 React 侧（hooks）——文档/选择集都**不进 React state**：
 * 文档走 `useSyncExternalStore` 监听命令栈（引用稳定的 subscribe/getSnapshot 来自会话），
 * 选择集与面板 UI 态走 Zustand vanilla store 的 `useStore`。
 */
import type { DesignDocument } from '@dforge/engine';
import { useSyncExternalStore } from 'react';
import { useStore } from 'zustand';

import type { PanelsSession } from '../session';
import type { PanelsUiState } from './panels-store';

/** 订阅当前文档快照（命令栈任何写入都会触发重渲染）。 */
export function usePanelsDocument(session: PanelsSession): DesignDocument {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}

/** 订阅面板 UI 态片段（选择器返回原始值/稳定引用，避免无谓重渲染）。 */
export function usePanelsUi<T>(session: PanelsSession, selector: (state: PanelsUiState) => T): T {
  return useStore(session.ui, selector);
}
