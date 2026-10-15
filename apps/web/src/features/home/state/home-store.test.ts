/**
 * 首页 UI 态 store 测试（FE-02）。
 *
 * 状态边界（_shared §3）：Zustand 只放**界面态**（分区/视图/筛选/排序/搜索词/侧栏折叠 + 删除记录），
 * 文档真值来自 daemon（不进 store 深层）。删除记录在 store 内读写 localStorage，
 * 注入存储以便测试与 SSR（无 window）安全。
 */
import { describe, expect, it } from 'vitest';

import { TRASH_STORAGE_KEY } from '../lib/trash';
import { createHomeStore } from './home-store';

/** 内存版存储（替身：只实现 store 用到的两个方法）。 */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    dump: () => Object.fromEntries(data),
  };
}

describe('createHomeStore 默认值', () => {
  it('默认落在「最近」分区、网格视图、无筛选无搜索', () => {
    const store = createHomeStore({ storage: memoryStorage() });
    const state = store.getState();
    expect(state.section).toBe('recent');
    expect(state.viewMode).toBe('grid');
    expect(state.query).toBe('');
    expect(state.range).toBe('all');
    expect(state.sort).toBe('updated-desc');
    expect(state.sidebarCollapsed).toBe(false);
  });

  it('从存储载入删除记录（回收站分区）', () => {
    const storage = memoryStorage({
      [TRASH_STORAGE_KEY]: JSON.stringify([
        { id: '已删除', name: '已删除', deletedAt: '2026-10-15T09:00:00.000Z' },
      ]),
    });
    const store = createHomeStore({ storage });
    expect(store.getState().trashRecords.map((item) => item.id)).toEqual(['已删除']);
  });

  it('无 window（SSR/纯 node）时删除记录为空且不抛错', () => {
    const store = createHomeStore();
    expect(store.getState().trashRecords).toEqual([]);
  });
});

describe('createHomeStore 动作', () => {
  it('切换分区/视图/排序/时间范围与搜索词', () => {
    const store = createHomeStore({ storage: memoryStorage() });
    store.getState().setSection('trash');
    store.getState().setViewMode('list');
    store.getState().setSort('name-asc');
    store.getState().setRange('week');
    store.getState().setQuery('海报');

    const state = store.getState();
    expect([state.section, state.viewMode, state.sort, state.range, state.query]).toEqual([
      'trash',
      'list',
      'name-asc',
      'week',
      '海报',
    ]);
  });

  it('侧栏折叠可来回切换', () => {
    const store = createHomeStore({ storage: memoryStorage() });
    store.getState().toggleSidebar();
    expect(store.getState().sidebarCollapsed).toBe(true);
    store.getState().toggleSidebar();
    expect(store.getState().sidebarCollapsed).toBe(false);
  });

  it('记录删除：写入内存 + 落到存储（供下次进入首页仍能看到）', () => {
    const storage = memoryStorage();
    const store = createHomeStore({ storage });
    store.getState().recordDeletion({
      id: '海报 A',
      name: '海报 A',
      deletedAt: '2026-10-15T10:00:00.000Z',
    });

    expect(store.getState().trashRecords.map((item) => item.id)).toEqual(['海报 A']);
    const persisted = JSON.parse(storage.dump()[TRASH_STORAGE_KEY] ?? '[]') as unknown[];
    expect(persisted).toHaveLength(1);
  });

  it('彻底删除记录：从内存与存储同时移除', () => {
    const storage = memoryStorage();
    const store = createHomeStore({ storage });
    const record = { id: 'x', name: 'x', deletedAt: '2026-10-15T10:00:00.000Z' };
    store.getState().recordDeletion(record);
    store.getState().purgeTrashRecord('x');

    expect(store.getState().trashRecords).toEqual([]);
    expect(JSON.parse(storage.dump()[TRASH_STORAGE_KEY] ?? '[]')).toEqual([]);
  });

  it('两个 store 实例互不影响（测试隔离 + 多窗口语义）', () => {
    const a = createHomeStore({ storage: memoryStorage() });
    const b = createHomeStore({ storage: memoryStorage() });
    a.getState().setViewMode('list');
    expect(b.getState().viewMode).toBe('grid');
  });
});
