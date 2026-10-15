// @vitest-environment jsdom
/**
 * 评论模式开关测试（seam：`CommentsModeToggle` 的可观测行为）。
 *
 * 断言口径：开关直接读写会话的评论模式；`aria-pressed` 反映状态（a11y 语义）；
 * 文案随状态切换（开启态提示「退出评论模式」）。
 */
import { createDocument, createPage } from '@dforge/engine';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReviewProvider } from '../review-context';
import { createReviewSession, type ReviewSession } from '../session';
import { createMemoryBackend } from '../storage';
import { CommentsModeToggle } from './CommentsModeToggle';

function renderToggle(): ReviewSession {
  const session = createReviewSession({
    document: createDocument({ id: 'doc-1', pages: [createPage({ id: 'p1' })] }),
    documentId: 'doc-1',
    pageId: 'p1',
    backend: createMemoryBackend(),
  });
  render(
    <ReviewProvider session={session}>
      <CommentsModeToggle />
    </ReviewProvider>,
  );
  return session;
}

describe('评论模式开关', () => {
  it('默认关闭：pressed=false，文案为「评论模式」', () => {
    renderToggle();
    const toggle = screen.getByRole('button', { name: '评论模式' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('点击开启并反映到会话状态与 aria-pressed', () => {
    const session = renderToggle();
    fireEvent.click(screen.getByRole('button', { name: '评论模式' }));
    expect(session.comments.getState().mode).toBe(true);
    expect(screen.getByRole('button', { name: '退出评论模式' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('外部改状态时开关同步（受控读法）', () => {
    const session = renderToggle();
    act(() => {
      session.comments.getState().setMode(true);
    });
    expect(screen.getByRole('button', { name: '退出评论模式' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
