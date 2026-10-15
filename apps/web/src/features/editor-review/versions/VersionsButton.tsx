'use client';

/**
 * 版本历史入口按钮（C14 的入口，顶栏/工具栏插槽）。
 *
 * 与评论模式开关、演示按钮同一口径：只依赖会话的版本 store，FE-03 落地后放进插槽。
 * `data-df-versions-toggle` 是门禁取样契约（verify-figma-review.mjs 用它开抽屉）。
 */
import { t } from '@/i18n';

import { HistoryIcon } from '../icons';
import { useReviewSession, useVersionsUi } from '../review-context';
import { commentStyles } from '../styles';

/** 版本历史按钮 props。 */
export interface VersionsButtonProps {
  className?: string;
}

/** 「版本历史」入口按钮。 */
export function VersionsButton({ className }: VersionsButtonProps) {
  const session = useReviewSession();
  const open = useVersionsUi(session, (state) => state.open);
  return (
    <button
      type="button"
      className={className}
      data-df-versions-toggle=""
      data-df-state={open ? 'active' : 'idle'}
      aria-pressed={open}
      title={t('review.versions.title')}
      style={
        open
          ? { ...commentStyles.modeToggle, ...commentStyles.modeToggleOn }
          : commentStyles.modeToggle
      }
      onClick={() => {
        session.versions.getState().setOpen(!open);
      }}
    >
      <HistoryIcon />
      <span>{t('review.versions.title')}</span>
    </button>
  );
}
