'use client';

import type { DocumentListWarning } from '@dforge/contracts';
/**
 * 首页状态视图（FE-02 · B7 空态三态 / B8 加载骨架 / F14 错误态 / 列表告警）。
 *
 * 为什么集中在一个文件：四者都是「列表不处于正常态」时的替身视图，共用同一容器几何
 * （内容区居中 / 骨架与 4 列网格同列宽），放一起才能保证切换时不跳版；文案全走 ICU。
 */
import { Button, EmptyState, ErrorState, SkeletonCard } from '@dforge/ui';

import { t } from '@/i18n';

import type { HomeEmptyKind } from '../lib/empty-kind';

/** 骨架卡片块数（B8：卡片骨架 3–5 块）。 */
export const SKELETON_CARD_COUNT = 4;

/** 列表加载骨架（4 列网格的占位；读屏由 role=status 播报载入中）。 */
export function HomeListSkeleton() {
  return (
    <div
      className="dfg-home__files dfg-home__files--skeleton"
      data-view="grid"
      role="status"
      aria-busy="true"
      aria-label={t('home.loading.list')}
    >
      {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
        <SkeletonCard key={`skeleton-${String(index)}`} />
      ))}
    </div>
  );
}

/** 空态视图 props。 */
export interface HomeEmptyStateProps {
  kind: HomeEmptyKind;
  onCreate?: () => void;
  onClearFilters?: () => void;
  onExitTrash?: () => void;
}

/** 空态三态（无文件 / 搜索无果 / 回收站空）。 */
export function HomeEmptyState({
  kind,
  onCreate,
  onClearFilters,
  onExitTrash,
}: HomeEmptyStateProps) {
  if (kind === 'search') {
    return (
      <EmptyState
        title={t('home.empty.search.title')}
        description={t('home.empty.search.desc')}
        action={
          <Button variant="primary" onClick={onClearFilters}>
            {t('home.empty.search.action')}
          </Button>
        }
      />
    );
  }
  if (kind === 'trash') {
    return (
      <EmptyState
        title={t('home.empty.trash.title')}
        description={t('home.empty.trash.desc')}
        action={
          <Button variant="primary" onClick={onExitTrash}>
            {t('home.empty.trash.action')}
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      title={t('home.empty.title')}
      description={t('home.empty.desc')}
      action={
        <Button variant="primary" onClick={onCreate}>
          {t('home.empty.action')}
        </Button>
      }
    />
  );
}

/** 错误态视图 props。 */
export interface HomeErrorStateProps {
  code?: string;
  description?: string;
  retrying?: boolean;
  retryLabel?: string;
  onRetry?: () => void;
}

/** 错误态（重试 + 错误码；错误码收进「诊断信息」折叠 · G6）。 */
export function HomeErrorState({
  code,
  description,
  retrying = false,
  retryLabel,
  onRetry,
}: HomeErrorStateProps) {
  return (
    <ErrorState
      title={t('home.error.title')}
      description={description ?? t('home.error.desc')}
      {...(code === undefined ? {} : { code })}
      diagnosticsLabel={t('state.diagnostics')}
      retryLabel={retryLabel ?? t('home.error.retry')}
      {...(onRetry === undefined ? {} : { onRetry })}
      retrying={retrying}
    />
  );
}

/** 列表告警条（目录损坏等不阻塞列表的问题；无告警时不渲染）。 */
export function HomeWarnings({ warnings }: { warnings: DocumentListWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="dfg-home__notice" role="note">
      <span className="dfg-home__notice-title">
        {t('home.warning.title', { count: warnings.length })}
      </span>
      <span className="dfg-home__notice-desc">{t('home.warning.desc')}</span>
    </div>
  );
}
