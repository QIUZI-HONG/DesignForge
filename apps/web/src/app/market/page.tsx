'use client';

/**
 * 市场首页（D1 + D3；`/market`）。
 *
 * 结构：标题/说明 → 筛选栏（搜索 + 一级标签 + 二级 + 下拉 + 场景 chips）→ 结果区
 * （加载骨架 / 卡片网格 / 四类空态 / 错误态 / 部分失败提示）→ 装载确认（D4 对话框）。
 *
 * 数据口径：**唯一取数入口是 daemon `/market`**；索引缺失/损坏 → 空态给采集指引，
 * 无结果 → 空态给清空筛选，均不伪造数据。客户端还承担三项过滤（许可档 / 来源仓库 /
 * 已装载——真值在本地记录册）与「精选」Top-N，全部在当前结果集上做并如实声明。
 */

import type { MarketAsset } from '@dforge/contracts';
import { Button } from '@dforge/ui';
import { useRouter } from 'next/navigation';
import { type ReactElement, useMemo, useState } from 'react';
import {
  activeFilterCount,
  applyClientFilters,
  badgeRowStyle,
  CardGrid,
  classifyMarketOutcome,
  clientFilterOf,
  collectScenes,
  FilterBar,
  headerStyle,
  hintStyle,
  INITIAL_MARKET_FILTERS,
  isSearchDegraded,
  isUpdateAvailable,
  LoadConfirmDialog,
  MarketEmptyState,
  MarketErrorState,
  type MarketFilters,
  MarketPageEmptyState,
  MarketSkeletonGrid,
  MarketWarningBanner,
  paginationErrorStyle,
  paginationStyle,
  selectFeatured,
  subtitleStyle,
  titleStyle,
  toolbarStyle,
  toQueryParams,
  useLoadPlan,
  useLoadRecords,
  useMarketPagination,
} from '@/features/market';
import { t } from '@/i18n';
import { withDaemonEndpoint } from '@/lib/daemon-endpoint';

