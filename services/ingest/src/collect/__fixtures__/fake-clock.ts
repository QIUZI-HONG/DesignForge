/**
 * 测试用虚拟时钟（夹具，不参与生产路径）。
 *
 * 设计：时间只在 `advance()` 中推进；`sleep()` 注册唤醒点，`advance()` 按唤醒时间
 * 顺序依次推进并唤醒——使令牌桶/退避的等待在测试里是确定性的（不依赖真实计时）。
 */

import type { Clock } from '../ratelimit.ts';

export class FakeClock implements Clock {
  private t: number;
  private waiters: { at: number; resolve: () => void }[] = [];

  constructor(startMs = 0) {
    this.t = startMs;
  }

  now(): number {
    return this.t;
  }

  sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiters.push({ at: this.t + ms, resolve });
    });
  }

  /** 推进虚拟时间，按顺序唤醒到期的 sleep；被唤醒代码新增的 sleep 也会被继续处理。 */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    let guard = 0;
    for (;;) {
      guard += 1;
      if (guard > 10_000) throw new Error('FakeClock.advance 死循环保护触发');
      await this.flush();
      const due = this.waiters.filter((w) => w.at <= target).sort((a, b) => a.at - b.at);
      const next = due[0];
      if (!next) break;
      this.waiters = this.waiters.filter((w) => w !== next);
      this.t = Math.max(this.t, next.at);
      next.resolve();
    }
    this.t = Math.max(this.t, target);
    await this.flush();
  }

  /** 每次推进若干微任务步：让被唤醒的异步链（可能又进入 sleep）走到下一次挂起点。 */
  private async flush(): Promise<void> {
    for (let i = 0; i < 200; i += 1) await Promise.resolve();
  }

  get pendingSleeps(): number {
    return this.waiters.length;
  }
}
