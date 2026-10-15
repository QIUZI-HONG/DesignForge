/**
 * 保存态机（FE-09 · 清单 E3「保存态」：保存中 → 已保存 → 失败重试）。
 *
 * 纯 reducer：把「一次异步落库」的可见状态收敛成四相（idle / saving / saved / failed），
 * 组件只渲染 `state.phase`。为什么不用组件内部若干 boolean：失败后重试要保留
 * daemon 原始文案，且「保存中收到编辑」这类事件顺序需要被显式定义。
 */
import type { DaemonClientError } from '../api/daemon-client';

/** 保存相。 */
export type SavePhase = 'idle' | 'saving' | 'saved' | 'failed';

/** 保存态（`message` 仅在 failed 时有值：daemon 文案或连接失败说明）。 */
export interface SaveState {
  phase: SavePhase;
  message: string | null;
}

/** 初始保存态。 */
export const INITIAL_SAVE_STATE: SaveState = { phase: 'idle', message: null };

/** 保存事件。 */
export type SaveEvent =
  | { type: 'start' }
  | { type: 'succeeded' }
  | { type: 'failed'; message: string }
  | { type: 'edit' };

/** 归一化错误为展示文案（daemon 拒绝 → 原样文案；连接失败 → 客户端文案）。 */
export function saveErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as DaemonClientError).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return '保存失败：未知错误';
}

/** 状态迁移。 */
export function reduceSaveState(state: SaveState, event: SaveEvent): SaveState {
  switch (event.type) {
    case 'start':
      // 保存中重复 start 幂等：防双击/回车造成的重复提交
      return state.phase === 'saving' ? state : { phase: 'saving', message: null };
    case 'succeeded':
      return { phase: 'saved', message: null };
    case 'failed':
      return { phase: 'failed', message: event.message };
    case 'edit':
      // 在飞请求不被打断：编辑只清「已保存/失败」指示，落回 idle
      return state.phase === 'saving' ? state : { phase: 'idle', message: null };
  }
}
