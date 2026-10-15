'use client';

/**
 * Present store 的 React 订阅 hook（与评论/版本同一口径：Zustand vanilla + `useStore`）。
 */
import { useStore } from 'zustand';
import type { ReviewSession } from '../session';
import type { PresentUiState } from './present-store';

/** 订阅 Present UI 态片段。 */
export function usePresentUi<T>(session: ReviewSession, selector: (state: PresentUiState) => T): T {
  return useStore(session.present, selector);
}
