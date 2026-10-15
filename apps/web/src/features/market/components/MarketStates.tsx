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
import { badgeRowStyle, badgeStyle, codeStyle } from '../styles';

/** 空态种类。 */
export type MarketEmptyKind = 'no-result' | 'index-missing' | 'index-invalid' | 'installed-empty';

/** 空态 props。 */
export interface MarketEmptyStateProps {
  kind: MarketEmptyKind;
  /** 无结果：清空筛选。 */
  onClearFilters?: () => void;
  /** 已装载空态：回市场列表。 */
  onGoMarket?: () => void;
}

/** 空态（六态之一的 empty 挂点：`data-df-state="empty"`）。 */
export function MarketEmptyState({ kind, onClearFilters, onGoMarket }: MarketEmptyStateProps) {
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
  return (
    <div data-df-state="empty" data-df-empty="no-result">
      <EmptyState
        title={t('market.empty.noResult.title')}
        description={t('market.empty.noResult.desc')}
        action={
          onClearFilters === undefined ? undefined : (
            <Button variant="secondary" onClick={onClearFilters}>
              {t('market.empty.noResult.action')}
            </Button>
          )
        }
      />
    </div>
  );
}

/** 错误态（`data-df-state="error"`；六态之一的 error 挂点）。 */
export function MarketErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div data-df-state="error" data-df-error="daemon">
      <ErrorState
        title={t('market.error.title')}
        description={message}
        code="DAEMON_UNREACHABLE"
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
