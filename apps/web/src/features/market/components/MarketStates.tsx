'use client';

/**
 * 市场状态族（验收标准 §5：empty / error / loading 三态 + 部分失败提示）。
 *
 * 空态分四类，**口径不混**（《技能市场规格 v1》§6.2）：
 * - `index-missing` / `index-invalid`：索引不存在或不可解析 → 给「去跑采集」指引（CLI 命令）；
 * - `no-result`：有索引但筛选无命中 → 给「清空筛选」；
 * - `installed-empty`：本地装载记录为空 → 引导回市场列表。
 * 一律用 `@dforge/ui` 的 `EmptyState`/`ErrorState`（F12/F14），文案由本页 i18n 给。
 */

import { Button, EmptyState, ErrorState, InfoIcon } from '@dforge/ui';

import { t } from '@/i18n';

import { MARKET_COLLECT_COMMAND } from '../api';
import {
  badgeRowStyle,
  badgeStyle,
  codeStyle,
  emptyActionsStyle,
  emptyPaginationStyle,
  paginationErrorStyle,
} from '../styles';

/** 空态种类。 */
export type MarketEmptyKind =
  | 'no-result'
  | 'index-missing'
  | 'index-invalid'
  | 'installed-empty'
  | 'featured-empty';

/** 空态 props。 */
export interface MarketEmptyStateProps {
  kind: MarketEmptyKind;
  /** 无结果：清空筛选。 */
  onClearFilters?: () => void;
  /** 已装载空态 / 已装载终点：回市场列表。 */
  onGoMarket?: () => void;
  /** 精选终点：取消精选（回到全部资源）。 */
  onCancelFeatured?: () => void;
  /** 精选终点：服务端 total（说明「已检查全部 N 条」）。 */
  total?: number;
  /** 无结果附加说明（检索索引降级时「暂按字面匹配」；不改变空态种类与出口）。 */
  note?: string;
}

/** 空态（六态之一的 empty 挂点：`data-df-state="empty"`）。 */
export function MarketEmptyState({
  kind,
  onClearFilters,
  onGoMarket,
  onCancelFeatured,
  total = 0,
  note,
}: MarketEmptyStateProps) {
  if (kind === 'index-missing' || kind === 'index-invalid') {
    return (
      <div data-df-state="empty" data-df-empty={kind}>
        <EmptyState
          title={t(
            kind === 'index-missing'
              ? 'market.empty.indexMissing.title'
              : 'market.empty.indexInvalid.title',
          )}
          description={
            kind === 'index-missing'
              ? t('market.empty.indexMissing.desc')
              : t('market.empty.indexInvalid.desc')
          }
          action={
            <code style={codeStyle} data-df-market="collect-hint">
              {`$ ${MARKET_COLLECT_COMMAND}`}
            </code>
          }
        />
      </div>
    );
  }
  if (kind === 'installed-empty') {
    return (
      <div data-df-state="empty" data-df-empty={kind}>
        <EmptyState
          title={t('market.empty.installed.title')}
          description={t('market.empty.installed.desc')}
          action={
            onGoMarket === undefined ? undefined : (
              <Button variant="primary" onClick={onGoMarket}>
                {t('market.empty.installed.action')}
              </Button>
            )
          }
        />
      </div>
    );
  }
  if (kind === 'featured-empty') {
    return (
      <div data-df-state="empty" data-df-empty={kind}>
        <EmptyState
          title={t('market.empty.featuredEmpty.title')}
          description={t('market.empty.featuredEmpty.desc', { total })}
          action={
            onCancelFeatured === undefined ? undefined : (
              <Button variant="secondary" onClick={onCancelFeatured}>
                {t('market.featured.cancel')}
              </Button>
            )
          }
        />
      </div>
    );
  }
  // 检索索引降级时明确说明当前是字面匹配（UX-08/E1），不误导用户；不改变空态种类与出口
  const noResultDescription =
    note === undefined ? (
      t('market.empty.noResult.desc')
    ) : (
      <>
        {t('market.empty.noResult.desc')} <span data-df-market="empty-note">{note}</span>
      </>
    );
  const noResultActions = (
    <div style={emptyActionsStyle}>
      {onClearFilters === undefined ? null : (
        <Button variant="secondary" onClick={onClearFilters}>
          {t('market.empty.noResult.action')}
        </Button>
      )}
      {onGoMarket === undefined ? null : (
        <Button
          variant={onClearFilters === undefined ? 'primary' : 'secondary'}
          onClick={onGoMarket}
        >
          {t('market.empty.installed.action')}
        </Button>
      )}
    </div>
  );
  return (
    <div data-df-state="empty" data-df-empty="no-result">
      <EmptyState
        title={t('market.empty.noResult.title')}
        description={noResultDescription}
        action={
          onClearFilters === undefined && onGoMarket === undefined ? undefined : noResultActions
        }
      />
    </div>
  );
}

