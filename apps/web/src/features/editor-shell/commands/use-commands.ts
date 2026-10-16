'use client';

// React 绑定层（`registry.ts` 保持零 React 依赖：命令在非 React 路径也要可达）。

/**
 * `useCommandList` —— 命令表的 React 订阅（命令面板 E7 与快捷键说明 E8 共用）。
 *
 * 为什么走 `useSyncExternalStore` 而不是 Zustand：命令表是**模块单例 + 命令式注册**
 * （FE-08 在自己的目录里注册组件命令），订阅语义就是「外部 store」；
 * 用 `getCommandsSnapshot()` 的稳定引用满足 React 的快照要求。
 */
import { useSyncExternalStore } from 'react';

import { type Command, getCommandsSnapshot, subscribeCommands } from './registry';

/**
 * 取当前命令表（快照）。
 *
 * @returns 命令快照（订阅注册表变化自动重渲染）
 */
export function useCommandList(): Command[] {
  return useSyncExternalStore(
    subscribeCommands,
    getCommandsSnapshot,
    getCommandsSnapshot, // SSR：与客户端首帧同源，避免水合不一致
  );
}

/** 取单条命令（未注册 → `undefined`；用于「按 id 决定入口是否可点」的场景）。 */
export function useCommand(id: string): Command | undefined {
  return useCommandList().find((command) => command.id === id);
}
