'use client';

/**
 * 评审会话的 React 上下文与订阅 hooks。
 *
 * 与 FE-04 面板同一口径：文档走 `useSyncExternalStore` 监听命令栈（不进 React state）；
 * 评论/版本 UI 态走 Zustand vanilla store 的 `useStore`；视口走会话的 `ViewportSource`
 * （画布高频写入 → 覆盖层低频读取，两侧解耦）。
 */
import type { DesignDocument, Viewport } from '@dforge/engine';
import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';

import type { CommentsUiState } from './comments/comments-store';
import type { ReviewSession } from './session';
import type { VersionUiState } from './versions/versions-store';

const ReviewSessionContext = createContext<ReviewSession | null>(null);

/** 会话 Provider（壳层/测试在组件树根部包一层）。 */
export function ReviewProvider({
  session,
  children,
}: {
  session: ReviewSession;
  children: ReactNode;
}) {
  return <ReviewSessionContext.Provider value={session}>{children}</ReviewSessionContext.Provider>;
}

/** 取当前评审会话（未包裹 Provider 即抛出——配置错误应尽早暴露）。 */
export function useReviewSession(): ReviewSession {
  const session = useContext(ReviewSessionContext);
  if (session === null) {
    throw new Error('useReviewSession 必须在 <ReviewProvider session={…}> 内使用');
  }
  return session;
}

/** 订阅当前文档快照（版本抽屉读它显示页数/节点数）。 */
export function useReviewDocument(session: ReviewSession): DesignDocument {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}

/** 订阅评论 UI 态片段。 */
export function useCommentsUi<T>(
  session: ReviewSession,
  selector: (state: CommentsUiState) => T,
): T {
  return useStore(session.comments, selector);
}

/** 订阅版本 UI 态片段。 */
export function useVersionsUi<T>(
  session: ReviewSession,
  selector: (state: VersionUiState) => T,
): T {
  return useStore(session.versions, selector);
}

/** 订阅视口（评论钉点跟随缩放/平移）。 */
export function useReviewViewport(session: ReviewSession): Viewport {
  return useSyncExternalStore(session.viewport.subscribeViewport, session.viewport.getViewport);
}
