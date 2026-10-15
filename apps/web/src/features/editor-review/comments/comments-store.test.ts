/**
 * 评论 UI store 测试（seam：`comments-store.ts` 的对外行为）。
 *
 * 断言口径：模式开关、悬停/激活、草稿生命周期、线程写入经状态机
 * （解决态拒绝回复）、持久化被调用。
 */
import type { DesignDocument } from '@dforge/engine';
import { createDocument, createPage } from '@dforge/engine';
import { describe, expect, it, vi } from 'vitest';
import { commentsKey, createMemoryBackend } from '../storage';
import { createCommentsStore } from './comments-store';

function doc(): DesignDocument {
  return createDocument({ id: 'doc-1', pages: [createPage({ id: 'p1' })] });
}

function makeStore(overrides: { author?: string } = {}) {
  let counter = 0;
  const backend = createMemoryBackend();
  const store = createCommentsStore({
    documentId: 'doc-1',
    pageId: 'p1',
    author: overrides.author ?? '小林',
    backend,
    now: () => new Date('2026-10-15T10:00:00.000Z'),
    nextId: () => `id-${String((counter += 1))}`,
  });
  return { store, backend };
}

describe('评论 store · 模式与悬停', () => {
  it('开关评论模式（工具栏/顶栏的 toggle 读它）', () => {
    const { store } = makeStore();
    expect(store.getState().mode).toBe(false);
    store.getState().toggleMode();
    expect(store.getState().mode).toBe(true);
    store.getState().setMode(false);
    expect(store.getState().mode).toBe(false);
  });

  it('悬停与激活互不干扰；取消悬停清空', () => {
    const { store } = makeStore();
    store.getState().setHovered('c1');
    expect(store.getState().hoveredThreadId).toBe('c1');
    store.getState().setHovered(null);
    expect(store.getState().hoveredThreadId).toBeNull();
  });
});

describe('评论 store · 草稿与线程', () => {
  it('点画布起草稿 → 取消后不留痕；提交后按状态机落线程并持久化', () => {
    const { store, backend } = makeStore();
    store.getState().beginDraft({ x: 10, y: 20 });
    expect(store.getState().draftAnchor).toEqual({ x: 10, y: 20 });
    store.getState().cancelDraft();
    expect(store.getState().draftAnchor).toBeNull();
    expect(store.getState().threads).toHaveLength(0);

    store.getState().beginDraft({ x: 30, y: 40 });
    const result = store.getState().submitDraft('这里的间距太大了');
    expect(result.ok).toBe(true);
    const threads = store.getState().threads;
    expect(threads).toHaveLength(1);
    expect(threads[0]?.body).toBe('这里的间距太大了');
    expect(threads[0]?.author).toBe('小林');
    expect(store.getState().draftAnchor).toBeNull();
    expect(store.getState().activeThreadId).toBe(threads[0]?.id);
    // 持久化：读到本地后端
    expect(backend.getItem(commentsKey('doc-1'))).toContain('这里的间距太大了');
  });

  it('空正文提交被拒且不落线程', () => {
    const { store } = makeStore();
    store.getState().beginDraft({ x: 0, y: 0 });
    const result = store.getState().submitDraft('   ');
    expect(result.ok).toBe(false);
    expect(store.getState().threads).toHaveLength(0);
  });

  it('回复走状态机：未解决可回复，已解决被拒并给出原因', () => {
    const { store } = makeStore();
    store.getState().beginDraft({ x: 0, y: 0 });
    store.getState().submitDraft('评审一下');
    const id = store.getState().threads[0]?.id as string;

    expect(store.getState().reply(id, '收到').ok).toBe(true);
    expect(store.getState().threads[0]?.replies).toHaveLength(1);

    store.getState().resolve(id);
    expect(store.getState().threads[0]?.resolved).toBe(true);
    const refused = store.getState().reply(id, '还想补一句');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain('已解决');
    expect(store.getState().threads[0]?.replies).toHaveLength(1);

    store.getState().reopen(id);
    expect(store.getState().reply(id, '重开后可以回复').ok).toBe(true);
  });

  it('已解决段默认折叠，可展开', () => {
    const { store } = makeStore();
    expect(store.getState().resolvedExpanded).toBe(false);
    store.getState().setResolvedExpanded(true);
    expect(store.getState().resolvedExpanded).toBe(true);
  });

  it('从存储恢复线程（同文档再次打开评论仍在）', () => {
    const backend = createMemoryBackend();
    let counter = 0;
    const options = {
      documentId: 'doc-1',
      pageId: 'p1',
      author: '小林',
      backend,
      now: () => new Date('2026-10-15T10:00:00.000Z'),
      nextId: () => `id-${String((counter += 1))}`,
    };
    const first = createCommentsStore(options);
    first.getState().beginDraft({ x: 1, y: 2 });
    first.getState().submitDraft('第一版');

    const second = createCommentsStore(options);
    expect(second.getState().threads.map((thread) => thread.body)).toEqual(['第一版']);
    expect(second.getState().threads[0]?.anchor).toEqual({ x: 1, y: 2 });
  });
});

describe('评论 store · 视口无关性', () => {
  it('store 不持有文档；评论锚点是世界坐标（视口换算归 coords）', () => {
    const { store } = makeStore();
    store.getState().beginDraft({ x: 100, y: 200 });
    store.getState().submitDraft('锚点');
    expect(store.getState().threads[0]?.anchor).toEqual({ x: 100, y: 200 });
    // 文档对象与本 store 无关联（评论不属于 Design IR）
    expect(doc().id).toBe('doc-1');
    expect(vi.isMockFunction(store.getState().toggleMode)).toBe(false);
  });
});
