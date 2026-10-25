'use client';

/**
 * 评论模式开关（C12 的「评论模式开关进工具栏/顶栏」）。
 *
 * 为什么单独成一个组件而不塞进评论层：开关属于壳层（FE-03）的顶栏/工具栏插槽，
 * 本组件只依赖会话（读写 `comments` store 的 `mode`），FE-03 落地后直接放进插槽即可。
 * `data-df-comment-toggle` 是门禁取样契约（verify-figma-review.mjs 用它进评论模式）。
 */
import { t } from '@/i18n';
import { CommentPinIcon } from '../icons';
import { useCommentsUi, useReviewSession } from '../review-context';

import '../review.css';

/** 评论模式开关 props。 */
export interface CommentsModeToggleProps {
  className?: string;
}

/** 评论模式开关（顶栏/工具栏插槽；开启态由 aria-pressed 在 CSS 承接）。 */
export function CommentsModeToggle({ className }: CommentsModeToggleProps) {
  const session = useReviewSession();
  const mode = useCommentsUi(session, (state) => state.mode);
  return (
    <button
      type="button"
      className={
        className === undefined ? 'dfg-review__mode-toggle' : `${className} dfg-review__mode-toggle`
      }
      data-df-comment-toggle=""
      data-df-state={mode ? 'active' : 'idle'}
      aria-pressed={mode}
      title={mode ? t('review.comments.toggleOn') : t('review.comments.toggle')}
      onClick={() => {
        session.comments.getState().toggleMode();
      }}
    >
      <CommentPinIcon />
      <span>{mode ? t('review.comments.toggleOn') : t('review.comments.toggle')}</span>
    </button>
  );
}
