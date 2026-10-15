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
import { describeInstallButton, describeLicenseGate } from '../capabilities';
import { containsCjk } from '../filters';
import {
  badgeRowStyle,
  badgeStyle,
  detailLayoutStyle,
  hintStyle,
  kvKeyStyle,
  kvTableStyle,
  kvValueStyle,
  previewCanvasStyle,
  previewStyle,
  sectionStyle,
  sectionTitleStyle,
  thumbStyle,
} from '../styles';
import { KindBadge, kindIcon, LicenseBadge, ScoreBadge, SourceBadge } from './Badges';
import { CapabilityList } from './CapabilityList';
import { QualityPanel } from './QualityPanel';

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
      <div style={badgeRowStyle}>
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
          <span style={badgeStyle('warn')}>{t('market.card.updateBadge')}</span>
        ) : null}
      </div>

      {asset.yanked === null ? null : (
        <p style={badgeStyle('danger')} role="alert" data-df-market="detail-yanked">
          {t('market.detail.yanked', {
            reason: asset.yanked.reason,
            at: asset.yanked.at,
            source: asset.yanked.source,
          })}
        </p>
      )}

      <div style={detailLayoutStyle}>
        <section style={previewStyle} data-df-market="detail-preview">
          <h2 style={sectionTitleStyle}>{t('market.detail.preview')}</h2>
          <div style={previewCanvasStyle} aria-hidden>
            <span style={thumbStyle}>{kindIcon(asset.kind, 48)}</span>
          </div>
          <p style={hintStyle}>{t('market.detail.previewPlaceholder')}</p>
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

        <div style={{ display: 'grid', gap: 'var(--dfg-space-4)' }}>
          <section style={sectionStyle} data-df-market="detail-basic">
            <h2 style={sectionTitleStyle}>{t('market.detail.basic')}</h2>
            <dl style={kvTableStyle}>
              <dt style={kvKeyStyle}>{t('market.detail.source')}</dt>
              <dd style={kvValueStyle}>
                {asset.source.repo} ·{' '}
                {t('market.detail.commit', { short: asset.source.ref.slice(0, 7) })}
              </dd>
              <dt style={kvKeyStyle}>{t('market.detail.path')}</dt>
              <dd style={kvValueStyle}>{asset.source.path.length > 0 ? asset.source.path : '/'}</dd>
              <dt style={kvKeyStyle}>{t('market.detail.author')}</dt>
              <dd style={kvValueStyle}>{author}</dd>
              <dt style={kvKeyStyle}>{t('market.detail.license')}</dt>
              <dd style={kvValueStyle} data-df-market="detail-license">
                {t('market.detail.licenseDetail', {
                  tier: t(license.labelKey),
                  spdx: asset.source.license.spdx ?? t('market.load.spdxUnknown'),
                })}
                <span style={hintStyle}> {t(license.noticeKey)}</span>
              </dd>
              <dt style={kvKeyStyle}>{t('market.detail.version')}</dt>
              <dd style={kvValueStyle}>{asset.version ?? t('market.detail.versionUnknown')}</dd>
              <dt style={kvKeyStyle}>{t('market.detail.id')}</dt>
              <dd style={kvValueStyle} data-df-market="detail-id">
                {asset.id}
              </dd>
              <dt style={kvKeyStyle}>{t('market.detail.stars')}</dt>
              <dd style={kvValueStyle}>{asset.source.stars}</dd>
              <dt style={kvKeyStyle}>{t('market.detail.pushedAt')}</dt>
              <dd style={kvValueStyle}>{asset.source.pushedAt}</dd>
              <dt style={kvKeyStyle}>{t('market.detail.archived')}</dt>
              <dd style={kvValueStyle}>
                {asset.source.archived
                  ? t('market.detail.archivedYes')
                  : t('market.detail.archivedNo')}
              </dd>
            </dl>
          </section>

          <section style={sectionStyle} data-df-market="detail-overview">
            <h2 style={sectionTitleStyle}>{t('market.detail.overview')}</h2>
            {description.length === 0 ? (
              <p style={hintStyle}>{t('market.detail.noOverview')}</p>
            ) : (
              <>
                {descriptionIsEnglish ? (
                  <p style={badgeStyle('warn')} data-df-market="detail-translation-notice">
                    {t('market.detail.translationNotice')}
                  </p>
                ) : null}
                <p style={{ margin: '0', lineHeight: 'var(--dfg-line-height-relaxed)' }}>
                  {description}
                </p>
              </>
            )}
          </section>

          <QualityPanel quality={asset.quality} />

          <section style={sectionStyle} data-df-market="detail-capabilities">
            <h2 style={sectionTitleStyle}>{t('market.detail.capabilities')}</h2>
            <CapabilityList
              capabilities={asset.capabilities}
              ackRequired={asset.installGate.ackRequired}
            />
            <p style={hintStyle} data-df-market="detail-security">
              {t('market.detail.security', {
                verdict: t(SECURITY_LABEL_KEYS[asset.installGate.security]),
              })}
            </p>
          </section>

          <section style={sectionStyle} data-df-market="detail-usage">
            <h2 style={sectionTitleStyle}>{t('market.detail.usage')}</h2>
            <p style={hintStyle}>{t('market.detail.usageNote')}</p>
            <div style={badgeRowStyle}>
              <span style={hintStyle}>{t('market.detail.tags')}</span>
              {asset.facets.tags.length === 0 ? (
                <span style={hintStyle}>{t('market.detail.noTags')}</span>
              ) : (
                asset.facets.tags.map((tag) => (
                  <span key={tag} style={badgeStyle('neutral')}>
                    {tag}
                  </span>
                ))
              )}
            </div>
            <div style={badgeRowStyle}>
              <span style={hintStyle}>{t('market.detail.scenes')}</span>
              {asset.facets.scenes.length === 0 ? (
                <span style={hintStyle}>{t('market.detail.noScenes')}</span>
              ) : (
                asset.facets.scenes.map((scene) => (
                  <span key={scene} style={badgeStyle('neutral')}>
                    {scene}
                  </span>
                ))
              )}
            </div>
          </section>

          <section style={sectionStyle} data-df-market="detail-more">
            <h2 style={sectionTitleStyle}>{t('market.detail.more')}</h2>
            <dl style={kvTableStyle}>
              <dt style={kvKeyStyle}>{t('market.detail.digest')}</dt>
              <dd style={kvValueStyle}>{asset.digest}</dd>
              <dt style={kvKeyStyle}>{t('market.detail.category')}</dt>
              <dd style={kvValueStyle}>{asset.facets.category}</dd>
              <dt style={kvKeyStyle}>{t('market.detail.lane')}</dt>
              <dd style={kvValueStyle}>{asset.facets.lane}</dd>
              <dt style={kvKeyStyle}>{t('market.detail.mode')}</dt>
              <dd style={kvValueStyle}>{asset.facets.mode ?? t('market.detail.modeUnknown')}</dd>
              <dt style={kvKeyStyle}>{t('market.detail.fetchedAt')}</dt>
              <dd style={kvValueStyle}>{asset.source.fetchedAt}</dd>
              {loaded && loadedAt !== null ? (
                <>
                  <dt style={kvKeyStyle}>{t('market.detail.loadedAt')}</dt>
                  <dd style={kvValueStyle}>{loadedAt}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section style={sectionStyle} data-df-market="detail-actions">
            <div style={badgeRowStyle}>
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
            <p style={hintStyle}>{t('market.detail.installHint')}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
