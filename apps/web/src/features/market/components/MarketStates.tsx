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
import { classifyDaemonFailure } from '@/lib/daemon-failure';

import { MARKET_COLLECT_COMMAND } from '../api';
import { badgeClassName } from '../badge-classes';

import '../market.css';

/** 空态种类。 */
export type MarketEmptyKind = 'no-result' | 'index-missing' | 'index-invalid' | 'installed-empty';

/** 采集指引命令（空态内直接给「去跑采集」的 CLI 口径，不假装能自动补数据）。
 *  市场首页与数据看板的空态**同源复用**本组件（巡检缺口④：看板空态说「先跑采集线」
 *  却不给命令）——挂点 `data-df-market="collect-hint"` 与命令文本都只有这一处真源。 */
export function MarketCollectHint() {
  return (
    <code className="dfg-market__code" data-df-market="collect-hint">
      {`$ ${MARKET_COLLECT_COMMAND}`}
    </code>
  );
}

/** 空态 props。 */
export interface MarketEmptyStateProps {
  kind: MarketEmptyKind;
  /** 无结果：清空筛选。 */
  onClearFilters?: () => void;
  /** 已装载空态：回市场列表。 */
  onGoMarket?: () => void;
  /** 无结果附加说明（检索索引降级时「暂按字面匹配」；不改变空态种类与出口）。 */
  note?: string;
}

/** 空态（六态之一的 empty 挂点：`data-df-state="empty"`）。 */
export function MarketEmptyState({
  kind,
  onClearFilters,
  onGoMarket,
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
          action={<MarketCollectHint />}
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
  // 检索索引降级时明确说明当前是字面匹配（UX-08/E1），不误导用户；不改变空态种类与出口
  const noResultDescription =
    note === undefined ? (
      t('market.empty.noResult.desc')
    ) : (
      <>
        {t('market.empty.noResult.desc')} <span data-df-market="empty-note">{note}</span>
      </>
    );
  return (
    <div data-df-state="empty" data-df-empty="no-result">
      <EmptyState
        title={t('market.empty.noResult.title')}
        description={noResultDescription}
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

/** 错误态（`data-df-state="error"`；六态之一的 error 挂点）。
 *
 * 人话化口径（票 06 / spec P1-2）：`message` 是客户端层透传的**原始**错误，先经共享
 * 归类（`classifyDaemonFailure`）——网络层失败（fetch/TypeError 族）时描述位给中文人话
 * + 下一步（标题本就是「无法连接本地服务」，主句补「请确认 daemon 已启动」+ 重试指引），
 * 原始 message 与归一错误码沉进**可折叠技术详情**（报障可引用，不再直出裸英文）；
 * 其余失败（daemon 明确拒绝等）维持 message 原样描述 + 码收折叠。
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
  const view = classifyDaemonFailure({ message, code });
  const isNetwork = view.isNetwork;
  return (
    <div data-df-state="error" data-df-error="daemon">
      <ErrorState
        title={title}
        description={isNetwork ? t('market.error.network.human') : message}
        {...(view.code === null ? {} : { code: view.code.toUpperCase() })}
        diagnosticsLabel={t('error.technicalDetails')}
        {...(isNetwork && view.raw.length > 0 ? { diagnosticsDetail: view.raw } : {})}
        onRetry={onRetry}
        retryLabel={t('market.error.retry')}
      />
    </div>
  );
}

/** 部分失败提示条（借 WorkBuddy「部分社区结果加载失败」语义，研究 #3 §3.4）。 */
export function MarketWarningBanner({ message }: { message: string }) {
  return (
    <div className="dfg-market__badge-row" role="status" data-df-market="warning">
      <span className={badgeClassName('warn')}>
        <InfoIcon size={12} /> {message}
      </span>
    </div>
  );
}
