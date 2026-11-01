/**
 * @dforge/daemon · 按 key 串行化的异步互斥（Q2 并发修复的基座）。
 *
 * 纪律：**同一 key 的任务严格串行**（FIFO），不同 key 互不阻塞。
 * 使用场景：`<id>.dfg/manifest.json` 的读改写（RMW）——无锁时
 * 10 并发 `POST /documents/:id/pages` 会各自读到同一份旧 manifest 再互相覆盖，
 * 造成「已回 201 的页面被丢弃」。
 *
 * 边界：**只在进程内串行**（Map 按 key 排队，另一个 daemon 进程看不见它）。跨进程没有互斥——
 * 退化为一套**可判定的提交协议**（见 store.ts 的 `commitManifest`）：每次提交带独有身份
 * （manifest 里的 `commitNonce`）+ 对上一份 manifest 字节的 CAS（`fs-atomic.claimCommit` 的
 * O_EXCL 声明 + 改名前复查 base + 复读比字节全等），使**并发写者中最多一个判定成功**、
 * 其余拿到带类型 `conflict`（409）；重试上界 `MAX_COMMIT_ATTEMPTS` 用尽即返回该错误码。
 * 注意别把话说过头：协议保证的是「一笔提交最多一个赢家 / 成功次数 == 版本前进数」，
 * **不**保证「同一文档同一时刻只有一个写者在跑」，也不覆盖读-改-写全程的跨进程交错——
 * 那需要真正的跨进程文档锁（票 21）。
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
