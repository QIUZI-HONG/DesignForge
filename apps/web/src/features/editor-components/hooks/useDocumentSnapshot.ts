/**
 * 文档快照钩子：`CommandStack` → React（`useSyncExternalStore`）。
 *
 * 口径（_shared §3）：文档状态**不进 React state**——命令栈是唯一真值，
 * 这里只做订阅与取快照的胶水；`subscribe` 是实例方法，必须包一层再交给 React。
 */

import type { CommandStack, DesignDocument } from '@dforge/engine';
import { useCallback, useSyncExternalStore } from 'react';

/** 订阅命令栈的当前文档快照。 */
export function useDocumentSnapshot(stack: CommandStack): DesignDocument {
  const subscribe = useCallback(
    (onStoreChange: () => void) => stack.subscribe(() => onStoreChange()),
    [stack],
  );
  const getSnapshot = useCallback(() => stack.getSnapshot(), [stack]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
