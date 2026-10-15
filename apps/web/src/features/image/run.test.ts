/**
 * 出图任务轮询测试（seam：tracker 的对外行为——onUpdate/onError 序列与请求次数）。
 *
 * 口径（清单 F5）：提交后按间隔轮询 `/image/runs/:runId`，到终态即停；
 * 取消走 `POST /image/runs/:runId/cancel` 并落 canceled。用 fake timers 控制推进。
 */
import type { ImageRunStatus } from '@dforge/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackImageRun } from './run';

/** 构造任务状态（缺省字段）。 */
function status(overrides: Partial<ImageRunStatus> = {}): ImageRunStatus {
  return {
    runId: 'run-1',
    state: 'queued',
    queuePosition: null,
    progress: null,
    artifacts: [],
    provenance: null,
    failure: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('出图任务轮询', () => {
  it('提交即首查，此后按间隔推进：queued → running（带进度）→ succeeded 后停轮询', async () => {
    const updates: ImageRunStatus[] = [];
    const statusFn = vi
      .fn()
      .mockResolvedValueOnce(status({ state: 'queued', queuePosition: 2 }))
      .mockResolvedValueOnce(status({ state: 'running', progress: { value: 3, max: 20 } }))
      .mockResolvedValueOnce(status({ state: 'running', progress: { value: 12, max: 20 } }))
      .mockResolvedValueOnce(
        status({
          state: 'succeeded',
          artifacts: [
            {
              fileName: 'icon_00001.png',
              mimeType: 'image/png',
              sizeBytes: 2048,
              sha256: 'a'.repeat(64),
              storedPath: '/data/icon.png',
            },
          ],
        }),
      );
    const tracker = trackImageRun({
      runId: 'run-1',
      port: { status: statusFn, cancel: vi.fn() },
      intervalMs: 1000,
      onUpdate: (value) => updates.push(value),
      onError: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(updates.map((update) => update.state)).toEqual(['queued']);

    await vi.advanceTimersByTimeAsync(1000);
    expect(updates.at(-1)?.progress).toEqual({ value: 3, max: 20 });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(updates.at(-1)?.state).toBe('succeeded');
    expect(updates.at(-1)?.artifacts).toHaveLength(1);

    // 终态后停止轮询：再推进时间不再有新请求
    const callsAtEnd = statusFn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(statusFn.mock.calls.length).toBe(callsAtEnd);
    tracker.stop();
  });

  it('取消：调一次 cancel，落 canceled 终态并停表', async () => {
    const updates: ImageRunStatus[] = [];
    const cancelFn = vi.fn().mockResolvedValue(status({ state: 'canceled' }));
    const statusFn = vi
      .fn()
      .mockResolvedValue(status({ state: 'running', progress: { value: 1, max: 20 } }));
    const tracker = trackImageRun({
      runId: 'run-1',
      port: { status: statusFn, cancel: cancelFn },
      intervalMs: 1000,
      onUpdate: (value) => updates.push(value),
      onError: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(0);
    await tracker.cancel();
    expect(cancelFn).toHaveBeenCalledWith('run-1');
    expect(updates.at(-1)?.state).toBe('canceled');

    const callsAtEnd = statusFn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(statusFn.mock.calls.length).toBe(callsAtEnd);
  });

  it('stop()：停止后不再轮询、不再回调', async () => {
    const updates: ImageRunStatus[] = [];
    const statusFn = vi.fn().mockResolvedValue(status({ state: 'running' }));
    const tracker = trackImageRun({
      runId: 'run-1',
      port: { status: statusFn, cancel: vi.fn() },
      intervalMs: 1000,
      onUpdate: (value) => updates.push(value),
      onError: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    tracker.stop();
    const calls = statusFn.mock.calls.length;
    const seen = updates.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(statusFn.mock.calls.length).toBe(calls);
    expect(updates.length).toBe(seen);
  });

  it('轮询失败（如 daemon 不可达）：报错并停表（不无限重试）', async () => {
    const onError = vi.fn();
    const statusFn = vi.fn().mockRejectedValue(new Error('本地服务不可达'));
    trackImageRun({
      runId: 'run-1',
      port: { status: statusFn, cancel: vi.fn() },
      intervalMs: 1000,
      onUpdate: vi.fn(),
      onError,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    const calls = statusFn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(statusFn.mock.calls.length).toBe(calls);
  });
});
