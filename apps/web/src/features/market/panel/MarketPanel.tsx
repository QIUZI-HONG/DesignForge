'use client';

/**
 * MarketPanel —— 编辑器内市场面板（D5，深色族 UI3）。
 *
 * 形态（规格 §6.2 D5）：面板列表 + 详情 + 「试跑」入口 + 采纳展示。
 * - **试跑**默认 dryRun、无副作用：只列将授予的能力与注入点，不执行网络/子进程调用；
 * - **采纳**只记本地计数（遥测默认仅本地，§8.3），不改文档、不上云；
 * - 装载（写事务）仍走 `LoadConfirmDialog` 的三段式——面板给入口，不另开旁路。
 *
 * 挂点说明：编辑器壳层（FE-03）尚未并入集成分支，本组件先在独立深色路由 `/market/panel`
 * 完整呈现（含 `data-df-page` 取样名），壳层落地后由壳层把本组件挂到右栏并持有主题。
 */

import type { MarketAsset } from '@dforge/contracts';
import { displayText } from '@dforge/contracts';
import { Button, EyeIcon } from '@dforge/ui';
import { t } from '@/i18n';
import { badgeClassName } from '../badge-classes';
import { describeInstallButton } from '../capabilities';
import {
  assetPrimaryName,
  KindBadge,
  kindIcon,
  LicenseBadge,
  ScoreBadge,
} from '../components/Badges';
import type { FeedbackEntry } from '../feedback';

import '../market.css';

/** 面板 props（选中项、试跑与采纳配额由页面持有）。 */
export interface MarketPanelProps {
  assets: readonly MarketAsset[];
  loadedIds: readonly string[];
  feedback: readonly FeedbackEntry[];
  selectedId: string | null;
  /** 试跑（dryRun）：页面只记本地计数。 */
  onRun: (assetId: string) => void;
  /** 采纳：页面只记本地计数。 */
  onAdopt: (assetId: string) => void;
  onSelect: (assetId: string) => void;
  /** 打开完整详情（/market/[assetId]）。 */
  onOpenDetail: (assetId: string) => void;
}

/** 编辑器内市场面板（深色）。 */
export function MarketPanel({
  assets,
  loadedIds,
  feedback,
  selectedId,
  onRun,
  onAdopt,
  onSelect,
  onOpenDetail,
}: MarketPanelProps) {
  const selected = assets.find((asset) => asset.id === selectedId) ?? assets[0] ?? null;
  const feedbackOfAsset =
    selected === null
      ? { assetId: '', runs: 0, adoptions: 0, lastAt: '' }
      : (feedback.find((entry) => entry.assetId === selected.id) ?? {
          assetId: selected.id,
          runs: 0,
          adoptions: 0,
          lastAt: '',
        });
  const install =
    selected === null
      ? null
      : describeInstallButton(selected.installGate.mode, loadedIds.includes(selected.id));

  return (
    <section className="dfg-market__panel" data-df-page="market-panel" data-df-theme="dark">
      <div className="dfg-market__panel-header">
        <h2 className="dfg-market__panel-title">{t('market.panel.title')}</h2>
        <span className="dfg-market__hint">{t('market.panel.subtitle')}</span>
      </div>

      <ul className="dfg-market__panel-list" data-df-market="panel-list">
        {assets.map((asset) => (
          <li key={asset.id}>
            <button
              type="button"
              className="dfg-market__panel-row-btn"
              aria-pressed={selected !== null && asset.id === selected.id}
              onClick={() => {
                onSelect(asset.id);
              }}
              data-df-market="panel-row"
              data-df-asset={asset.id}
            >
              <span className="dfg-market__panel-row-head">
                {kindIcon(asset.kind, 12)}
                <strong>{assetPrimaryName(asset)}</strong>
                <ScoreBadge score={asset.quality.score} />
                {loadedIds.includes(asset.id) ? (
                  <span className={badgeClassName('ok')}>{t('market.card.loadedBadge')}</span>
                ) : null}
              </span>
              <span className="dfg-market__hint">{displayText(asset.summary, asset.name)}</span>
            </button>
          </li>
        ))}
      </ul>

      {selected === null ? (
        <p className="dfg-market__hint">{t('market.panel.empty')}</p>
      ) : (
        <div className="dfg-market__stack dfg-market__stack--gap-2" data-df-market="panel-detail">
          <div className="dfg-market__badge-row">
            <KindBadge kind={selected.kind} />
            <LicenseBadge gate={selected.source.license.gate} />
            <span className={badgeClassName('neutral')}>
              {t('market.panel.localCount', {
                runs: feedbackOfAsset.runs,
                adoptions: feedbackOfAsset.adoptions,
              })}
            </span>
          </div>
          <p className="dfg-market__prose">{displayText(selected.summary, selected.name)}</p>
          <p className="dfg-market__hint" data-df-market="panel-run-note">
            {t('market.panel.runNote')}
          </p>
          <div className="dfg-market__badge-row">
            <Button
              variant="secondary"
              size="sm"
              icon={<EyeIcon />}
              onClick={() => {
                onRun(selected.id);
              }}
              data-df-market="panel-run"
            >
              {t('market.panel.run')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={selected.installGate.mode !== 'loadable'}
              {...(selected.installGate.mode === 'loadable'
                ? {}
                : { disabledReason: t('market.install.viewOnlyReason') })}
              onClick={() => {
                onAdopt(selected.id);
              }}
              data-df-market="panel-adopt"
            >
              {t('market.panel.adopt')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onOpenDetail(selected.id);
              }}
              data-df-market="panel-open-detail"
            >
              {t('market.panel.openDetail')}
            </Button>
          </div>
          {install === null ? null : (
            <p className="dfg-market__hint" data-df-market="panel-gate">
              {t('market.panel.gate', { label: t(install.labelKey) })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
