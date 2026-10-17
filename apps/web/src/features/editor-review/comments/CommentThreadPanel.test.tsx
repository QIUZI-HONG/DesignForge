// @vitest-environment jsdom
/**
 * 线程面板测试（seam：`CommentThreadPanel` 的可观测行为）。
 *
 * 断言口径（C12/F7）：未解决 / 已解决分段；**已解决默认折叠**；
 * 回复入列表；解决态不可再编辑（无回复输入）+ 可重新打开；空态。
 */
import { createDocument, createFrame, createPage, insertNode } from '@dforge/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReviewProvider } from '../review-context';
import { createReviewSession, type ReviewSession } from '../session';
import { createMemoryBackend } from '../storage';
import { CommentThreadPanel } from './CommentThreadPanel';

function fixtureSession(): ReviewSession {
  let doc = createDocument({ id: 'doc-1', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(doc, 'p1', createFrame({ id: 'f1', width: 400, height: 300 }), null);
  let counter = 0;
  return createReviewSession({
    document: doc,
    documentId: 'doc-1',
    pageId: 'p1',
    author: '小林',
    backend: createMemoryBackend(),
    now: () => new Date('2026-10-15T10:00:00.000Z'),
    nextId: () => {
      counter += 1;
      return `c${String(counter)}`;
    },
  });
}

function renderPanel(session: ReviewSession = fixtureSession()) {
  render(
    <ReviewProvider session={session}>
      <CommentThreadPanel />
    </ReviewProvider>,
  );
  return session;
}

/** 造一条线程（可带回复/解决态）。 */
function seedThread(
  session: ReviewSession,
  body: string,
  options: { replies?: string[]; resolved?: boolean } = {},
): string {
  const comments = session.comments.getState();
  comments.beginDraft({ x: 0, y: 0 });
  comments.submitDraft(body);
  const id = session.comments.getState().threads.at(-1)?.id as string;
  for (const reply of options.replies ?? []) {
    session.comments.getState().reply(id, reply);
  }
  if (options.resolved === true) session.comments.getState().resolve(id);
  session.comments.getState().setActive(null);
  return id;
}

describe('线程面板 · 列表与空态', () => {
  it('无评论时显示空态文案', () => {
    renderPanel();
    expect(screen.getByText('还没有评论')).toBeDefined();
  });

  it('未解决线程默认展开首条为激活，显示作者与正文', () => {
    const session = renderPanel();
    act(() => {
      seedThread(session, '这里的间距太大了');
    });
    const list = screen.getByRole('list', { name: '评论线程列表' });
    expect(within(list).getByText('这里的间距太大了')).toBeDefined();
    expect(within(list).getAllByText('小林').length).toBeGreaterThan(0);
  });
});

describe('线程面板 · 回复与解决', () => {
  it('提交回复进入线程并渲染', () => {
    const session = renderPanel();
    act(() => {
      seedThread(session, '评审一下');
    });
    const id = session.comments.getState().threads[0]?.id as string;
    act(() => {
      session.comments.getState().setActive(id);
    });
    const input = screen.getByPlaceholderText('回复…');
    fireEvent.change(input, { target: { value: '收到，我来改' } });
    fireEvent.click(screen.getByRole('button', { name: '回复' }));
    expect(session.comments.getState().threads[0]?.replies).toHaveLength(1);
    expect(screen.getByText('收到，我来改')).toBeDefined();
  });

  it('解决后线程进入「已解决」段并默认折叠；展开后可见且不可再回复', () => {
    const session = renderPanel();
    act(() => {
      seedThread(session, '已经处理完', { replies: ['改好了'], resolved: true });
    });
    // 折叠态：正文不可见，只有分段头（含计数）；可访问名 = 面前缀 aria-label（批次 5 · D）
    const toggle = screen.getByRole('button', { name: '已解决评论分组（1）' });
    expect(toggle.getAttribute('aria-label')).toBe('已解决评论分组（1）');
    expect(screen.queryByText('已经处理完')).toBeNull();
    expect(screen.queryByPlaceholderText('回复…')).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByText('已经处理完')).toBeDefined();
    // 展开分段后点条目才进入详情：已解决线程没有回复输入（不可再编辑），只有「重新打开」
    expect(screen.queryByPlaceholderText('回复…')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '面板线程：已经处理完' }));
    expect(screen.queryByPlaceholderText('回复…')).toBeNull();
    expect(screen.getByRole('button', { name: '重新打开' })).toBeDefined();
  });

  it('「重新打开」把线程移回未解决段并恢复可回复', () => {
    const session = renderPanel();
    act(() => {
      seedThread(session, '需要再改一版', { resolved: true });
    });
    fireEvent.click(screen.getByRole('button', { name: '已解决评论分组（1）' }));
    fireEvent.click(screen.getByRole('button', { name: '面板线程：需要再改一版' }));
    fireEvent.click(screen.getByRole('button', { name: '重新打开' }));

    expect(session.comments.getState().threads[0]?.resolved).toBe(false);
    // 未解决段重新可回复（激活它以便输入框可见）
    const id = session.comments.getState().threads[0]?.id as string;
    act(() => {
      session.comments.getState().setActive(id);
    });
    expect(screen.getByPlaceholderText('回复…')).toBeDefined();
  });

  it('已解决的评论仍在列表可见（不消失，只折叠）', () => {
    const session = renderPanel();
    act(() => {
      seedThread(session, '遗留问题', { resolved: true });
    });
    expect(screen.getByRole('button', { name: '已解决评论分组（1）' })).toBeDefined();
    expect(session.comments.getState().threads).toHaveLength(1);
  });
});

describe('线程面板 · 可访问名面前缀（批次 5 · D）', () => {
  it('线程条目的可访问名以「面板线程：」开头', () => {
    const session = renderPanel();
    act(() => {
      seedThread(session, '前缀检查');
    });
    const item = screen.getByRole('button', { name: '面板线程：前缀检查' });
    expect(item.getAttribute('aria-label')?.startsWith('面板线程：')).toBe(true);
  });

  it('已解决分段开关的 aria-label 为「已解决评论分组（n）」，可见文本不变', () => {
    const session = renderPanel();
    act(() => {
      seedThread(session, '分组开关', { resolved: true });
    });
    const toggle = screen.getByRole('button', { name: '已解决评论分组（1）' });
    expect(toggle.getAttribute('aria-label')).toBe('已解决评论分组（1）');
    expect(toggle.textContent).toContain('已解决（1）');
  });
});
