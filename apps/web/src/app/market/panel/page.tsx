'use client';

/**
 * 编辑器内市场面板路由（D5；独立深色路由 `/market/panel`）。
 *
 * 为什么先独立路由：编辑器壳层（FE-03）尚未并入集成分支，右栏挂点还不存在；
 * 本页把面板完整呈现（深色族）并把主题切到 `data-theme="dark"`（令牌变量自带深色基准），
 * 离开时恢复——壳层落地后由壳层持有主题、本组件直接挂进右栏，`data-df-page="market-panel"` 取样名不变。
 *
 * 自 P1-5 六态提取起，面板数据流与六态渲染由 `MarketPanelBody` 单点供给（与编辑器
 * 左栏页签 `MarketPanelSlot` 同源）；本页只剩**页面 chrome**：深色主题开关、页题、
 * 反馈键说明（这些刻意不进编辑器页签体，见 register 模块头「两处刻意不同」）。
 */

import { useEffect } from 'react';
import { FEEDBACK_KEY, MarketPanelBody } from '@/features/market';
import { t } from '@/i18n';

import '@/features/market/market.css';

/** 编辑器内市场面板页。 */
export default function MarketPanelPage() {
  // 深色族：本路由进入时切主题，离开恢复（编辑器壳层接入后由壳层持有）
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = 'dark';
    return () => {
      root.dataset.theme = previous ?? 'light';
    };
  }, []);

  return (
    <div className="dfg-market__dark-page">
      <header className="dfg-market__head-center">
        <h1 className="dfg-market__title">{t('market.panel.pageTitle')}</h1>
        <p className="dfg-market__hint">{t('market.panel.pageHint')}</p>
      </header>

      <MarketPanelBody />

      <div className="dfg-market__toolbar">
        <span className="dfg-market__hint" data-df-market="panel-feedback-key">
          {t('market.panel.feedbackKey', { key: FEEDBACK_KEY })}
        </span>
      </div>
    </div>
  );
}
