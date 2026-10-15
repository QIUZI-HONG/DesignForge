/**
 * 草稿态 + 300ms 提交调度（C5 核心交互语义）。
 *
 * 为什么需要这层：Inspector 的数值/文本输入在**输入期间只改本地草稿**，
 * 提交时刻才发命令——由此得到两条规格：
 * 1. 撤销粒度 = 一次修改（连续拖拽/连续敲键只落一条历史条目）；
 * 2. Esc 回滚零成本（草稿从未进入文档）。
 *
 * 计时口径：最后一次变更后静默 300ms 提交（trailing debounce）；
 * Enter/blur/pointerup 走 `flush()` 立即提交；Esc 走 `cancel()` 丢弃。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** 提交窗口（C5：blur/debounce 300ms）。语义常量而非视觉令牌，故不取 UI 令牌。 */
export const COMMIT_DELAY_MS = 300;

/** 草稿 + 提交句柄。 */
export interface DraftCommit<T> {
  /** 未提交的草稿；null = 无草稿（显示外部真值）。 */
  draft: T | null;
  /** 记录一次变更（重置 300ms 计时）。 */
  setDraft(value: T): void;
  /**
   * 只改草稿、**不安排自动提交**（拖拽 scrub 期间用：连续位移最终由 `flush()` 收口，
   * 保证「连续拖拽只落一次命令」，中途停顿也不会被 300ms 计时截断）。
   */
  setDraftLive(value: T): void;
  /** 立即提交（Enter/blur/pointerup）；无草稿时为空操作。 */
  flush(): void;
  /** 丢弃草稿（Esc/卸载）；不提交。 */
  cancel(): void;
}

/** 草稿提交钩子参数。 */
export interface DraftCommitOptions<T> {
  /** 外部真值（引擎当前值）。 */
  value: T;
  /** 提交回调（命令栈；一次调用 = 一条命令）。 */
  commit: (value: T) => void;
  /** 提交窗口覆盖（测试与特殊控件用）。 */
  delayMs?: number;
}

/**
 * 绑定「草稿 ↔ 提交」的钩子。
 *
 * 外部值变化**不覆盖未提交草稿**（输入期间以草稿为准）；草稿提交后回到外部真值显示。
 */
export function useDraftCommit<T>({
  value,
  commit,
  delayMs = COMMIT_DELAY_MS,
}: DraftCommitOptions<T>): DraftCommit<T> {
  const [draft, setDraftState] = useState<T | null>(null);
  // 事件处理器里的同步读/写（setState 是异步的，不能作为判定依据）
  const draftRef = useRef<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 提交回调随渲染更新（闭包捕获最新的 page/selection），但计时器只认最新一次
  const commitRef = useRef(commit);
  commitRef.current = commit;
  // 外部真值仅用于语义说明（草稿为空时组件直接显示它）；引用以免误判“未使用”
  void value;

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const commitNow = useCallback((): void => {
    clearTimer();
    const pending = draftRef.current;
    draftRef.current = null;
    setDraftState(null);
    if (pending !== null) commitRef.current(pending);
  }, [clearTimer]);

  const setDraft = useCallback(
    (next: T): void => {
      draftRef.current = next;
      setDraftState(next);
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        commitNow();
      }, delayMs);
    },
    [clearTimer, commitNow, delayMs],
  );

  const setDraftLive = useCallback(
    (next: T): void => {
      clearTimer(); // 拖拽期间抑制自动提交（由 pointerup 的 flush 收口）
      draftRef.current = next;
      setDraftState(next);
    },
    [clearTimer],
  );

  const cancel = useCallback((): void => {
    clearTimer();
    draftRef.current = null;
    setDraftState(null);
  }, [clearTimer]);

  // 卸载即丢弃草稿：不留悬挂计时器（提交必须在挂载期发生）
  useEffect(() => clearTimer, [clearTimer]);

  return { draft, setDraft, setDraftLive, flush: commitNow, cancel };
}
