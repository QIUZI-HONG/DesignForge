/**
 * 帧循环（`requestAnimationFrame`，`_shared.md` §3：渲染循环走 rAF）。
 *
 * 语义：`request()` 只登记「需要重画」，同一帧内的多次请求合并成一次绘制
 * （拖动期间每 8ms 来一次 pointermove 也只画一帧）；`stop()` 后不再调度。
 */

/** rAF/取消函数（测试注入以便用假时钟驱动）。 */
export interface FrameScheduler {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

/** 帧循环。 */
export interface FrameLoop {
  /** 请求下一帧重画（幂等合并）。 */
  request(): void;
  /** 立即同步重画一次（门禁/断言需要在事件后立刻有帧）。 */
  renderNow(): void;
  /** 停止循环（可再 request 重新启动）。 */
  stop(): void;
  /** 已完成的绘制帧数。 */
  readonly renderedFrames: number;
  /** 是否处于运行中（已登记或正在绘制）。 */
  readonly running: boolean;
}

/** 默认调度器：浏览器 rAF；无 rAF 环境退化为 setTimeout(0)。 */
export function defaultScheduler(): FrameScheduler {
  if (typeof requestAnimationFrame === 'function') {
    return {
      request: (callback) => requestAnimationFrame(callback),
      cancel: (handle) => cancelAnimationFrame(handle),
    };
  }
  return {
    // 退化宿主（无 rAF 的测试/SSR 环境）：句柄按 number 归一——浏览器本就返回 number，
    // Node 类型下句柄是 Timeout 对象（Symbol.toPrimitive 可取数值 id），Number() 归一
    // 运行时零包装（quality-p1 · B11：替代两处 `as unknown as` 双跳，不改行为）。
    request: (callback) => Number(setTimeout(() => callback(Date.now()), 0)),
    cancel: (handle) => clearTimeout(handle),
  };
}

/** 创建帧循环。 */
export function createFrameLoop(
  draw: () => void,
  scheduler: FrameScheduler = defaultScheduler(),
): FrameLoop {
  let handle: number | null = null;
  let frames = 0;
  let stopped = false;

  const run = (): void => {
    handle = null;
    if (stopped) return;
    draw();
    frames += 1;
  };

  return {
    request(): void {
      if (handle !== null) return;
      stopped = false;
      handle = scheduler.request(() => run());
    },
    renderNow(): void {
      if (handle !== null) {
        scheduler.cancel(handle);
        handle = null;
      }
      stopped = false;
      run();
    },
    stop(): void {
      stopped = true;
      if (handle !== null) {
        scheduler.cancel(handle);
        handle = null;
      }
    },
    get renderedFrames(): number {
      return frames;
    },
    get running(): boolean {
      return handle !== null;
    },
  };
}
