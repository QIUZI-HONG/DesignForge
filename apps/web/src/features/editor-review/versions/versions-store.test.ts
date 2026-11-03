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
import { createMemoryBackend, type KeyValueBackend, versionsKey } from '../storage';
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
    nextId: () => {
      counter += 1;
      return `snap-${String(counter)}`;
    },
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

describe('版本 store · 存储健壮性（US11 守护 · TC-LS-01/02）', () => {
  /**
   * 守护口径（TC-LS-01/02 + storage.ts「存储是可丢的缓存」契约）：
   * 写入失败（配额）只回调 onWriteError，不炸界面、不落半条；
   * 隐私模式两档（backend undefined / getItem 抛 SecurityError）全链降级。
   * storage.test.ts:63-81 已在 createLocalStore 缝上盖基础档；本组在版本 store
   * 缝上钉住上层接线：onWriteError 原样透传、快照列表一致、UI 态照常。
   */
  function setupWith(backend: KeyValueBackend | undefined) {
    let counter = 0;
    const onWriteError = vi.fn();
    const run = vi.fn();
    const store = createVersionStore({
      documentId: 'doc-1',
      getDocument: () => makeDoc(),
      run,
      backend,
      now: () => new Date('2026-10-15T10:00:00.000Z'),
      nextId: () => {
        counter += 1;
        return `snap-${String(counter)}`;
      },
      onWriteError,
    });
    return { store, onWriteError, run };
  }

  it('配额失败：onWriteError 收到原始 error、落盘无半条、UI 态照常', () => {
    const quotaError = new DOMException('配额已满', 'QuotaExceededError');
    const memory = createMemoryBackend();
    let failWrites = false;
    const backend: KeyValueBackend = {
      getItem: (key) => memory.getItem(key),
      setItem: (key, value) => {
        if (failWrites) throw quotaError;
        memory.setItem(key, value);
      },
      removeItem: (key) => memory.removeItem(key),
    };
    const { store, onWriteError } = setupWith(backend);

    // 基线：第一次保存成功落盘，无误报
    store.getState().capture('第一版');
    expect(onWriteError).not.toHaveBeenCalled();

    // 第二次写触发配额失败：不炸界面，capture 照常返回
    failWrites = true;
    const second = store.getState().capture('第二版');
    expect(second.label).toBe('第二版');
    // UI 态照常：内存列表含新快照（存储是可丢缓存，写失败不回滚会话内状态；
    // 两条同 createdAt，次序按 id 稳定兜底——次序语义归 sortSnapshots，此处不断言）
    const labels = store.getState().snapshots.map((item) => item.label);
    expect(labels).toHaveLength(2);
    expect(labels).toEqual(expect.arrayContaining(['第一版', '第二版']));
    // 原始 error 原样透传（上层据此提示「本地保存失败」）
    expect(onWriteError).toHaveBeenCalledTimes(1);
    expect(onWriteError.mock.calls[0]?.[0]).toBe(quotaError);

    // 落盘无半条：后端仍是第一次的完整列表（单键整写，失败即整条不落）
    const persisted: unknown = JSON.parse(memory.getItem(versionsKey('doc-1')) ?? 'null');
    expect((persisted as Array<{ label: string }>).map((item) => item.label)).toEqual(['第一版']);

    // 重开 store 读到的也是完整旧列表：半条不进界面
    const reopened = setupWith(backend).store;
    const reopenedLabels = reopened.getState().snapshots.map((item) => item.label);
    expect(reopenedLabels).toEqual(['第一版']);
  });

  it('隐私模式第一档（backend undefined，非浏览器环境）：读写空操作，会话内 UI 照常', () => {
    const { store, onWriteError, run } = setupWith(undefined);

    // 无后端可读：初始列表空、不抛错
    expect(store.getState().snapshots).toEqual([]);

    // 会话内体验照常：capture 可用、两步确认全链不炸
    const snap = store.getState().capture('第一版');
    expect(store.getState().snapshots.map((item) => item.id)).toEqual([snap.id]);
    store.getState().beginCompare(snap.id);
    store.getState().confirmRestore('回滚前自动保存');
    expect(run).toHaveBeenCalledTimes(1);

    // 无写动作发生，onWriteError 不误报；重开仍空（无持久化 = 会话内有效）
    expect(onWriteError).not.toHaveBeenCalled();
    expect(setupWith(undefined).store.getState().snapshots).toEqual([]);
  });

  it('隐私模式第二档（getItem 抛 SecurityError）：加载当空不炸，会话内照常可用', () => {
    const memory = createMemoryBackend();
    const backend: KeyValueBackend = {
      getItem: () => {
        throw new DOMException('拒绝访问（隐私模式）', 'SecurityError');
      },
      setItem: (key, value) => memory.setItem(key, value),
      removeItem: (key) => memory.removeItem(key),
    };
    const { store, onWriteError } = setupWith(backend);

    // 读路径抛错被吞成空列表：不炸加载、不误报写失败
    expect(store.getState().snapshots).toEqual([]);
    expect(onWriteError).not.toHaveBeenCalled();

    // 会话内照常：capture 正常并真实落盘
    const snap = store.getState().capture('第一版');
    expect(store.getState().snapshots.map((item) => item.id)).toEqual([snap.id]);
    expect(memory.getItem(versionsKey('doc-1'))).toContain('第一版');
  });
});
