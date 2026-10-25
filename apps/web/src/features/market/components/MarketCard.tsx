'use client';

/**
 * MarketCard —— 市场卡片（D1；规格 §6.1 卡片口径）。
 *
 * 信息行：中文主名（+ 第二语言副行，双语卡片）→ 一句话简介（搜索命中高亮）→
 * kind/来源（repo@短哈希）/许可档/下架徽标 → 指标行 + 总分徽标 → 运行前提标签 →
 * 主状态按钮（装载 / 已装载 / 仅看 / 禁，三态由 `describeInstallButton` 给）与更多操作。
 *
 * 交互：**悬停抬升**由组件状态驱动（jsdom 可断言，不依赖 CSS 伪类）；
 * `data-df-state` 暴露当前态供截图门禁取样（hover 无法用伪类截图，见 components.css 注）。
 */

import type { MarketAsset } from '@dforge/contracts';
import { Button, DropdownMenu, MoreHorizontalIcon } from '@dforge/ui';
import { useState } from 'react';

import { t } from '@/i18n';

import { buildSourceUrl } from '../api';
import { badgeClassName } from '../badge-classes';
import { describeInstallButton } from '../capabilities';
import {
  assetPrimaryName,
  assetSecondaryName,
  KindBadge,
  kindIcon,
  LicenseBadge,
  MetricRow,
  RequirementTags,
  ScoreBadge,
  SourceBadge,
} from './Badges';
import { HighlightedText } from './HighlightedText';

import '../market.css';

/** 卡片 props（回调由页面给：打开详情、进入装载确认、卸载）。 */
export interface MarketCardProps {
  asset: MarketAsset;
  /** 已装载（本地装载记录命中）。 */
  loaded: boolean;
  /** 已装载且内容哈希变化（可更新提示）。 */
  updateAvailable?: boolean;
  /** 搜索串（命中高亮；空串不高亮）。 */
  query: string;
  onOpen: (assetId: string) => void;
  onInstall: (asset: MarketAsset) => void;
  onUninstall: (assetId: string) => void;
}

/** 市场卡片。 */
export function MarketCard({
  asset,
  loaded,
  updateAvailable = false,
  query,
  onOpen,
  onInstall,
  onUninstall,
}: MarketCardProps) {
  const [hovered, setHovered] = useState(false);
  const install = describeInstallButton(asset.installGate.mode, loaded);
  const sourceUrl = buildSourceUrl(asset);
  const secondaryName = assetSecondaryName(asset);

  return (
    <article
      className="dfg-market__card"
      data-df-market="card"
      data-df-asset={asset.id}
      data-df-kind={asset.kind}
      data-df-gate={asset.installGate.mode}
      data-df-state={hovered ? 'hover' : 'default'}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
    >
      <div className="dfg-market__thumb" aria-hidden>
        {kindIcon(asset.kind, 32)}
      </div>

      <div className="dfg-market__card-title">
        <div>
          <h3 className="dfg-market__card-name">
            <button
              type="button"
              onClick={() => {
                onOpen(asset.id);
              }}
              className="dfg-market__card-open"
              data-df-market="card-open"
            >
              <HighlightedText text={assetPrimaryName(asset)} query={query} />
            </button>
          </h3>
          {secondaryName.length > 0 ? (
            <p className="dfg-market__card-sub-name">{secondaryName}</p>
          ) : null}
        </div>
        <ScoreBadge score={asset.quality.score} />
      </div>

      <p className="dfg-market__card-summary" data-df-market="card-summary">
        <HighlightedText text={asset.summary['zh-CN'] ?? asset.summary.en ?? ''} query={query} />
      </p>

      <div className="dfg-market__badge-row">
        <KindBadge kind={asset.kind} />
        <SourceBadge
          repo={asset.source.repo}
          gitRef={asset.source.ref}
          archived={asset.source.archived}
        />
        <LicenseBadge gate={asset.source.license.gate} />
        {loaded ? (
          <span className={badgeClassName('ok')} data-df-market="badge" data-df-badge="loaded">
            {t('market.card.loadedBadge')}
          </span>
        ) : null}
        {updateAvailable ? (
          <span className={badgeClassName('warn')} data-df-market="badge" data-df-badge="update">
            {t('market.card.updateBadge')}
          </span>
        ) : null}
        {asset.yanked !== null ? (
          <span className={badgeClassName('danger')} data-df-market="badge" data-df-badge="yanked">
            {t('market.card.yankedBadge', { reason: asset.yanked.reason })}
          </span>
        ) : null}
      </div>

      <MetricRow asset={asset} />
      <RequirementTags capabilities={asset.capabilities} />

      <div className="dfg-market__badge-row" data-df-market="card-actions">
        <Button
          variant={asset.installGate.mode === 'loadable' && !loaded ? 'primary' : 'secondary'}
          size="sm"
          disabled={install.disabled}
          {...(install.disabledReasonKey === null
            ? {}
            : { disabledReason: t(install.disabledReasonKey) })}
          data-df-state={install.disabled ? 'disabled' : 'enabled'}
          onClick={() => {
            onInstall(asset);
          }}
        >
          {t(install.labelKey)}
        </Button>

        <DropdownMenu
          label={t('market.card.moreActions', { name: assetPrimaryName(asset) })}
          align="start"
          trigger={(state) => (
            <Button
              variant="ghost"
              size="sm"
              icon={<MoreHorizontalIcon />}
              aria-haspopup={state.triggerProps['aria-haspopup']}
              aria-expanded={state.triggerProps['aria-expanded']}
              aria-controls={state.triggerProps['aria-controls']}
              onClick={state.toggle}
              onKeyDown={state.triggerProps.onKeyDown}
              ref={state.triggerProps.ref}
              data-df-market="card-more"
            >
              {t('market.card.more')}
            </Button>
          )}
          sections={[
            {
              id: 'primary',
              items: [
                {
                  id: 'open',
                  label: t('market.card.open'),
                  onSelect: () => {
                    onOpen(asset.id);
                  },
                },
                {
                  id: 'source',
                  label: t('market.card.viewSource'),
                  disabled: sourceUrl === null,
                  ...(sourceUrl === null ? { disabledReason: t('market.card.sourceMissing') } : {}),
                  onSelect: () => {
                    if (sourceUrl !== null) window.open(sourceUrl, '_blank', 'noopener');
                  },
                },
              ],
            },
            {
              id: 'danger',
              label: t('market.card.sectionDanger'),
              items: [
                {
                  id: 'uninstall',
                  label: t('market.card.uninstall'),
                  danger: true,
                  disabled: !loaded,
                  ...(loaded ? {} : { disabledReason: t('market.card.notLoadedReason') }),
                  onSelect: () => {
                    onUninstall(asset.id);
                  },
                },
              ],
            },
          ]}
        />
      </div>
    </article>
  );
}
