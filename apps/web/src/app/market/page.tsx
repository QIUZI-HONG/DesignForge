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
  CardGrid,
  classifyMarketOutcome,
  clientFilterOf,
  collectScenes,
  FilterBar,
  hasMorePages,
  INITIAL_MARKET_FILTERS,
  isSearchDegraded,
  isUpdateAvailable,
  LoadConfirmDialog,
  MarketEmptyState,
  MarketErrorState,
  type MarketFilters,
  MarketSkeletonGrid,
  MarketWarningBanner,
  resolveMarketEmptyKind,
  selectFeatured,
  toQueryParams,
  useLoadPlan,
  useLoadRecords,
  useMarketPagination,
} from '@/features/market';
import { t } from '@/i18n';
import { withDaemonEndpoint } from '@/lib/daemon-endpoint';

import '@/features/market/market.css';

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
   * 就绪时索引缺失/损坏或结果集为空 → `resolveMarketEmptyKind` 归一四类空态
   * （判定顺序：已装载无记录 > 查询词 > 索引缺失/损坏 > 普通无结果）；
   * 其余 → 卡片网格——`MarketOutcome` 的每支都落在某条分支上。
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
    if (
      outcome !== null &&
      (outcome === 'index-missing' || outcome === 'index-invalid' || visible.length === 0)
    ) {
      // 空态判定顺序收口在 resolveMarketEmptyKind（巡检缺口①②）：已装载视图无本地记录 →
      // installed-empty 优先；有查询词 → no-result 优先于索引缺失；其余维持旧口径。
      const kind = resolveMarketEmptyKind({
        outcome,
        hasQuery: filters.query.trim().length > 0,
        installedView,
        loadedCount: loadedIds.length,
      });
      if (kind === 'index-missing' || kind === 'index-invalid') {
        return <MarketEmptyState kind={kind} />;
      }
      if (kind === 'installed-empty') {
        return (
          <MarketEmptyState
            kind="installed-empty"
            onGoMarket={() => {
              setInstalledView(false);
            }}
          />
        );
      }
      return (
        <MarketEmptyState
          kind="no-result"
          {...(searchDegraded ? { note: t('market.empty.noResult.literalNote') } : {})}
          onClearFilters={clearFilters}
        />
      );
    }
    return (
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
  };

  /** 分页行（DEF-R1）：已加载计数 +「加载更多」；终点给「已全部加载」。 */
  const renderPagination = (): ReactElement | null => {
    if (status !== 'ready' || response === null || featuredOnly || visible.length === 0) {
      return null;
    }
    const shown = allItems.length;
    const total = response.total;
    if (total <= 0) return null;
    return (
      <div data-df-market="pagination" className="dfg-market__pagination">
        <span className="dfg-market__hint">{t('market.list.progress', { shown, total })}</span>
        {hasMorePages(shown, total) ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={loadMoreState === 'loading'}
            onClick={loadMore}
          >
            {loadMoreState === 'loading' ? t('market.list.loadingMore') : t('market.list.loadMore')}
          </Button>
        ) : (
          <span className="dfg-market__hint">{t('market.list.allShown', { total })}</span>
        )}
        {loadMoreState === 'error' ? (
          <span className="dfg-market__pagination-error">
            {t('market.list.loadMoreFailed', { message: loadMoreError ?? '' })}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <header className="dfg-market__header">
        <h1 className="dfg-market__title" data-df-page="market-home">
          {t('market.title')}
        </h1>
        <p className="dfg-market__subtitle">{t('market.subtitle')}</p>
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

      <div className="dfg-market__toolbar" data-df-market="discover">
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
        <span className="dfg-market__hint">{t('market.featuredHint', { count: 6 })}</span>
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

      <footer className="dfg-market__badge-row" data-df-market="page-foot">
        <span className="dfg-market__hint" data-df-market="client-filter-note">
          {t('market.clientFilterNote', { count: activeFilterCount(filters) })}
        </span>
      </footer>
    </>
  );
}