/** 市场首页。 */
export default function MarketHomePage() {
  const router = useRouter();
  const [filters, setFilters] = useState<MarketFilters>(INITIAL_MARKET_FILTERS);
  const [installedView, setInstalledView] = useState(false);
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [pendingAsset, setPendingAsset] = useState<MarketAsset | null>(null);

  const params = useMemo(() => toQueryParams(filters), [filters]);
  const {
    status,
    response,
    error,
    errorCode,
    reload,
    items: allItems,
    loadMore,
    loadMoreState,
    loadMoreError,
    hasMore: paginationHasMore,
  } = useMarketPagination(params);
  const { records, loadedIds, save, remove } = useLoadRecords();
  const loadPlan = useLoadPlan(pendingAsset?.id ?? null);

  // 二级视图「已装载」= 叠加 loadedOnly（真值在本地记录册；与客户端过滤同一口径）
  const effectiveFilters: MarketFilters = installedView
    ? { ...filters, loadedOnly: true }
    : filters;
  const outcome = response === null ? null : classifyMarketOutcome(response);
  const searchDegraded = response !== null && isSearchDegraded(response.warnings);
  const clientFiltered =
    response === null
      ? []
      : applyClientFilters(allItems, clientFilterOf(effectiveFilters, loadedIds));
  const visible = featuredOnly ? selectFeatured(clientFiltered) : clientFiltered;
  const scenes = collectScenes(allItems);

  // DEF-01 三态推导：页内空态（还有未加载页）≠ 终点空态（已检查全部）
  const loaded = allItems.length;
  const total = response?.total ?? 0;
  const hasMore = response !== null && loadMoreState !== 'done' && paginationHasMore;
  const installedEmpty = installedView && records.length === 0;
  const emptyMode = installedView ? 'installed' : featuredOnly ? 'featured' : 'filters';
  const pageScopedEmpty = visible.length === 0 && !installedEmpty && hasMore;
  const terminalEmpty = visible.length === 0 && !installedEmpty && !hasMore;
  const remaining = Math.max(total - loaded, 0);

  const updateFilters = (patch: Partial<MarketFilters>): void => {
    setFilters((previous) => ({ ...previous, ...patch }));
  };

  const clearFilters = (): void => {
    setFilters(INITIAL_MARKET_FILTERS);
  };

  const openDetail = (assetId: string): void => {
    // 卡片 → 详情：续写当前端点参数（D-3/UX-01）——详情页的取数才能命中同一 daemon
    router.push(withDaemonEndpoint(`/market/${encodeURIComponent(assetId)}`));
  };

  const uninstall = (assetId: string): void => {
    remove(assetId);
  };

  const warningMessage =
    outcome === 'partial'
      ? t('market.warning.partial', {
          message: response?.warnings.map((warning) => warning.message).join('；') ?? '',
        })
      : searchDegraded
        ? t('market.warning.searchDegraded')
        : null;

  /**
   * 结果区（三态补齐：加载 / 错误 / 就绪；**任何输入都有分支可匹配**，不得静默空白）。
   *
   * 就绪但 `response` 缺失（形状校验后理论不可达，防御式保留）→ 错误态；
   * 就绪时按 outcome 分发四类空态与卡片网格——`MarketOutcome` 的每支都落在某条分支上。
   */
  const renderResults = (): ReactElement => {
    if (status === 'loading') {
      return <MarketSkeletonGrid />;
    }
    if (status === 'error' || response === null) {
      return (
        <MarketErrorState
          message={error ?? t('market.error.shapeMismatch')}
          {...(errorCode === null ? {} : { code: errorCode })}
          onRetry={reload}
        />
      );
    }
    if (outcome === 'index-missing') {
      return <MarketEmptyState kind="index-missing" />;
    }
    if (outcome === 'index-invalid') {
      return <MarketEmptyState kind="index-invalid" />;
    }
    if (installedEmpty) {
      return (
        <MarketEmptyState
          kind="installed-empty"
          onGoMarket={() => {
            setInstalledView(false);
          }}
        />
      );
    }
    const grid = (
      <CardGrid
        assets={visible}
        loadedIds={loadedIds}
        query={filters.query}
        onOpen={openDetail}
        onInstall={(asset) => {
          setPendingAsset(asset);
        }}
        onUninstall={uninstall}
        isUpdateAvailable={(asset) => {
          const record = records.find((item) => item.assetId === asset.id) ?? null;
          return isUpdateAvailable(record, { digest: asset.digest });
        }}
      />
    );
    if (visible.length > 0) {
      return grid;
    }
    // 页内空态：当前页无命中但服务端仍有未加载页——保留「继续加载」，不误报「没有匹配」
    if (pageScopedEmpty) {
      return (
        <MarketPageEmptyState
          mode={emptyMode}
          loaded={loaded}
          total={total}
          remaining={remaining}
          loadMoreState={loadMoreState}
          loadMoreError={loadMoreError}
          onLoadMore={loadMore}
          onClearFilters={clearFilters}
          onCancelFeatured={() => {
            setFeaturedOnly(false);
          }}
          onGoMarket={() => {
            setInstalledView(false);
          }}
        />
      );
    }
    // 终点空态：已检查全部条目仍无命中（按模式给出口）
    if (terminalEmpty) {
      if (emptyMode === 'featured') {
        return (
          <MarketEmptyState
            kind="featured-empty"
            total={total}
            onCancelFeatured={() => {
              setFeaturedOnly(false);
            }}
          />
        );
      }
      if (emptyMode === 'installed') {
        return (
          <MarketEmptyState
            kind="no-result"
            note={t('market.empty.noResult.installedCheckedAll', { total })}
            onGoMarket={() => {
              setInstalledView(false);
            }}
          />
        );
      }
      const notes = [t('market.empty.noResult.checkedAll', { total })];
      if (searchDegraded) notes.push(t('market.empty.noResult.literalNote'));
      return (
        <MarketEmptyState kind="no-result" note={notes.join(' ')} onClearFilters={clearFilters} />
      );
    }
    // 防御式出口：visible=0 且非已装载空态时，页内空态/终点空态必居其一（理论上不可达）
    return grid;
  };

  /** 分页行（DEF-R1/DEF-02）：已加载计数 +「加载更多」；终点给「已全部加载」。
   *  页内空态时返回 null（空态组件已含进度与加载入口，避免双按钮）。 */
  const renderPagination = (): ReactElement | null => {
    if (
      status !== 'ready' ||
      response === null ||
      featuredOnly ||
      installedEmpty ||
      visible.length === 0
    ) {
      return null;
    }
    const shown = allItems.length;
    if (total <= 0) return null;
    return (
      <div data-df-market="pagination" style={paginationStyle}>
        {loadMoreState === 'error' ? (
          <>
            <span role="alert" style={paginationErrorStyle}>
              {t('market.list.loadMoreFailed', { message: loadMoreError ?? '' })}
            </span>
            <Button size="sm" variant="secondary" onClick={loadMore}>
              {t('market.error.retry')}
            </Button>
          </>
        ) : (
          <>
            <span role="status" aria-live="polite" style={hintStyle}>
              {t('market.list.progress', { shown, total })}
            </span>
            {paginationHasMore ? (
              <Button
                size="sm"
                variant="secondary"
                loading={loadMoreState === 'loading'}
                loadingLabel={t('market.list.loadingMore')}
                onClick={loadMore}
              >
                {t('market.list.loadMore')}
              </Button>
            ) : (
              <span style={hintStyle}>{t('market.list.allShown', { total })}</span>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <>
      <header style={headerStyle}>
        <h1 style={titleStyle} data-df-page="market-home">
          {t('market.title')}
        </h1>
        <p style={subtitleStyle}>{t('market.subtitle')}</p>
      </header>

      <FilterBar
        filters={effectiveFilters}
        scenes={scenes}
        installedView={installedView}
        total={response?.total ?? null}
        globalTotal={response?.counts?.total ?? null}
        loadableCount={response?.counts?.loadable ?? null}
        generatedAt={response?.generatedAt ?? null}
        // 服务不可达时计数显示「—」而不是「0 个资源」/「正在加载」（UX-19）
        countUnavailable={status === 'error'}
        onChange={updateFilters}
        onInstalledViewChange={setInstalledView}
        onClear={clearFilters}
      />

      <div style={toolbarStyle} data-df-market="discover">
        <Button
          size="sm"
          variant={featuredOnly ? 'primary' : 'secondary'}
          aria-pressed={featuredOnly}
          onClick={() => {
            setFeaturedOnly((value) => !value);
          }}
        >
          {t('market.featured')}
        </Button>
        <span style={hintStyle}>{t('market.featuredHint', { count: 6 })}</span>
      </div>

      {warningMessage === null ? null : <MarketWarningBanner message={warningMessage} />}

      {renderResults()}

      {renderPagination()}

      {pendingAsset !== null && loadPlan.plan !== null ? (
        <LoadConfirmDialog
          open
          asset={pendingAsset}
          plan={loadPlan.plan}
          ownedBefore={loadedIds.includes(pendingAsset.id)}
          onOpenChange={(open) => {
            if (!open) setPendingAsset(null);
          }}
          onLoaded={(record) => {
            save(record);
            setPendingAsset(null);
          }}
        />
      ) : null}

      {pendingAsset !== null && loadPlan.status === 'error' ? (
        <MarketWarningBanner
          message={t('market.loadPlanError', { message: loadPlan.error ?? '' })}
        />
      ) : null}

      <footer style={badgeRowStyle} data-df-market="page-foot">
        <span style={hintStyle} data-df-market="client-filter-note">
          {t('market.clientFilterNote', { count: activeFilterCount(filters) })}
        </span>
      </footer>
    </>
  );
}