/** 页内空态模式（DEF-01）：筛选 / 精选 / 已装载。 */
export type MarketPageEmptyMode = 'filters' | 'featured' | 'installed';

/** 页内空态 props（当前页无命中但仍有未加载页：保留继续加载入口）。 */
export interface MarketPageEmptyStateProps {
  mode: MarketPageEmptyMode;
  /** 已加载条数（含客户端过滤前）。 */
  loaded: number;
  /** 服务端 total（当前查询口径）。 */
  total: number;
  /** 尚未检查的条数（total - loaded，不小于 0）。 */
  remaining: number;
  loadMoreState: 'idle' | 'loading' | 'error' | 'done';
  loadMoreError: string | null;
  onLoadMore: () => void;
  onClearFilters: () => void;
  onCancelFeatured: () => void;
  onGoMarket: () => void;
}

const PAGE_EMPTY_TITLE_KEYS: Record<MarketPageEmptyMode, string> = {
  filters: 'market.empty.noResultPage.filtersTitle',
  featured: 'market.empty.noResultPage.featuredTitle',
  installed: 'market.empty.noResultPage.installedTitle',
};

const PAGE_EMPTY_DESC_KEYS: Record<MarketPageEmptyMode, string> = {
  filters: 'market.empty.noResultPage.filtersDesc',
  featured: 'market.empty.noResultPage.featuredDesc',
  installed: 'market.empty.noResultPage.installedDesc',
};

/**
 * 页内空态（DEF-01）：当前已加载页被客户端过滤（许可/来源/已装载/精选）后无命中，
 * 但服务端仍有未加载页——**不是终点**：给「加载更多」继续查找，并按模式给次按钮。
 *
 * 与 `MarketEmptyState` 的分工：终点无结果才用「没有匹配的资源」；本组件避免误导，
 * 并要求页面在此时**不渲染底部分页行**（这里已含进度与加载入口）。
 */
export function MarketPageEmptyState({
  mode,
  loaded,
  total,
  remaining,
  loadMoreState,
  loadMoreError,
  onLoadMore,
  onClearFilters,
  onCancelFeatured,
  onGoMarket,
}: MarketPageEmptyStateProps) {
  const secondary =
    mode === 'filters'
      ? { label: t('market.empty.noResult.action'), onClick: onClearFilters }
      : mode === 'featured'
        ? { label: t('market.featured.cancel'), onClick: onCancelFeatured }
        : { label: t('market.empty.installed.action'), onClick: onGoMarket };
  return (
    <div data-df-state="empty" data-df-empty="no-result-page" data-df-empty-mode={mode}>
      <EmptyState
        title={t(PAGE_EMPTY_TITLE_KEYS[mode], { loaded })}
        description={t(PAGE_EMPTY_DESC_KEYS[mode], { remaining })}
        action={
          <div style={emptyActionsStyle}>
            <Button
              variant="primary"
              loading={loadMoreState === 'loading'}
              loadingLabel={t('market.list.loadingMore')}
              onClick={onLoadMore}
            >
              {t('market.list.loadMore')}
            </Button>
            <Button variant="secondary" onClick={secondary.onClick}>
              {secondary.label}
            </Button>
            <div
              data-df-market="pagination"
              role={loadMoreState === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              style={emptyPaginationStyle}
            >
              {loadMoreState === 'error' ? (
                <>
                  <span style={paginationErrorStyle}>
                    {t('market.list.loadMoreFailed', { message: loadMoreError ?? '' })}
                  </span>
                  <Button size="sm" variant="secondary" onClick={onLoadMore}>
                    {t('market.error.retry')}
                  </Button>
                </>
              ) : (
                <span>{t('market.list.progress', { shown: loaded, total })}</span>
              )}
            </div>
          </div>
        }
      />
    </div>
  );
}

/** 错误态（`data-df-state="error"`；六态之一的 error 挂点）。
 *
 * `code` 由调用方给（daemon 错误码 / 前端归一码，如 `daemon_bad_response`）；
 * 展示时统一大写（`daemon_unreachable` → `DAEMON_UNREACHABLE`，与旧挂点口径一致）。
 */
export function MarketErrorState({
  message,
  code = 'daemon_unreachable',
  title = t('market.error.title'),
  onRetry,
}: {
  message: string;
  code?: string;
  title?: string;
  onRetry: () => void;
}) {
  return (
    <div data-df-state="error" data-df-error="daemon">
      <ErrorState
        title={title}
        description={message}
        code={code.toUpperCase()}
        diagnosticsLabel={t('state.diagnostics')}
        onRetry={onRetry}
        retryLabel={t('market.error.retry')}
      />
    </div>
  );
}

/** 部分失败提示条（借 WorkBuddy「部分社区结果加载失败」语义，研究 #3 §3.4）。 */
export function MarketWarningBanner({ message }: { message: string }) {
  return (
    <div style={badgeRowStyle} role="status" data-df-market="warning">
      <span style={badgeStyle('warn')}>
        <InfoIcon size={12} /> {message}
      </span>
    </div>
  );
}
