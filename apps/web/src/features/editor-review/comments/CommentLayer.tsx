'use client';

import { type CSSProperties, useState } from 'react';
/**
 * 评论钉点覆盖层（C12/F7 的画布侧）。
 *
 * 挂载口径：**覆盖画布视口**（绝对定位铺满宿主容器），宿主（FE-03 壳层/FE-06 画布）
 * 把它放在画布区域之上，两层共享同一块屏幕坐标系——钉点位置 = 引擎视口换算出的屏幕坐标
 * （`coords.ts`），所以缩放/平移时钉点天然跟随。
 *
 * 交互与无障碍（为什么用铺满的透明按钮而不是给 div 挂 onClick）：
 * - 落点是**真控件**「在画布上添加评论」——铺满视口的透明按钮：鼠标点哪就在哪落草稿，
 *   键盘 Tab 到它按回车则在视口中心落草稿（键盘等价路径，不是给 div 打补丁）；
 * - 评论模式关闭时整层不渲染钉点与落点按钮（与 Figma 一致：评论只在评论模式可见）；
 * - 钉点悬停/键盘聚焦 → 展开预览卡（作者 / 正文 / 回复数）；点击 → 打开线程面板；
 * - 草稿输入框里按 Esc 取消（与 Figma 的评论草稿一致）；已解决钉点有解决态样式与可读名。
 *
 * `data-df-*` 挂点是门禁取样契约（`scripts/verify-figma-review.mjs`），改动需同步脚本。
 */
import { t } from '@/i18n';
import { formatTimestamp } from '../format';
import { useCommentsUi, useReviewSession, useReviewViewport } from '../review-context';
import { commentStyles, reviewStyles } from '../styles';
import { hitTestPins, pinScreenPoint, worldAnchorAt } from './coords';

/** 命中半径（屏幕像素；缩小时可点性不变）。 */
const HIT_RADIUS_SCREEN = 16;
/** 预览卡/草稿卡相对钉点的偏移（避免压住钉点；几何计算，非样式裸值）。 */
const CARD_OFFSET = 14;

/** 评论层 props。 */
export interface CommentLayerProps {
  className?: string;
}

