/**
 * 本地存储层测试（seam：`createLocalStore` 的对外行为）。
 *
 * 契约（briefs/fe-07.md §1）：daemon 契约里没有版本/评论路由 → 走**本地快照目录**兜底。
 * 本地存储必须是「坏数据不炸界面」：JSON 损坏、形状不符一律当空列表返回，并保留原始数据不覆盖。
 */
import { describe, expect, it, vi } from 'vitest';
import { createLocalStore, type KeyValueBackend } from './storage';

/** 内存后端（模拟 localStorage）。 */
function memoryBackend(seed: Record<string, string> = {}): KeyValueBackend & {
  dump: () => Record<string, string>;
} {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    dump: () => Object.fromEntries(data),
  };
}

interface Item {
  id: string;
  createdAt: string;
}

function isItem(value: unknown): value is Item {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.createdAt === 'string';
}

const KEY = 'dfg:test:items';

describe('本地存储 · createLocalStore', () => {
  it('保存后能读回（JSON 持久化）', () => {
    const backend = memoryBackend();
    const store = createLocalStore<Item>({ key: KEY, backend, validate: isItem });
    store.save([{ id: 'a', createdAt: '2026-10-15T10:00:00.000Z' }]);
    expect(store.load()).toEqual([{ id: 'a', createdAt: '2026-10-15T10:00:00.000Z' }]);
    expect(JSON.parse(backend.dump()[KEY] ?? 'null')).toHaveLength(1);
  });

  it('坏 JSON 当空列表返回（不抛错）', () => {
    const backend = memoryBackend({ [KEY]: '{ 这不是 JSON' });
    const store = createLocalStore<Item>({ key: KEY, backend, validate: isItem });
    expect(store.load()).toEqual([]);
  });

  it('形状不符的条目被过滤，合法条目保留', () => {
    const backend = memoryBackend({
      [KEY]: JSON.stringify([{ id: 'a', createdAt: 'x' }, { nope: 1 }, 'string']),
    });
    const store = createLocalStore<Item>({ key: KEY, backend, validate: isItem });
    expect(store.load().map((item) => item.id)).toEqual(['a']);
  });

  it('无后端（非浏览器环境）时读写均为空操作', () => {
    const store = createLocalStore<Item>({ key: KEY, backend: undefined, validate: isItem });
    store.save([{ id: 'a', createdAt: 'x' }]);
    expect(store.load()).toEqual([]);
  });

  it('写入失败（配额等）不抛错，只回调 onWriteError', () => {
    const onWriteError = vi.fn();
    const backend: KeyValueBackend = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    const store = createLocalStore<Item>({ key: KEY, backend, validate: isItem, onWriteError });
    expect(() => store.save([{ id: 'a', createdAt: 'x' }])).not.toThrow();
    expect(onWriteError).toHaveBeenCalledTimes(1);
  });
});
