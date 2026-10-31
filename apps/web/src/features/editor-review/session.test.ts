/**
 * 评审会话跨文档隔离测试（seam：`session.ts` 的对外行为；票 #03 / 证据 §A3）。
 *
 * 缺陷现场：`documentId` 在会话首次创建时冻结（实际冻结的是占位文档 `doc-editor`），
 * 路由级单例跨 SPA 导航存活 → 整页会话所有文档共用一个 localStorage 键：
 * 文档 A 的评论钉点出现在文档 B 上；对 B「恢复」A 的快照把 A 整体写进 B。
 *
 * 断言口径：
 * 1. `documentId` 随当前文档动态解析——不在创建时冻结；
 * 2. 跨文档：A 评论 → 切 B → B 无 A 的评论（内存态与持久化桶两处都隔离）；
 * 3. 切回原文档：桶里数据原样回来（按文档分桶，不丢数据）；
 * 4. 显式 `documentId`（独立挂载/单测口径）保持创建时固定——键空间显式给定语义不变。
 *
 * 载入机制对齐生产：工作区「载入文档」是对**同一命令栈** `document.replace` 换血
 * （`adoptDocumentInto` 的唯一写入口），因此测试用真实 `CommandStack` + 假端口
 * （栈订阅转发，与 `createWorkspaceDocumentPort` 同形）驱动，不 mock 命令栈。
 */
import {
  CommandStack,
  createDocument,
  createPage,
  type DesignDocument,
  type PageId,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';
import { commentsKey, createMemoryBackend, versionsKey } from './storage';
import { createReviewSession, type ReviewDocumentPort } from './session';

/** 造一份最小可编辑文档（id 即持久化桶的隔离键）。 */
function doc(id: string): DesignDocument {
  return createDocument({ id, name: `文档 ${id}`, pages: [createPage({ id: `${id}-p1` })] });
}

/**
 * 假文档端口（与 `createWorkspaceDocumentPort` 同形：`getStack` 动态解析 + 栈订阅转发）。
 * 生产里「载入换文档」是同一栈上的 `document.replace`，订阅链路与此一致。
 */
function portOf(stack: CommandStack): ReviewDocumentPort {
  return {
    getStack: () => stack,
    getPageId: () => stack.document.pages[0]?.id as PageId,
    subscribe: (listener) => stack.subscribe(() => listener()),
  };
}

/** 生产载入路径的等价驱动：`document.replace` 换血（`adoptDocumentInto` 同一写入口）。 */
function loadDocument(stack: CommandStack, id: string): void {
  stack.dispatch({ type: 'document.replace', document: doc(id) }, { label: '载入文档' });
}

describe('评审会话 · 文档标识动态解析（#03 / 证据 §A3）', () => {
  it('documentId 随当前文档动态解析：载入换血后跟随新文档（不再冻结在创建时的占位文档）', () => {
    const backend = createMemoryBackend();
    const stack = new CommandStack(doc('doc-editor')); // /editor 直开的占位文档现场
    const session = createReviewSession({ documentPort: portOf(stack), backend });
    expect(session.documentId).toBe('doc-editor'); // 创建时尚未载入

    loadDocument(stack, 'doc-a');
    expect(session.documentId).toBe('doc-a');
    loadDocument(stack, 'doc-b');
    expect(session.documentId).toBe('doc-b');
  });

  it('显式 documentId 固定键空间（独立挂载/单测口径：不随换文档解析）', () => {
    const backend = createMemoryBackend();
    const stack = new CommandStack(doc('doc-a'));
    const session = createReviewSession({
      documentPort: portOf(stack),
      documentId: 'pinned',
      backend,
    });
    loadDocument(stack, 'doc-b');
    expect(session.documentId).toBe('pinned');
  });
});

describe('评审会话 · 评论跨文档隔离（#03）', () => {
  it('A 评论 → 切 B：B 无 A 的评论（内存态与桶两处隔离）；切回 A 评论原样回来', () => {
    const backend = createMemoryBackend();
    const stack = new CommandStack(doc('doc-editor'));
    const session = createReviewSession({ documentPort: portOf(stack), backend });

    // 在 A 上留一条评论（走真实写路径：起草 → 提交）
    loadDocument(stack, 'doc-a');
    session.comments.getState().beginDraft({ x: 1, y: 2 });
    expect(session.comments.getState().submitDraft('A 的评审意见').ok).toBe(true);
    expect(session.comments.getState().threads).toHaveLength(1);
    expect(backend.getItem(commentsKey('doc-a'))).toContain('A 的评审意见');

    // 切到 B：线程内存态换到 B 的桶 —— B 看不到 A 的任何评论
    loadDocument(stack, 'doc-b');
    expect(session.comments.getState().threads).toEqual([]);
    expect(backend.getItem(commentsKey('doc-b'))).toBeNull();
    // 跨文档的临时评论态一并收摊（草稿锚点属于旧文档的画布）
    expect(session.comments.getState().draftAnchor).toBeNull();

    // 切回 A：A 的评论从桶里原样回来（分桶不丢数据）
    loadDocument(stack, 'doc-a');
    expect(session.comments.getState().threads.map((thread) => thread.body)).toEqual([
      'A 的评审意见',
    ]);
  });
});

describe('评审会话 · 版本快照跨文档隔离（#03：恢复即整文档覆盖的切断）', () => {
  it('A 存版本 → 切 B：恢复列表无 A 快照，A 的快照恢复不进 B；切回 A 快照在且可正常恢复', () => {
    const backend = createMemoryBackend();
    const stack = new CommandStack(doc('doc-editor'));
    const session = createReviewSession({ documentPort: portOf(stack), backend });

    // 在 A 上存一份版本快照
    loadDocument(stack, 'doc-a');
    const snapshot = session.versions.getState().capture('A 的第一版');
    expect(session.versions.getState().snapshots).toHaveLength(1);
    expect(backend.getItem(versionsKey('doc-a'))).toContain('A 的第一版');

    // 切到 B：恢复列表换到 B 的桶——无 A 的任何快照
    loadDocument(stack, 'doc-b');
    const versions = session.versions.getState();
    expect(versions.snapshots).toEqual([]);
    expect(backend.getItem(versionsKey('doc-b'))).toBeNull();

    // 隔离断言：拿着 A 的快照 id 也恢复不进 B——
    // beginCompare 对列表外的 id 是空操作 → confirmRestore 无命令派发，
    // B 的文档内容不会被 A 的快照整文档覆盖（缺陷现场的破坏路径）
    versions.beginCompare(snapshot.id);
    expect(versions.compareId).toBeNull();
    versions.confirmRestore();
    expect(stack.document.id).toBe('doc-b');

    // 切回 A：快照原样回来，恢复自己的快照是合法路径（整文档替换后仍是 doc-a）
    loadDocument(stack, 'doc-a');
    expect(session.versions.getState().snapshots.map((item) => item.label)).toEqual([
      'A 的第一版',
    ]);
    session.versions.getState().beginCompare(snapshot.id);
    expect(session.versions.getState().compareId).toBe(snapshot.id);
    session.versions.getState().confirmRestore();
    expect(stack.document.id).toBe('doc-a');
  });
});
