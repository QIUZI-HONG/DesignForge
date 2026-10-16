/**
 * @dforge/daemon · 按 key 串行化的异步互斥（Q2 并发修复的基座）。
 *
 * 纪律：**同一 key 的任务严格串行**（FIFO），不同 key 互不阻塞。
 * 使用场景：`<id>.dfg/manifest.json` 的读改写（RMW）——无锁时
 * 10 并发 `POST /documents/:id/pages` 会各自读到同一份旧 manifest 再互相覆盖，
 * 造成「已回 201 的页面被丢弃」。
 *
 * 边界：进程内锁；跨进程退化为「写前重读 + 内容比对 + 有界冲突重试」（见 store.ts），
 * 重试上界 `MAX_COMMIT_ATTEMPTS` 用尽则返回 `conflict`（409）——有明确上界与错误码。
 */

/** 按 key 串行执行器。 */
export interface KeyedMutex {
  /** 排队执行：同一 key 的上一个任务结束后才执行 `task`（前序失败不阻断后续）。 */
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** 当前在飞（含排队）的 key 数量——仅供测试断言无泄漏。 */
  size(): number;
}

/** 创建按 key 串行执行器。 */
export function createKeyedMutex(): KeyedMutex {
  const tails = new Map<string, Promise<void>>();
  return {
    async run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const queued = previous.then(() => task());
      // 链尾吞掉成败（后续任务只看「轮到我了」），并记录以便队列排空后回收
      const tail = queued.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, tail);
      try {
        return await queued;
      } finally {
        // 只有自己仍是最新链尾时才回收（否则让位给后来者）
        if (tails.get(key) === tail) tails.delete(key);
      }
    },
    size() {
      return tails.size;
    },
  };
}
