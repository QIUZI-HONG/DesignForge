'use client';

/**
 * 徽标族与卡片标签（D1 卡片信息行 / D2 详情信息栏共用）。
 *
 * 口径（规格 §6.1）：名称（中文主）+ kind 徽标 + 来源徽标（repo@短哈希）+ 总分徽标 +
 * 标签（需连接器 / 需云端 key / 本地离线可用 + 许可档）。颜色一律走令牌，禁裸值。
 */

import type { MarketAsset, MarketAssetKind } from '@dforge/contracts';
import { displayText } from '@dforge/contracts';
import { ComponentIcon, FrameIcon, LayersIcon, TextIcon } from '@dforge/ui';

import { t } from '@/i18n';
import { badgeClassName } from '../badge-classes';
import { describeLicenseGate, describeRequirementTags } from '../capabilities';

import '../market.css';

/** kind → 中文标签键。 */
const KIND_LABEL_KEYS: Record<MarketAssetKind, string> = {
  skill: 'market.kind.skill',
  plugin: 'market.kind.plugin',
  'design-system': 'market.kind.designSystem',
  template: 'market.kind.template',
};

/** kind → 图标（卡片缩略图与徽标共用）；`size` 缺省交给图标默认档（exactOptionalPropertyTypes）。 */
export function kindIcon(kind: MarketAssetKind, size?: number) {
  const props = size === undefined ? {} : { size };
  switch (kind) {
    case 'plugin':
      return <ComponentIcon {...props} />;
    case 'design-system':
      return <LayersIcon {...props} />;
    case 'template':
      return <FrameIcon {...props} />;
    default:
      return <TextIcon {...props} />;
  }
}

/** 四类资产徽标。 */
export function KindBadge({ kind }: { kind: MarketAssetKind }) {
  return (
    <span className={badgeClassName('neutral')} data-df-market="badge" data-df-badge="kind">
      {t(KIND_LABEL_KEYS[kind])}
    </span>
  );
}

/**
 * 来源徽标：`repo@短哈希`（社区来源必须显示 repo + commit，规格 §6.1）。
 *
 * 注意 prop 名用 `gitRef` 而不是 `ref`：`ref` 是 React 的保留属性，
 * 函数组件收到字符串 ref 会直接抛错（「Element ref was specified as a string」）。
 */
export function SourceBadge({
  repo,
  gitRef,
  archived,
}: {
  repo: string;
  gitRef: string;
  archived?: boolean;
}) {
  const short = gitRef.slice(0, 7);
  return (
    <span
      className={badgeClassName(archived === true ? 'warn' : 'neutral')}
      data-df-market="badge"
      data-df-badge="source"
    >
      {short.length > 0 ? `${repo}@${short}` : repo}
      {archived === true ? ` · ${t('market.badge.archived')}` : ''}
    </span>
  );
}

/** license 三档徽标（色调随档位：可装载 ok / 仅看 warn / 禁 danger）。 */
export function LicenseBadge({ gate }: { gate: MarketAsset['source']['license']['gate'] }) {
  const descriptor = describeLicenseGate(gate);
  return (
    <span
      className={badgeClassName(descriptor.tone)}
      data-df-market="badge"
      data-df-badge="license"
    >
      {t('market.badge.license', { tier: t(descriptor.labelKey) })}
    </span>
  );
}

/** 总分徽标（总分不单独展示为数字大标题，跟随雷达与徽标——规格 §5.1）。 */
export function ScoreBadge({ score }: { score: number }) {
  return (
    <span className={badgeClassName('ok')} data-df-market="badge" data-df-badge="score">
      {t('market.badge.score', { score: score.toFixed(2) })}
    </span>
  );
}

/** 指标行（首版无回流数据：只显示星标与更新时间，采纳/收藏隐藏——规格 §9.12 联调决定）。 */
export function MetricRow({ asset }: { asset: MarketAsset }) {
  const metrics = asset.metrics;
  const hasFeedback =
    metrics !== undefined &&
    (metrics.installs > 0 || metrics.adoptions > 0 || metrics.favorites > 0);
  return (
    <span className="dfg-market__badge-row" data-df-market="metrics">
      <span className={badgeClassName('neutral')}>
        {t('market.metric.stars', { count: asset.source.stars })}
      </span>
      {hasFeedback ? (
        <span className={badgeClassName('neutral')}>
          {t('market.metric.feedback', {
            installs: metrics?.installs ?? 0,
            adoptions: metrics?.adoptions ?? 0,
          })}
        </span>
      ) : (
        <span className={badgeClassName('neutral')} data-df-market="metrics-pending">
          {t('market.metric.localOnlyPending')}
        </span>
      )}
    </span>
  );
}

/** 运行前提标签（需连接器 / 需云端 key / 本地离线可用）。 */
export function RequirementTags({ capabilities }: { capabilities: readonly string[] }) {
  const keys = describeRequirementTags(capabilities);
  return (
    <span className="dfg-market__badge-row" data-df-market="requirement-tags">
      {keys.map((key) => (
        <span key={key} className={badgeClassName(key === 'market.tag.localOnly' ? 'ok' : 'warn')}>
          {t(key)}
        </span>
      ))}
    </span>
  );
}

/** 卡片主名（中文主昵称），带英文/机器名副行（双语卡片：主文案取 zh-CN，缺失回退 en/name）。 */
export function assetPrimaryName(asset: MarketAsset): string {
  return displayText(asset.displayName, asset.name);
}

/** 卡片副名（第二语言行；与主名相同则返回空串，卡片不渲染副行）。 */
export function assetSecondaryName(asset: MarketAsset): string {
  const primary = assetPrimaryName(asset);
  const english = asset.displayName.en;
  const secondary = typeof english === 'string' && english.length > 0 ? english : asset.name;
  return secondary === primary ? '' : secondary;
}
