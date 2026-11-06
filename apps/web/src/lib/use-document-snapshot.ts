/**
 * 文档快照钩子：`CommandStack` → React（`useSyncExternalStore`）。
 *
 * 口径（_shared §3）：文档状态**不进 React state**——命令栈是唯一真值，
 * 这里只做订阅与取快照的胶水；`subscribe` 是实例方法，必须包一层再交给 React。
 *
 * 单源（audit-d10 · D-13）：此前本钩子在 inspector / inspect-export / editor-components
 * 三个 feature 各存一份逐字节相同拷贝，收敛为 `@/lib` 单源——依赖方向符合 ADR-0004
 * （features/* → lib/* 允许，lib/* → features/* 禁止；本模块只依赖 engine 与 react）。
 * 重复归一由 `scripts/tests/dedup-use-document-snapshot.test.mjs` 断言。
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
