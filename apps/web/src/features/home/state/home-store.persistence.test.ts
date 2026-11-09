/**
 * 首页回收站册的持久化契约钉子（票 D 收编前先钉现状）。
 *
 * 补 home-store.test 未及的边缘语义，收编 lib `createLocalStore` 前后必须全绿
 * （断言零变化）：写入失败（配额满）按现状把异常暴露给调用栈
 * （recordDeletion / purgeTrashRecord 的 setItem 直接上抛），不静默吞。
 */
import { describe, expect, it } from 'vitest';

import { createHomeStore } from './home-store';

/** 写入必败的存储替身（getItem 正常、setItem 抛——模拟配额满）。 */
function quotaFullStorage() {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota');
    },
  };
}

describe('home-store · 回收站册写路径上抛（票 D 收编契约）', () => {
  it('recordDeletion 写入失败（配额满）异常上抛，不静默吞', () => {
    const store = createHomeStore({ storage: quotaFullStorage() });
    expect(() =>
      store
        .getState()
        .recordDeletion({ id: 'a', name: '文档 a', deletedAt: '2026-10-15T10:00:00.000Z' }),
    ).toThrow('quota');
  });

  it('purgeTrashRecord 写入失败（配额满）异常上抛，不静默吞', () => {
    const store = createHomeStore({ storage: quotaFullStorage() });
    expect(() => store.getState().purgeTrashRecord('a')).toThrow('quota');
  });
});
