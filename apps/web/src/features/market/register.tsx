'use client';

/**
 * 市场特性的**编辑器接线模块**（票 16 · register 接缝，ADR-0004 ②「唯一第二入口」）。
 *
 * 由编辑器唯一客户端引导件 `app/editor/editor-bootstrap.tsx` 的插槽声明表引用
 * （`slot: 'left-panel-tabs'`，图层 / 资产之后追加「市场」页签）；feature 之间不得互引
 * 本模块（边界守卫），app 路由层引 `@/features/market/register` 是登记例外。
 *
 * 职责：把既有市场面板（D5）承载进编辑器左栏——数据流与 `/market/panel` 页同口径
 * （综合评分前 8、试跑/采纳本地计数、六态分类），但两处刻意不同：
 * - **不动根元素主题**：编辑器深色基准由壳层持有（`EditorThemeScope`），页级主题开关
 *   若带进编辑器，卸载时会把根元素「恢复」成浅色（漂移 + 残留）；
 * - **无页面级壳**：页题/反馈键说明是 `/market/panel` 的页面chrome，页签体只承载
 *   面板内容与六态（loading / 索引缺失 / 索引损坏 / 无结果 / 错误 / 正常+部分失败）。
 */

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { t } from '@/i18n';
import { withDaemonEndpoint } from '@/lib/daemon-endpoint';

import { classifyMarketOutcome } from './api';
import { MarketEmptyState, MarketErrorState } from './components/MarketStates';
import { bumpFeedback, type FeedbackEntry, readFeedback } from './feedback';
import { MarketPanel } from './panel/MarketPanel';
import { useLoadRecords, useMarketQuery } from './use-market';

/** 左栏扩展页签 id（editor-bootstrap 声明与测试共用一处定义；id 约定 `<ticket>-<feature>`）。 */
export const MARKET_TAB_ID = 'p2-market';

/** 页签文案（i18n 单点；editor-bootstrap 声明与测试共用，禁裸值）。 */
export function marketTabLabel(): string {
  return t('panels.market.title');
}

/** 面板取数参数：默认综合评分前 8（与 `/market/panel` 同口径——面板是速览，不做完整检索）。 */
const PANEL_LIMIT = 8;

/** 编辑器内市场面板页签体（承载既有 MarketPanel 内容与六态）。 */
export function MarketPanelSlot() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const { loadedIds } = useLoadRecords();

  const params = useMemo(() => ({ sort: 'score' as const, limit: PANEL_LIMIT }), []);
  const { status, response, error, reload } = useMarketQuery(params);

  // 本地计数册与 /market/panel 同一册（FEEDBACK_KEY）；只在客户端读，SSR 阶段给空册。
  // 刻意没有根元素主题 effect：编辑器深色基准归壳层（见文件头「两处刻意不同」）。
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
    <div className="dfg-market__editor-host" data-df-market="editor-panel">
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
          onOpenDetail={(assetId) => {
            // 面板 → 详情：续写当前端点参数（D-3/UX-01，口径与市场首页卡片一致）
            router.push(withDaemonEndpoint(`/market/${encodeURIComponent(assetId)}`));
          }}
        />
      ) : null}
    </div>
  );
}
