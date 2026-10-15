'use client';

// React 侧插槽宿主（`registry.ts` 保持零 React 依赖）。

/**
 * `EditorSlotHost` —— 具名插槽宿主（编辑器壳层唯一挂载点）。
 *
 * 行为：按 `order` 升序渲染该槽全部注册项；槽为空时渲染 `fallback`（例如画布槽的空态）。
 * 不额外包 DOM：宿主容器的几何与样式由调用方（壳层）给，避免插槽引入无谓的布局层
 * （画布这类「铺满」内容最怕中间多一层）。
 */
import { Fragment, type ReactNode, useSyncExternalStore } from 'react';

import {
  type EditorSlotItem,
  type EditorSlotName,
  getEditorSlotSnapshot,
  subscribeEditorSlots,
} from './registry';

/** 订阅某槽的注册项（快照引用稳定，注册/反注册自动重渲染）。 */
export function useEditorSlotItems(slot: EditorSlotName): EditorSlotItem[] {
  return useSyncExternalStore(
    subscribeEditorSlots,
    () => getEditorSlotSnapshot(slot),
    () => getEditorSlotSnapshot(slot), // SSR：与客户端首帧同源
  );
}

/** 插槽宿主 props。 */
export interface EditorSlotHostProps {
  slot: EditorSlotName;
  /** 槽为空时的兜底内容（如画布槽的空态占位）。 */
  fallback?: ReactNode;
}

/** 具名插槽宿主。 */
export function EditorSlotHost({ slot, fallback }: EditorSlotHostProps) {
  const items = useEditorSlotItems(slot);
  if (items.length === 0) return <>{fallback ?? null}</>;
  return (
    <>
      {items.map((item) => (
        <Fragment key={item.id}>{item.render()}</Fragment>
      ))}
    </>
  );
}
