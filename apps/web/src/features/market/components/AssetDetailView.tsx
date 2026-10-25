'use client';

/**
 * AssetDetailView —— 资源详情（D2；规格 §6.2 逐区口径）。
 *
 * 版式：**左预览 / 右信息栏**。左栏 = 预览产物占位（索引不含图，占位即如实说明）+ 来源链接；
 * 右栏 = 基本信息（来源 repo/commit/路径、License、版本、ID、作者、星标、归档）→ 概述（原文 +
 * 语言声明 §6.3）→ 五维雷达与扣分原因 → 能力与安全 → 试试这样用（标签/场景）→ 更多（版本/ID/digest）→
 * 装载按钮三态（可装载 / 仅看 / 已装载）。
 *
 * 装载点击不在这里落库：交给页面打开 D4 确认框（`onLoadClick`），本组件只负责如实展示状态。
 */

import type { MarketAsset, MarketLoadPlan } from '@dforge/contracts';
import { Button, Tooltip } from '@dforge/ui';

import { t } from '@/i18n';

import { buildSourceUrl } from '../api';
import { badgeClassName } from '../badge-classes';
import { describeInstallButton, describeLicenseGate } from '../capabilities';
import { containsCjk } from '../filters';
import { KindBadge, kindIcon, LicenseBadge, ScoreBadge, SourceBadge } from './Badges';
import { CapabilityList } from './CapabilityList';
import { QualityPanel } from './QualityPanel';

import '../market.css';

/** 安全结论 → i18n 键与色调。 */
const SECURITY_LABEL_KEYS: Record<MarketAsset['installGate']['security'], string> = {
  pass: 'market.detail.security.pass',
  warn: 'market.detail.security.warn',
  fail: 'market.detail.security.fail',
};

/** 详情 props。 */
export interface AssetDetailViewProps {
  asset: MarketAsset;
  loaded: boolean;
  updateAvailable: boolean;
  /** 装载提案（daemon）；未取到时为 null（按钮仍按卡片口径显示）。 */
  plan: MarketLoadPlan | null;
  /** 本地装载记录的时刻（已装载时展示）。 */
  loadedAt: string | null;
  onBack: () => void;
  onLoadClick: () => void;
  onUninstall: () => void;
}

