/**
 * 版本 store 测试（seam：`versions-store.ts` 的对外行为）。
 *
 * 断言口径（C14/F10 + briefs/fe-07.md §2）：
 * 抽屉开合、时间戳列表新→旧、**两步确认**（第一步只进对比、不落回滚）、
 * 确认后发出 `document.replace` 整文档替换命令。
 */

import type { Command, DesignDocument } from '@dforge/engine';
import { createDocument, createFrame, createPage, createRect, insertNode } from '@dforge/engine';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryBackend, versionsKey } from '../storage';
import { createVersionStore } from './versions-store';

/** 可变的当前文档句柄（store 通过 getDocument 读）。 */
function docHandle(initial: DesignDocument) {
  let current = initial;
  return {
    get: () => current,
    set: (next: DesignDocument) => {
      current = next;
    },
  };
}

function makeDoc(): DesignDocument {
  let doc = createDocument({ id: 'doc-1', name: '设计稿', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(doc, 'p1', createFrame({ id: 'f1', width: 100, height: 100 }), null);
  return doc;
}

function setup() {
  let counter = 0;
  let clock = 0;
  const dispatched: Array<{ commands: Command[]; label: string }> = [];
  const handle = docHandle(makeDoc());
  const backend = createMemoryBackend();
  const store = createVersionStore({
    documentId: 'doc-1',
    getDocument: handle.get,
    run: (commands, label) => {
      dispatched.push({ commands: [...commands], label });
    },
    backend,
    now: () => new Date(2026, 9, 15, 10, 0, clock++),
    nextId: () => `snap-${String((counter += 1))}`,
  });
  return { store, handle, dispatched, backend };
}

describe('版本 store · 抽屉与列表', () => {
  it('抽屉默认关闭，可开合（关闭时保留列表状态）', () => {
    const { store } = setup();
    expect(store.getState().open).toBe(false);
    store.getState().setOpen(true);
    expect(store.getState().open).toBe(true);
  });

  it('保存当前版本：抓取当时文档并持久化，列表新→旧', () => {
    const { store, handle, backend } = setup();
    const first = store.getState().capture('第一版');
    handle.set(
      insertNode(handle.get(), 'p1', createRect({ id: 'r1', width: 10, height: 10 }), null),
    );
    const second = store.getState().capture('第二版');
    expect(second.createdAt >= first.createdAt).toBe(true);
    expect(store.getState().snapshots.map((item) => item.id)).toEqual([second.id, first.id]);
    // 快照是深拷贝：第一版不含后面加的 r1
    expect(Object.keys(first.document.pages[0]?.nodes ?? {})).toEqual(['f1']);
    expect(backend.getItem(versionsKey('doc-1'))).toContain('第二版');
  });
});

describe('版本 store · 两步确认回滚', () => {
  it('第一步（开始对比）不落回滚：只标记对比对象，不派发命令', () => {
    const { store, dispatched } = setup();
    const snap = store.getState().capture('第一版');
    store.getState().beginCompare(snap.id);
    expect(store.getState().compareId).toBe(snap.id);
    expect(dispatched).toHaveLength(0);
  });

  it('第二步（确认恢复）派发 document.replace，并结束对比态', () => {
    const { store, dispatched } = setup();
    const snap = store.getState().capture('第一版');
    store.getState().beginCompare(snap.id);
    store.getState().confirmRestore();
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.commands.map((command) => command.type)).toEqual(['document.replace']);
    expect(store.getState().compareId).toBeNull();
  });

  it('未进对比态时确认恢复是空操作（防误触）', () => {
    const { store, dispatched } = setup();
    store.getState().capture('第一版');
    store.getState().confirmRestore();
    expect(dispatched).toHaveLength(0);
  });

  it('取消对比清空对比对象且不派发', () => {
    const { store, dispatched } = setup();
    const snap = store.getState().capture('第一版');
    store.getState().beginCompare(snap.id);
    store.getState().cancelCompare();
    expect(store.getState().compareId).toBeNull();
    expect(dispatched).toHaveLength(0);
  });

  it('对比数据 = 快照文档 vs 当前文档（供并排对比视图）', () => {
    const { store, handle } = setup();
    const snap = store.getState().capture('第一版');
    handle.set(
      insertNode(handle.get(), 'p1', createRect({ id: 'r1', width: 10, height: 10 }), null),
    );
    const diff = store.getState().diffOf(snap.id);
    expect(diff?.changed).toBe(true);
    expect(diff?.nodesAdded).toBe(1);
  });

  it('从存储恢复快照列表（同文档重开仍在）', () => {
    const backend = createMemoryBackend();
    const options = {
      documentId: 'doc-1',
      getDocument: () => makeDoc(),
      run: () => undefined,
      backend,
      now: () => new Date('2026-10-15T10:00:00.000Z'),
      nextId: () => 'snap-x',
    };
    const first = createVersionStore(options);
    first.getState().capture('第一版');
    const second = createVersionStore(options);
    expect(second.getState().snapshots.map((item) => item.label)).toEqual(['第一版']);
  });
});

describe('版本 store · 只读语义', () => {
  it('回滚不直接改文档对象：命令交给命令栈（run 注入）', () => {
    const run = vi.fn();
    const store = createVersionStore({
      documentId: 'doc-1',
      getDocument: () => makeDoc(),
      run,
      backend: createMemoryBackend(),
      now: () => new Date('2026-10-15T10:00:00.000Z'),
      nextId: () => 'snap-1',
    });
    const snap = store.getState().capture('第一版');
    store.getState().beginCompare(snap.id);
    store.getState().confirmRestore();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[1]).toBe('恢复版本');
  });
});
