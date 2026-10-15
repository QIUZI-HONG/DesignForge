// @vitest-environment jsdom
/**
 * 草稿态 + 300ms 提交调度（C5：「blur/debounce 300ms 提交」「连续拖拽只落一次命令」）。
 *
 * 这些用例是**提交时序的规格**：输入期间只改草稿，提交时刻才发命令
 * （撤销粒度 = 一次修改）；Esc 回滚草稿；无变更不产生空命令。
 * 用 fake timers 断言「连续变更只提交一次」。
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMIT_DELAY_MS, useDraftCommit } from './draft';

describe('useDraftCommit（300ms 提交语义）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('连续变更在静默 300ms 后只提交一次（提交值为最后一次草稿）', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDraftCommit<number>({ value: 0, commit }));

    act(() => result.current.setDraft(10));
    act(() => result.current.setDraft(20));
    act(() => result.current.setDraft(30));

    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS - 1));
    expect(commit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(30);
  });

  it('变更间隔小于窗口时计时重置（持续输入期间不提交）', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDraftCommit<number>({ value: 0, commit }));

    act(() => result.current.setDraft(1));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.setDraft(2));
    act(() => vi.advanceTimersByTime(200));
    expect(commit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(100));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(2);
  });

  it('flush 立即提交未落盘的草稿（Enter/blur 语义），且不再二次提交', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDraftCommit<number>({ value: 0, commit }));

    act(() => result.current.setDraft(42));
    act(() => result.current.flush());
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(42);

    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS * 3));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('cancel 丢弃草稿且不提交（Esc 语义），显示回落到外部值', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDraftCommit<number>({ value: 5, commit }));

    act(() => result.current.setDraft(99));
    expect(result.current.draft).toBe(99);

    act(() => result.current.cancel());
    expect(result.current.draft).toBeNull();

    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS * 3));
    expect(commit).not.toHaveBeenCalled();
  });

  it('无草稿时 flush 是空操作（不产生空命令）', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDraftCommit<number>({ value: 5, commit }));

    act(() => result.current.flush());
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS * 3));
    expect(commit).not.toHaveBeenCalled();
  });

  it('提交后 pending 复位，可再次提交（连续两轮修改 = 两条命令）', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDraftCommit<number>({ value: 0, commit }));

    act(() => result.current.setDraft(1));
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS));
    act(() => result.current.setDraft(2));
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS));

    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenNthCalledWith(1, 1);
    expect(commit).toHaveBeenNthCalledWith(2, 2);
  });

  it('外部值更新不覆盖未提交的草稿（输入期以草稿为准）', () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }: { value: number }) => useDraftCommit<number>({ value, commit }),
      { initialProps: { value: 0 } },
    );

    act(() => result.current.setDraft(7));
    rerender({ value: 100 });
    expect(result.current.draft).toBe(7);

    act(() => result.current.flush());
    expect(commit).toHaveBeenCalledWith(7);
  });

  it('卸载时丢弃未提交的草稿（不留悬挂计时器）', () => {
    const commit = vi.fn();
    const { result, unmount } = renderHook(() => useDraftCommit<number>({ value: 0, commit }));

    act(() => result.current.setDraft(11));
    unmount();
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS * 3));
    expect(commit).not.toHaveBeenCalled();
  });
});
