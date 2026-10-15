'use client';

/**
 * Present 入口按钮（C13 的「演示」入口，顶栏/工具栏插槽）。
 *
 * 与评论模式开关同一口径：只依赖会话的 Present store，FE-03 落地后直接放进插槽。
 * `data-df-present-toggle` 是门禁取样契约（verify-figma-review.mjs 用它进演示）。
 */
import { t } from '@/i18n';

import { PlayIcon } from '../icons';
import { useReviewSession } from '../review-context';
import { commentStyles } from '../styles';
import { usePresentUi } from './present-hooks';

/** 演示按钮 props。 */
export interface PresentButtonProps {
  className?: string;
}

/** 「演示」入口按钮。 */
export function PresentButton({ className }: PresentButtonProps) {
  const session = useReviewSession();
  const open = usePresentUi(session, (state) => state.open);

  return (
    <button
      type="button"
      className={className}
      data-df-present-toggle=""
      data-df-state={open ? 'active' : 'idle'}
      aria-pressed={open}
      title={open ? t('review.present.exit') : t('review.present.title')}
      style={
        open
          ? { ...commentStyles.modeToggle, ...commentStyles.modeToggleOn }
          : commentStyles.modeToggle
      }
      onClick={() => {
        if (open) {
          session.present.getState().exitPresentation();
          return;
        }
        session.present.getState().openPresentation();
      }}
    >
      <PlayIcon />
      <span>{open ? t('review.present.exit') : t('review.present.title')}</span>
    </button>
  );
}
