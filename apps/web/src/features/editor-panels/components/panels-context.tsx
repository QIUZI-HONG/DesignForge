'use client';

/**
 * 面板会话的 React 上下文。
 *
 * 为什么用 context 而不是全局单例：编辑器可能同时存在多个文档会话（本地优先 + 多窗口），
 * 会话由壳层（FE-03）创建后注入；组件树里任何面板都能取到同一个会话——
 * 这就是「画布与面板同源」在 React 侧的表达。
 */
import { createContext, type ReactNode, useContext } from 'react';

import type { PanelsSession } from '../session';

const PanelsSessionContext = createContext<PanelsSession | null>(null);

/** 会话 Provider（壳层/测试在组件树根部包一层）。 */
export function PanelsProvider({
  session,
  children,
}: {
  session: PanelsSession;
  children: ReactNode;
}) {
  return <PanelsSessionContext.Provider value={session}>{children}</PanelsSessionContext.Provider>;
}

/** 取当前面板会话（未包裹 Provider 即抛出——配置错误应尽早暴露）。 */
export function usePanelsSession(): PanelsSession {
  const session = useContext(PanelsSessionContext);
  if (session === null) {
    throw new Error('usePanelsSession 必须在 <PanelsProvider session={…}> 内使用');
  }
  return session;
}
