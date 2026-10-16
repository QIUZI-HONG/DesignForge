'use client';

/**
 * 评审会话 ⇄ 编辑器画布工作区的**文档端口**（C3/D-4 修复：文档真值同源）。
 *
 * 缺陷背景（实测）：评审会话原本 `createReviewSession()` 自建一份空文档，
 * 而画布工作区持有另一份（面板命令栈 + 画布会话共享）——于是画布上画出画板后，
 * 「演示」入口的 `enabled()` 读到的仍是空文档 → 恒禁用；版本快照、评论锚点同理脱钩。
 *
 * 本模块把「工作区文档真值」以 `ReviewDocumentPort` 暴露给评审会话：
 * - `getStack` / `getPageId` **动态解析**——载入/导入换栈后自动跟随（不抓死创建时那一份）；
 * - `subscribe` 同时覆盖两类变化：当前栈的文档变化 + 工作区单例被替换
 *   （`subscribeWorkspace`，见 canvas 的 `workspace-session.ts`）。
 *
 * 跨边界口径：`@/features/canvas` 是画布的公开面（feature→feature 只准走公开面），
 * 工作区单例的读写接缝已在该 barrel 显式导出。
 */
import { getWorkspace, subscribeWorkspace } from '@/features/canvas';

import type { ReviewDocumentPort } from './session';

/** 建「当前画布工作区」的文档端口（引用稳定：三个成员各挂一次，长期持有）。 */
export function createWorkspaceDocumentPort(): ReviewDocumentPort {
  return {
    getStack: () => getWorkspace().canvas.stack,
    getPageId: () => getWorkspace().canvas.page().id,
    subscribe: (listener) => {
      // 当前栈的文档变化
      let detachStack = getWorkspace().canvas.stack.subscribe(() => {
        listener();
      });
      // 工作区被替换（载入/导入换栈）→ 重订阅新栈并通知下游
      const detachWorkspace = subscribeWorkspace(() => {
        detachStack();
        detachStack = getWorkspace().canvas.stack.subscribe(() => {
          listener();
        });
        listener();
      });
      return () => {
        detachWorkspace();
        detachStack();
      };
    },
  };
}
