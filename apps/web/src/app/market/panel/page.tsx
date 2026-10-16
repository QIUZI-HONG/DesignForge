'use client';

/**
 * 编辑器内市场面板路由（D5；独立深色路由 `/market/panel`）。
 *
 * 为什么先独立路由：编辑器壳层（FE-03）尚未并入集成分支，右栏挂点还不存在；
 * 本页把面板完整呈现（深色族）并把主题切到 `data-theme="dark"`（令牌变量自带深色基准），
 * 离开时恢复——壳层落地后由壳层持有主题、本组件直接挂进右栏，`data-df-page="market-panel"` 取样名不变。
 */

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  bumpFeedback,
  classifyMarketOutcome,
  darkPageStyle,
  FEEDBACK_KEY,
  type FeedbackEntry,
  hintStyle,
  MarketEmptyState,
  MarketErrorState,
  MarketPanel,
  readFeedback,
  titleStyle,
  toolbarStyle,
  useLoadRecords,
  useMarketQuery,
} from '@/features/market';
import { t } from '@/i18n';
import { withDaemonEndpoint } from '@/lib/daemon-endpoint';

/** 面板取数参数：默认综合评分前 8（面板是速览，不做完整检索）。 */
const PANEL_LIMIT = 8;

/** 编辑器内市场面板页。 */
export default function MarketPanelPage() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const { loadedIds } = useLoadRecords();

  const params = useMemo(() => ({ sort: 'score' as const, limit: PANEL_LIMIT }), []);
  const { status, response, error, reload } = useMarketQuery(params);

  // 深色族：本路由进入时切主题，离开恢复（编辑器壳层接入后由壳层持有）
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = 'dark';
    return () => {
      root.dataset.theme = previous ?? 'light';
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setFeedback(readFeedback(window.localStorage));
    } catch {
      setFeedback([]);
    }
  }, []);

  const bump = (assetId: string, field: 'runs' | 'adoptions'): void => {
    if (typeof window === 'undefined') return;
    try {
      setFeedback(bumpFeedback(window.localStorage, assetId, field, new Date().toISOString()));
    } catch {
      setFeedback([]);
    }
  };

  const assets = response?.items ?? [];
  const outcome = response === null ? null : classifyMarketOutcome(response);

  return (
    <div style={darkPageStyle}>
      <header style={{ display: 'grid', gap: 'var(--dfg-space-1)', textAlign: 'center' }}>
        <h1 style={titleStyle}>{t('market.panel.pageTitle')}</h1>
        <p style={hintStyle}>{t('market.panel.pageHint')}</p>
      </header>

      {status === 'loading' ? (
        <p style={hintStyle} data-df-state="loading" data-df-loading="panel">
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
          onOpenDetail={(assetId) => {
            // 面板 → 详情：续写当前端点参数（D-3/UX-01，口径与市场首页卡片一致）
            router.push(withDaemonEndpoint(`/market/${encodeURIComponent(assetId)}`));
          }}
        />
      ) : null}

      <div style={toolbarStyle}>
        <span style={hintStyle} data-df-market="panel-feedback-key">
          {t('market.panel.feedbackKey', { key: FEEDBACK_KEY })}
        </span>
      </div>
    </div>
  );
}
