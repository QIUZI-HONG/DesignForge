'use client';

import { useEffect, useRef, useState } from 'react';
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
 * - 草稿**出现即自动聚焦**（UX-13：落草稿后可直接打字，不用再点一次输入框）；
 *   空内容（去掉首尾空白）时「发布」按钮禁用——空评论不该能提交（store 侧还有一道拒绝）；
 * - 钉点悬停/键盘聚焦 → 展开预览卡（作者 / 正文 / 回复数）；点击 → 打开线程面板；
 * - 草稿输入框里按 Esc 取消（与 Figma 的评论草稿一致）；已解决钉点有解决态样式与可读名。
 *
 * 光标（UX-12）：评论模式下**画布区整体切十字**（`cursor: crosshair`）——
 * 由 `editor-shell.css` 的 `:has([data-df-comment-layer][data-df-state='active'])` 规则声明
 * （光标是继承属性，canvas 与其覆盖层都跟着变），本层根节点的 `data-df-state` 即开关信号。
 *
 * `data-df-*` 挂点是门禁取样契约（`scripts/verify-figma-review.mjs`），改动需同步脚本。
 */
import { t } from '@/i18n';
import { formatTimestamp } from '../format';
import { useCommentsUi, useReviewSession, useReviewViewport } from '../review-context';
import { hitTestPins, pinScreenPoint, worldAnchorAt } from './coords';

import '../review.css';

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
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  const mode = useCommentsUi(session, (state) => state.mode);
  const threads = useCommentsUi(session, (state) => state.threads);
  const hoveredThreadId = useCommentsUi(session, (state) => state.hoveredThreadId);
  const activeThreadId = useCommentsUi(session, (state) => state.activeThreadId);
  const draftAnchor = useCommentsUi(session, (state) => state.draftAnchor);

  // 草稿出现即聚焦（UX-13）：落点后直接进入打字，不用再点一次输入框。
  // 只依赖 draftAnchor：同一份草稿的重渲染（如引用更新）不重复抢焦点。
  useEffect(() => {
    if (draftAnchor === null) return;
    draftRef.current?.focus();
  }, [draftAnchor]);

  const pageThreads = threads.filter((thread) => thread.pageId === session.pageId);
  /** 空内容（含纯空白）不可发布：按钮禁用（store 侧对空正文另有一道拒绝）。 */
  const canSubmit = draftBody.trim().length > 0;
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
      className={className === undefined ? 'dfg-review__layer' : `${className} dfg-review__layer`}
      data-df-comment-layer=""
      data-df-state={mode ? 'active' : 'idle'}
    >
      {mode ? (
        <button
          type="button"
          data-df-comment-surface=""
          aria-label={t('review.comments.surfaceLabel')}
          className="dfg-review__comment-surface"
          onClick={handleSurfaceClick}
        />
      ) : null}

      {mode
        ? pageThreads.map((thread) => {
            const screen = pinScreenPoint(viewport, thread.anchor);
            const state =
              thread.id === hoveredThreadId ? 'hover' : thread.resolved ? 'resolved' : 'default';
            // 钉点屏幕坐标 = 世界坐标 × zoom + pan（几何算式，内联豁免——工单 06 登记表）；
            // 解决态/激活态由 data-df-state / data-df-active 挂点在 CSS 承接。
            const pinStyle = {
              left: `${String(screen.x)}px`,
              top: `${String(screen.y)}px`,
            };
            return (
              <button
                key={thread.id}
                type="button"
                data-df-comment-pin={thread.id}
                data-df-state={state}
                data-df-active={thread.id === activeThreadId ? 'true' : undefined}
                aria-label={t(
                  thread.resolved ? 'review.comments.pinResolvedLabel' : 'review.comments.pinLabel',
                  { body: thread.body },
                )}
                style={pinStyle}
                className="dfg-review__pin"
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
                className="dfg-review__hover-card"
                // 预览卡贴钉点右下（偏移量是几何算式，内联豁免——工单 06 登记表）
                style={{
                  left: `${String(screen.x + CARD_OFFSET)}px`,
                  top: `${String(screen.y + CARD_OFFSET)}px`,
                }}
              >
                <span className="dfg-review__thread-head">
                  <span className="dfg-review__author">{hovered.author}</span>
                  <span className="dfg-review__meta">{formatTimestamp(hovered.createdAt)}</span>
                </span>
                <span className="dfg-review__comment-body">{hovered.body}</span>
                {hovered.replies.map((reply) => (
                  <span key={reply.id} className="dfg-review__comment-body">
                    {reply.body}
                  </span>
                ))}
                <span className="dfg-review__meta">
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
                className="dfg-review__draft"
                // 草稿卡贴落点右下（偏移量是几何算式，内联豁免——工单 06 登记表）
                style={{
                  left: `${String(screen.x + CARD_OFFSET)}px`,
                  top: `${String(screen.y + CARD_OFFSET)}px`,
                }}
              >
                <textarea
                  ref={draftRef}
                  aria-label={t('review.comments.draft.placeholder')}
                  placeholder={t('review.comments.draft.placeholder')}
                  value={draftBody}
                  className="dfg-review__textarea"
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
                  <span role="alert" className="dfg-review__error">
                    {error}
                  </span>
                ) : null}
                <div className="dfg-review__button-row">
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
                    disabled={!canSubmit}
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
