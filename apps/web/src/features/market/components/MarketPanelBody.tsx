'use client';

/**
 * 市场面板六态渲染体（P1-5 六态提取）——`register.tsx` 的 `MarketPanelSlot` 与
 * `app/market/panel/page.tsx` 逐行同形的渲染块（loading / 索引缺失 / 索引损坏 /
 * 无结果 / 错误 / 正常+部分失败 + 全部回调接线）收口为一处，行为零变化。
 *
 * 页面 chrome 归宿主：`/market/panel` 页题、反馈键说明与根元素主题开关留在页面；
 * 编辑器页签体只包一层 `dfg-market__editor-host`（不动根元素主题，见 register 模块头）。
 */

import { t } from '@/i18n';
import { MarketPanel } from '../panel/MarketPanel';
import { useMarketPanelData } from '../use-market-panel';
import { MarketEmptyState, MarketErrorState } from './MarketStates';

/** 市场面板六态渲染体（数据流经 {@link useMarketPanelData} 单点供给）。 */
export function MarketPanelBody() {
  const {
    status,
    error,
    reload,
    assets,
    outcome,
    loadedIds,
    feedback,
    selectedId,
    setSelectedId,
    bump,
    openDetail,
  } = useMarketPanelData();

  return (
    <>
      {status === 'loading' ? (
        <p className="dfg-market__hint" data-df-state="loading" data-df-loading="panel">
          {t('market.loading')}
        </p>
      ) : null}
      {status === 'error' ? <MarketErrorState message={error ?? ''} onRetry={reload} /> : null}
      {status === 'ready' && outcome === 'index-missing' ? (
        <MarketEmptyState kind="index-missing" />
      ) : null}
      {status === 'ready' && outcome === 'index-invalid' ? (
        <MarketEmptyState kind="index-invalid" />
      ) : null}
      {status === 'ready' && outcome === 'no-result' ? <MarketEmptyState kind="no-result" /> : null}
      {status === 'ready' && (outcome === 'ok' || outcome === 'partial') ? (
        <MarketPanel
          assets={assets}
          loadedIds={loadedIds}
          feedback={feedback}
          selectedId={selectedId ?? assets[0]?.id ?? null}
          onRun={(assetId) => {
            bump(assetId, 'runs');
          }}
          onAdopt={(assetId) => {
            bump(assetId, 'adoptions');
          }}
          onSelect={(assetId) => {
            setSelectedId(assetId);
          }}
          onOpenDetail={openDetail}
        />
      ) : null}
    </>
  );
}