/** 评论钉点覆盖层。 */
export function CommentLayer({ className }: CommentLayerProps) {
  const session = useReviewSession();
  const viewport = useReviewViewport(session);
  const [error, setError] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState('');

  const mode = useCommentsUi(session, (state) => state.mode);
  const threads = useCommentsUi(session, (state) => state.threads);
  const hoveredThreadId = useCommentsUi(session, (state) => state.hoveredThreadId);
  const activeThreadId = useCommentsUi(session, (state) => state.activeThreadId);
  const draftAnchor = useCommentsUi(session, (state) => state.draftAnchor);

  const pageThreads = threads.filter((thread) => thread.pageId === session.pageId);
  const hovered =
    hoveredThreadId === null ? null : (threads.find((item) => item.id === hoveredThreadId) ?? null);

  /** 落草稿：屏幕点 → 世界锚点。 */
  const beginDraftAt = (screen: { x: number; y: number }): void => {
    setError(null);
    setDraftBody('');
    session.comments.getState().beginDraft(worldAnchorAt(viewport, screen));
  };

  /** 落点按钮：鼠标点哪落哪；键盘（无坐标）落视口中心；半径内的钉点优先打开线程。 */
  const handleSurfaceClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const hasPointer = event.clientX !== 0 || event.clientY !== 0;
    const screen = hasPointer
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : { x: rect.width / 2, y: rect.height / 2 };
    const hit = hitTestPins(pageThreads, viewport, screen, HIT_RADIUS_SCREEN);
    if (hit !== null) {
      session.comments.getState().setActive(hit);
      return;
    }
    beginDraftAt(screen);
  };

  const submitDraft = (): void => {
    const result = session.comments.getState().submitDraft(draftBody);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setDraftBody('');
  };

  const cancelDraft = (): void => {
    session.comments.getState().cancelDraft();
    setError(null);
    setDraftBody('');
  };

  return (
    <div
      className={className}
      data-df-comment-layer=""
      data-df-state={mode ? 'active' : 'idle'}
      style={commentStyles.layer}
    >
      {mode ? (
        <button
          type="button"
          data-df-comment-surface=""
          aria-label={t('review.comments.surfaceLabel')}
          style={commentStyles.surface}
          onClick={handleSurfaceClick}
        />
      ) : null}

      {mode
        ? pageThreads.map((thread) => {
            const screen = pinScreenPoint(viewport, thread.anchor);
            const state =
              thread.id === hoveredThreadId ? 'hover' : thread.resolved ? 'resolved' : 'default';
            const pinStyle: CSSProperties = {
              ...commentStyles.pin,
              left: `${String(screen.x)}px`,
              top: `${String(screen.y)}px`,
              ...(thread.resolved ? commentStyles.pinResolved : {}),
              ...(thread.id === activeThreadId ? commentStyles.pinActive : {}),
            };
            return (
              <button
                key={thread.id}
                type="button"
                data-df-comment-pin={thread.id}
                data-df-state={state}
                aria-label={t(
                  thread.resolved ? 'review.comments.pinResolvedLabel' : 'review.comments.pinLabel',
                  { body: thread.body },
                )}
                style={pinStyle}
                onMouseEnter={() => {
                  session.comments.getState().setHovered(thread.id);
                }}
                onMouseLeave={() => {
                  session.comments.getState().setHovered(null);
                }}
                onFocus={() => {
                  session.comments.getState().setHovered(thread.id);
                }}
                onBlur={() => {
                  session.comments.getState().setHovered(null);
                }}
                onClick={() => {
                  session.comments.getState().setActive(thread.id);
                }}
              >
                {String(thread.replies.length + 1)}
              </button>
            );
          })
        : null}

      {hovered !== null
        ? (() => {
            const screen = pinScreenPoint(viewport, hovered.anchor);
            return (
              <div
                data-df-comment-hover={hovered.id}
                data-df-state="hover"
                style={{
                  ...commentStyles.hoverCard,
                  left: `${String(screen.x + CARD_OFFSET)}px`,
                  top: `${String(screen.y + CARD_OFFSET)}px`,
                }}
              >
                <span style={commentStyles.threadHead}>
                  <span style={commentStyles.author}>{hovered.author}</span>
                  <span style={reviewStyles.meta}>{formatTimestamp(hovered.createdAt)}</span>
                </span>
                <span style={commentStyles.body}>{hovered.body}</span>
                {hovered.replies.map((reply) => (
                  <span key={reply.id} style={commentStyles.body}>
                    {reply.body}
                  </span>
                ))}
                <span style={reviewStyles.meta}>
                  {t('review.comments.replyCount', { count: hovered.replies.length })}
                </span>
              </div>
            );
          })()
        : null}

      {draftAnchor !== null
        ? (() => {
            const screen = pinScreenPoint(viewport, draftAnchor);
            return (
              <div
                data-df-comment-draft=""
                data-df-state="draft"
                style={{
                  ...commentStyles.draft,
                  left: `${String(screen.x + CARD_OFFSET)}px`,
                  top: `${String(screen.y + CARD_OFFSET)}px`,
                }}
              >
                <textarea
                  aria-label={t('review.comments.draft.placeholder')}
                  placeholder={t('review.comments.draft.placeholder')}
                  value={draftBody}
                  style={reviewStyles.textarea}
                  onChange={(event) => {
                    setDraftBody(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    event.stopPropagation();
                    cancelDraft();
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
                    className="dfg-btn dfg-btn--ghost dfg-btn--sm"
                    onClick={cancelDraft}
                  >
                    {t('review.comments.draft.cancel')}
                  </button>
                  <button
                    type="button"
                    className="dfg-btn dfg-btn--primary dfg-btn--sm"
                    onClick={submitDraft}
                  >
                    {t('review.comments.draft.submit')}
                  </button>
                </div>
              </div>
            );
          })()
        : null}
    </div>
  );
}
