'use client';

import { useState } from 'react';
/**
 * 评论线程面板（C12/F7 的面板侧）——右栏可挂载。
 *
 * 列表读法（`threads.ts` 的 `groupThreads`）：
 * - 「未解决」段按时间新→旧；点击条目即在下方展开线程（回复列表 + 回复输入）；
 * - 「已解决」段**默认折叠**（Figma 同款）：点分段头展开，条目不可再编辑（无回复输入）；
 *   每条条目自带**行内「重新打开」按钮**（始终可见，UX-06/UX-13 修复）——
 *   解决态不可再编辑是状态机的硬规则，界面不提供绕过路径，但重开必须一步可达；
 * - 画布钉点 → 悬停卡 → 线程面板仍是不受影响的既有观察路径。
 *
 * `data-df-*` 挂点是门禁取样契约（`scripts/verify-figma-review.mjs`）。
 */
import { t } from '@/i18n';
import { formatTimestamp } from '../format';
import { useCommentsUi, useReviewSession } from '../review-context';
import { commentStyles, reviewStyles } from '../styles';
import { groupsOf } from './comments-store';
import type { CommentThread } from './threads';

/** 线程面板 props。 */
export interface CommentThreadPanelProps {
  className?: string;
}

/** 评论线程面板。 */
export function CommentThreadPanel({ className }: CommentThreadPanelProps) {
  const session = useReviewSession();
  const threads = useCommentsUi(session, (state) => state.threads);
  const activeThreadId = useCommentsUi(session, (state) => state.activeThreadId);
  const resolvedExpanded = useCommentsUi(session, (state) => state.resolvedExpanded);

  const groups = groupsOf(threads.filter((thread) => thread.pageId === session.pageId));

  return (
    <section
      className={className}
      data-df-panel="comments"
      aria-label={t('review.comments.title')}
      style={reviewStyles.panel}
    >
      <header style={reviewStyles.panelHeader}>
        <span style={reviewStyles.panelTitle}>{t('review.comments.title')}</span>
      </header>
      <div style={reviewStyles.body}>
        {threads.length === 0 ? (
          <div data-df-sample="comments/empty" style={reviewStyles.empty}>
            <span style={reviewStyles.emptyTitle}>{t('review.comments.empty.title')}</span>
            <span style={reviewStyles.emptyDesc}>{t('review.comments.empty.desc')}</span>
          </div>
        ) : (
          <ul aria-label={t('review.comments.threads.label')} style={commentStyles.listReset}>
            {groups.open.map((thread) => (
              <ThreadItem key={thread.id} thread={thread} active={thread.id === activeThreadId} />
            ))}
          </ul>
        )}
      </div>

      {groups.resolved.length > 0 ? (
        <div data-df-sample="comments/resolved">
          <button
            type="button"
            data-df-comment-resolved-toggle=""
            aria-expanded={resolvedExpanded}
            aria-label={t('review.comments.resolved.toggleLabel', {
              count: groups.resolved.length,
            })}
            style={commentStyles.sectionToggle}
            onClick={() => {
              session.comments.getState().setResolvedExpanded(!resolvedExpanded);
            }}
          >
            <span>{t('review.comments.resolved.section', { count: groups.resolved.length })}</span>
            <span aria-hidden="true">{resolvedExpanded ? '▾' : '▸'}</span>
          </button>
          {resolvedExpanded ? (
            <ul
              aria-label={t('review.comments.resolved.section', { count: groups.resolved.length })}
              style={commentStyles.listReset}
            >
              {groups.resolved.map((thread) => (
                <ThreadItem key={thread.id} thread={thread} active={thread.id === activeThreadId} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** 单条线程（点击展开回复与操作）。 */
function ThreadItem({ thread, active }: { thread: CommentThread; active: boolean }) {
  const session = useReviewSession();
  const [replyBody, setReplyBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submitReply = (): void => {
    const result = session.comments.getState().reply(thread.id, replyBody);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setReplyBody('');
  };

  return (
    <li data-df-comment-thread={thread.id} data-df-state={thread.resolved ? 'resolved' : 'open'}>
      <button
        type="button"
        aria-label={t('review.comments.thread.label', { body: thread.body })}
        aria-expanded={active}
        style={{
          ...commentStyles.thread,
          ...commentStyles.threadToggle,
          ...(active ? commentStyles.threadActive : {}),
        }}
        onClick={() => {
          session.comments.getState().setActive(active ? null : thread.id);
        }}
      >
        <span style={commentStyles.threadHead}>
          <span style={commentStyles.author}>{thread.author}</span>
          <span style={reviewStyles.meta}>{formatTimestamp(thread.createdAt)}</span>
          {thread.resolved ? (
            <span style={{ ...reviewStyles.meta, color: 'inherit' }}>
              {t('review.comments.resolved.badge')}
            </span>
          ) : null}
        </span>
        <span style={commentStyles.body}>{thread.body}</span>
        {thread.replies.length > 0 ? (
          <span style={reviewStyles.meta}>
            {t('review.comments.replyCount', { count: thread.replies.length })}
          </span>
        ) : null}
      </button>

      {thread.resolved ? (
        // 显式「重新打开」入口（UX-06/UX-13）：已解决条目**在列表行里就能重开**，
        // 不藏在「展开分段 → 点条目 → 再点重开」的三跳路径后面（实测三次尝试未达）。
        // 画布钉点详情（点钉点 → 展开线程）仍是既有路径，二者写的是同一份状态。
        <div style={commentStyles.rowActions}>
          <button
            type="button"
            className="dfg-btn dfg-btn--secondary dfg-btn--sm"
            data-df-comment-reopen={thread.id}
            onClick={() => {
              session.comments.getState().reopen(thread.id);
            }}
          >
            {t('review.comments.reopen')}
          </button>
        </div>
      ) : null}

      {active ? (
        <div data-df-comment-thread-detail={thread.id} style={commentStyles.threadDetail}>
          <div style={commentStyles.reply}>
            {thread.replies.map((reply) => (
              <span key={reply.id} style={commentStyles.replyItem}>
                <span style={commentStyles.threadHead}>
                  <span style={commentStyles.author}>{reply.author}</span>
                  <span style={reviewStyles.meta}>{formatTimestamp(reply.createdAt)}</span>
                </span>
                <span style={commentStyles.body}>{reply.body}</span>
              </span>
            ))}
          </div>

          {thread.resolved ? null : (
            <>
              <textarea
                aria-label={t('review.comments.reply.placeholder')}
                placeholder={t('review.comments.reply.placeholder')}
                value={replyBody}
                style={reviewStyles.textarea}
                onChange={(event) => {
                  setReplyBody(event.target.value);
                }}
              />
              {error !== null ? (
                <span role="alert" style={reviewStyles.error}>
                  {error}
                </span>
              ) : null}
              <div style={reviewStyles.buttonRow}>
                <button
                  type="button"
                  className="dfg-btn dfg-btn--secondary dfg-btn--sm"
                  onClick={() => {
                    session.comments.getState().resolve(thread.id);
                  }}
                >
                  {t('review.comments.resolve')}
                </button>
                <button
                  type="button"
                  className="dfg-btn dfg-btn--primary dfg-btn--sm"
                  onClick={submitReply}
                >
                  {t('review.comments.reply.submit')}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}
