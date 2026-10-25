'use client';

/**
 * 数据看板路由（D6；`/dashboard`，浅色首页族）。
 *
 * 取数：daemon `/market/query`（`limit` 取到 200——看板要尽量全的样本；索引缺失 → 空态说明
 * 「先跑采集线」，不伪造进度）。空态/加载/错误三态与市场页同一套组件。
 */

import { Button, EmptyState } from '@dforge/ui';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { DashboardView } from '@/features/dashboard';
import {
  classifyMarketOutcome,
  MarketErrorState,
  MarketWarningBanner,
  useMarketQuery,
} from '@/features/market';
import { t } from '@/i18n';
import { withDaemonEndpoint } from '@/lib/daemon-endpoint';

// 版式类复用 market.css（工单 06 · 样式单轨：两域共用同一套页面排版基线，见 market.css 头注释）
import '@/features/market/market.css';

/** 看板样本上限（索引规模在首批 40 仓量级，200 足够覆盖；截断时看板如实标注）。 */
const DASHBOARD_LIMIT = 200;

/** 数据看板页。 */
export default function DashboardPage() {
  const router = useRouter();
  const params = useMemo(() => ({ limit: DASHBOARD_LIMIT, sort: 'score' as const }), []);
  const { status, response, error, reload } = useMarketQuery(params);
  const outcome = response === null ? null : classifyMarketOutcome(response);

  return (
    <>
      <header className="dfg-market__header">
        <h1 className="dfg-market__title" data-df-page="dashboard">
          {t('dashboard.title')}
        </h1>
        <p className="dfg-market__subtitle">{t('dashboard.subtitle')}</p>
        <p className="dfg-market__hint" data-df-market="dashboard-hint">
          {t('dashboard.hint')}
        </p>
        <div className="dfg-market__badge-row">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              // 看板 → 市场：续写当前端点参数（D-3/UX-01），跳转后取数不丢 daemon
              router.push(withDaemonEndpoint('/market'));
            }}
          >
            {t('dashboard.back')}
          </Button>
          <Button variant="ghost" size="sm" onClick={reload}>
            {t('market.error.retry')}
          </Button>
        </div>
      </header>

      {status === 'loading' ? (
        <p className="dfg-market__hint" data-df-state="loading" data-df-loading="dashboard">
          {t('market.loading')}
        </p>
      ) : null}
      {status === 'error' ? <MarketErrorState message={error ?? ''} onRetry={reload} /> : null}

      {status === 'ready' && outcome === 'index-missing' ? (
        <div data-df-state="empty" data-df-empty="index-missing">
          <EmptyState
            title={t('dashboard.empty')}
            description={t('market.empty.indexMissing.desc')}
          />
        </div>
      ) : null}
      {status === 'ready' && outcome === 'index-invalid' ? (
        <div data-df-state="empty" data-df-empty="index-invalid">
          <EmptyState
            title={t('dashboard.empty')}
            description={t('market.empty.indexInvalid.desc')}
          />
        </div>
      ) : null}
      {status === 'ready' && outcome === 'partial' && response !== null ? (
        <MarketWarningBanner
          message={t('market.warning.partial', {
            message: response.warnings.map((warning) => warning.message).join('；'),
          })}
        />
      ) : null}
      {status === 'ready' && outcome === 'no-result' ? (
        <div data-df-state="empty" data-df-empty="no-result">
          <EmptyState title={t('dashboard.empty')} description={t('market.empty.noResult.desc')} />
        </div>
      ) : null}
      {status === 'ready' && response !== null && (outcome === 'ok' || outcome === 'partial') ? (
        <DashboardView response={response} nowIso={new Date().toISOString()} />
      ) : null}
    </>
  );
}
