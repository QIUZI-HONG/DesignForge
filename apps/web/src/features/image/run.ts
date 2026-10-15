/**
 * FE-10 · 出图任务轮询器（纯逻辑，零 React）。
 *
 * 口径（清单 F5）：提交返回任务句柄后，**按间隔轮询** `GET /image/runs/:runId` 推进进度条；
 * 到终态（succeeded / failed / canceled）即停表；用户取消走 `POST …/cancel`。
 * 轮询是「单飞」（上一次返回后才排下一次），避免慢响应下请求叠加。
 */
import type { ImageRunState, ImageRunStatus } from '@dforge/contracts';

/** 缺省轮询间隔（本地回环，出图本身秒级～十秒级）。 */
export const IMAGE_POLL_INTERVAL_MS = 1000;

/** 终态集合。 */
export const IMAGE_TERMINAL_STATES: readonly ImageRunState[] = ['succeeded', 'failed', 'canceled'];

/** 是否终态。 */
export function isTerminal(state: ImageRunState): boolean {
  return IMAGE_TERMINAL_STATES.includes(state);
}

/** 轮询器接口。 */
export interface ImageRunTracker {
  /** 停止轮询（幂等）。 */
  stop(): void;
  /** 取消任务（调 daemon 的 cancel；结果作为终态回调）。 */
  cancel(): Promise<ImageRunStatus | null>;
}

/** 轮询器需要的最小端口。 */
export interface ImageRunPort {
  status(runId: string): Promise<ImageRunStatus>;
  cancel(runId: string): Promise<ImageRunStatus>;
}

/** 创建轮询器：立即首查，之后按 `intervalMs` 单飞轮询，终态/出错即停。 */
export function trackImageRun(options: {
  runId: string;
  port: ImageRunPort;
  onUpdate: (status: ImageRunStatus) => void;
  onError: (error: unknown) => void;
  intervalMs?: number;
}): ImageRunTracker {
  const intervalMs = options.intervalMs ?? IMAGE_POLL_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = (): void => {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const poll = async (): Promise<void> => {
    if (stopped) return;
    let current: ImageRunStatus;
    try {
      current = await options.port.status(options.runId);
    } catch (error) {
      if (stopped) return;
      stop();
      options.onError(error);
      return;
    }
    if (stopped) return;
    options.onUpdate(current);
    if (isTerminal(current.state)) {
      stop();
      return;
    }
    timer = setTimeout(() => void poll(), intervalMs);
  };

  void poll();

  return {
    stop,
    async cancel(): Promise<ImageRunStatus | null> {
      try {
        const result = await options.port.cancel(options.runId);
        stop();
        options.onUpdate(result);
        return result;
      } catch (error) {
        if (!stopped) {
          stop();
          options.onError(error);
        }
        return null;
      }
    },
  };
}