/** 资源详情视图。 */
export function AssetDetailView({
  asset,
  loaded,
  updateAvailable,
  plan,
  loadedAt,
  onBack,
  onLoadClick,
  onUninstall,
}: AssetDetailViewProps) {
  const sourceUrl = buildSourceUrl(asset);
  const license = describeLicenseGate(asset.source.license.gate);
  const install = describeInstallButton(asset.installGate.mode, loaded);
  const description = asset.description ?? '';
  const descriptionIsEnglish = description.length > 0 && !containsCjk(description);
  const author = asset.source.repo.split('/')[0] ?? asset.source.repo;

  const openSource = (): void => {
    if (sourceUrl !== null) window.open(sourceUrl, '_blank', 'noopener');
  };

  return (
    <div data-df-page="market-detail" data-df-asset={asset.id}>
      <div className="dfg-market__badge-row">
        <Button variant="ghost" size="sm" onClick={onBack} data-df-market="detail-back">
          {t('market.detail.back')}
        </Button>
        <KindBadge kind={asset.kind} />
        <SourceBadge
          repo={asset.source.repo}
          gitRef={asset.source.ref}
          archived={asset.source.archived}
        />
        <LicenseBadge gate={asset.source.license.gate} />
        <ScoreBadge score={asset.quality.score} />
        {updateAvailable ? (
          <span className={badgeClassName('warn')}>{t('market.card.updateBadge')}</span>
        ) : null}
      </div>

      {asset.yanked === null ? null : (
        <p className={badgeClassName('danger')} role="alert" data-df-market="detail-yanked">
          {t('market.detail.yanked', {
            reason: asset.yanked.reason,
            at: asset.yanked.at,
            source: asset.yanked.source,
          })}
        </p>
      )}

      <div className="dfg-market__detail-layout">
        <section className="dfg-market__preview" data-df-market="detail-preview">
          <h2 className="dfg-market__section-title">{t('market.detail.preview')}</h2>
          <div className="dfg-market__preview-canvas" aria-hidden>
            <span className="dfg-market__thumb">{kindIcon(asset.kind, 48)}</span>
          </div>
          <p className="dfg-market__hint">{t('market.detail.previewPlaceholder')}</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={sourceUrl === null}
            {...(sourceUrl === null ? { disabledReason: t('market.card.sourceMissing') } : {})}
            onClick={openSource}
            data-df-market="detail-source"
          >
            {t('market.detail.openSource')}
          </Button>
        </section>

        <div className="dfg-market__stack">
          <section className="dfg-market__section" data-df-market="detail-basic">
            <h2 className="dfg-market__section-title">{t('market.detail.basic')}</h2>
            <dl className="dfg-market__kv-table">
              <dt className="dfg-market__kv-key">{t('market.detail.source')}</dt>
              <dd className="dfg-market__kv-value">
                {asset.source.repo} ·{' '}
                {t('market.detail.commit', { short: asset.source.ref.slice(0, 7) })}
              </dd>
              <dt className="dfg-market__kv-key">{t('market.detail.path')}</dt>
              <dd className="dfg-market__kv-value">
                {asset.source.path.length > 0 ? asset.source.path : '/'}
              </dd>
              <dt className="dfg-market__kv-key">{t('market.detail.author')}</dt>
              <dd className="dfg-market__kv-value">{author}</dd>
              <dt className="dfg-market__kv-key">{t('market.detail.license')}</dt>
              <dd className="dfg-market__kv-value" data-df-market="detail-license">
                {t('market.detail.licenseDetail', {
                  tier: t(license.labelKey),
                  spdx: asset.source.license.spdx ?? t('market.load.spdxUnknown'),
                })}
                <span className="dfg-market__hint"> {t(license.noticeKey)}</span>
              </dd>
              <dt className="dfg-market__kv-key">{t('market.detail.version')}</dt>
              <dd className="dfg-market__kv-value">{asset.version ?? t('market.detail.versionUnknown')}</dd>
              <dt className="dfg-market__kv-key">{t('market.detail.id')}</dt>
              <dd className="dfg-market__kv-value" data-df-market="detail-id">
                {asset.id}
              </dd>
              <dt className="dfg-market__kv-key">{t('market.detail.stars')}</dt>
              <dd className="dfg-market__kv-value">{asset.source.stars}</dd>
              <dt className="dfg-market__kv-key">{t('market.detail.pushedAt')}</dt>
              <dd className="dfg-market__kv-value">{asset.source.pushedAt}</dd>
              <dt className="dfg-market__kv-key">{t('market.detail.archived')}</dt>
              <dd className="dfg-market__kv-value">
                {asset.source.archived
                  ? t('market.detail.archivedYes')
                  : t('market.detail.archivedNo')}
              </dd>
            </dl>
          </section>

          <section className="dfg-market__section" data-df-market="detail-overview">
            <h2 className="dfg-market__section-title">{t('market.detail.overview')}</h2>
            {description.length === 0 ? (
              <p className="dfg-market__hint">{t('market.detail.noOverview')}</p>
            ) : (
              <>
                {descriptionIsEnglish ? (
                  <p
                    className={badgeClassName('warn')}
                    data-df-market="detail-translation-notice"
                  >
                    {t('market.detail.translationNotice')}
                  </p>
                ) : null}
                <p className="dfg-market__prose dfg-market__prose--relaxed">{description}</p>
              </>
            )}
          </section>

          <QualityPanel quality={asset.quality} />

          <section className="dfg-market__section" data-df-market="detail-capabilities">
            <h2 className="dfg-market__section-title">{t('market.detail.capabilities')}</h2>
            <CapabilityList
              capabilities={asset.capabilities}
              ackRequired={asset.installGate.ackRequired}
            />
            <p className="dfg-market__hint" data-df-market="detail-security">
              {t('market.detail.security', {
                verdict: t(SECURITY_LABEL_KEYS[asset.installGate.security]),
              })}
            </p>
          </section>

          <section className="dfg-market__section" data-df-market="detail-usage">
            <h2 className="dfg-market__section-title">{t('market.detail.usage')}</h2>
            <p className="dfg-market__hint">{t('market.detail.usageNote')}</p>
            <div className="dfg-market__badge-row">
              <span className="dfg-market__hint">{t('market.detail.tags')}</span>
              {asset.facets.tags.length === 0 ? (
                <span className="dfg-market__hint">{t('market.detail.noTags')}</span>
              ) : (
                asset.facets.tags.map((tag) => (
                  <span key={tag} className={badgeClassName('neutral')}>
                    {tag}
                  </span>
                ))
              )}
            </div>
            <div className="dfg-market__badge-row">
              <span className="dfg-market__hint">{t('market.detail.scenes')}</span>
              {asset.facets.scenes.length === 0 ? (
                <span className="dfg-market__hint">{t('market.detail.noScenes')}</span>
              ) : (
                asset.facets.scenes.map((scene) => (
                  <span key={scene} className={badgeClassName('neutral')}>
                    {scene}
                  </span>
                ))
              )}
            </div>
          </section>

          <section className="dfg-market__section" data-df-market="detail-more">
            <h2 className="dfg-market__section-title">{t('market.detail.more')}</h2>
            <dl className="dfg-market__kv-table">
              <dt className="dfg-market__kv-key">{t('market.detail.digest')}</dt>
              <dd className="dfg-market__kv-value">{asset.digest}</dd>
              <dt className="dfg-market__kv-key">{t('market.detail.category')}</dt>
              <dd className="dfg-market__kv-value">{asset.facets.category}</dd>
              <dt className="dfg-market__kv-key">{t('market.detail.lane')}</dt>
              <dd className="dfg-market__kv-value">{asset.facets.lane}</dd>
              <dt className="dfg-market__kv-key">{t('market.detail.mode')}</dt>
              <dd className="dfg-market__kv-value">{asset.facets.mode ?? t('market.detail.modeUnknown')}</dd>
              <dt className="dfg-market__kv-key">{t('market.detail.fetchedAt')}</dt>
              <dd className="dfg-market__kv-value">{asset.source.fetchedAt}</dd>
              {loaded && loadedAt !== null ? (
                <>
                  <dt className="dfg-market__kv-key">{t('market.detail.loadedAt')}</dt>
                  <dd className="dfg-market__kv-value">{loadedAt}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section className="dfg-market__section" data-df-market="detail-actions">
            <div className="dfg-market__badge-row">
              <Tooltip
                content={plan === null ? t('market.detail.planPending') : plan.notice}
                delay={0}
              >
                <Button
                  variant={
                    asset.installGate.mode === 'loadable' && !loaded ? 'primary' : 'secondary'
                  }
                  disabled={install.disabled}
                  {...(install.disabledReasonKey === null
                    ? {}
                    : { disabledReason: t(install.disabledReasonKey) })}
                  data-df-state={install.disabled ? 'disabled' : 'enabled'}
                  onClick={onLoadClick}
                  data-df-market="detail-install"
                >
                  {t(install.labelKey)}
                </Button>
              </Tooltip>
              {loaded ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={onUninstall}
                  data-df-market="detail-uninstall"
                >
                  {t('market.card.uninstall')}
                </Button>
              ) : null}
            </div>
            <p className="dfg-market__hint">{t('market.detail.installHint')}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
