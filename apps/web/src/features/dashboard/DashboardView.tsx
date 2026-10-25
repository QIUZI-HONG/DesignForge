'use client';

/**
 * DashboardView —— 数据看板（D6；浅色首页族）。
 *
 * 三段：**采集进度**（批次/水位/规模）→ **四层状态**（ODS/DWD/DWS/ADS）→ **质量三看板**
 * （完整性 / 一致性 / 时效性）。数值全部来自 `metrics.ts` 的纯函数；算不出的项显示
 * 「未上报」并给出原因，**不给通过/不通过结论**（阈值待 MK，规格 §9.11）。
 */

import type { MarketAssetKind, MarketQueryResponse } from '@dforge/contracts';
import type { ReactNode } from 'react';
import { badgeClassName, meterFillClassName } from '@/features/market';
import { t } from '@/i18n';
import { UNAVAILABLE_PLACEHOLDER } from '@/lib/unavailable';
import {
  computeCompleteness,
  computeConsistency,
  computeFreshness,
  readCollectionProgress,
  readLayerStatuses,
} from './metrics';

import '@/features/market/market.css';

/** 四类资产的 i18n 键（看板的分部计数用）。 */
const KIND_LABEL_KEYS: Record<MarketAssetKind, string> = {
  skill: 'market.kind.skill',
  plugin: 'market.kind.plugin',
  'design-system': 'market.kind.designSystem',
  template: 'market.kind.template',
};

/** 看板 props（`nowIso` 由页面注入：时效性分档需要「现在」）。 */
export interface DashboardViewProps {
  response: MarketQueryResponse;
  nowIso: string;
}

/** 数据看板视图。 */
export function DashboardView({ response, nowIso }: DashboardViewProps) {
  const progress = readCollectionProgress(response);
  const layers = readLayerStatuses(response);
  const completeness = computeCompleteness(response.items);
  const consistency = computeConsistency(response.items);
  const freshness = computeFreshness(response.items, { generatedAt: response.generatedAt }, nowIso);
  const freshMax = Math.max(1, ...freshness.buckets.map((bucket) => bucket.count));
  const notReported = (
    <span className={badgeClassName('warn')} data-df-market="not-reported">
      {t('dashboard.notReported')}
    </span>
  );

  return (
    <div data-df-page="dashboard" className="dfg-market__stack">
      <section className="dfg-market__section" data-df-market="progress">
        <h2 className="dfg-market__section-title">{t('dashboard.progress.title')}</h2>
        <div className="dfg-market__stat-grid">
          <StatCard
            label={t('dashboard.progress.generatedAt')}
            value={progress.generatedAt ?? t('dashboard.notReported')}
          />
          <StatCard label={t('dashboard.progress.runId')} value={notReported} />
          <StatCard label={t('dashboard.progress.watermark')} value={notReported} />
          <StatCard
            label={t('dashboard.progress.total')}
            value={progress.total === null ? t('dashboard.notReported') : String(progress.total)}
          />
          <StatCard
            label={t('dashboard.progress.loadable')}
            value={
              progress.loadable === null ? t('dashboard.notReported') : String(progress.loadable)
            }
          />
          <StatCard
            label={t('dashboard.progress.gated')}
            value={progress.gated === null ? t('dashboard.notReported') : String(progress.gated)}
          />
          <StatCard label={t('dashboard.progress.loaded')} value={String(progress.loaded)} />
        </div>
        <p className="dfg-market__hint" data-df-market="progress-note">
          {t('dashboard.progress.loadedNote', {
            loaded: progress.loaded,
            total: progress.total ?? 0,
          })}
        </p>
        <div className="dfg-market__badge-row">
          {progress.byKind.map((entry) => (
            <span key={entry.kind} className={badgeClassName('neutral')}>
              {t(KIND_LABEL_KEYS[entry.kind])} {entry.count}
            </span>
          ))}
        </div>
        <p className="dfg-market__hint">{t('dashboard.notReportedReason')}</p>
      </section>

      <section className="dfg-market__section" data-df-market="layers">
        <h2 className="dfg-market__section-title">{t('dashboard.layers.title')}</h2>
        <table className="dfg-market__table">
          <thead>
            <tr>
              <th className="dfg-market__th">{t('dashboard.layer.id')}</th>
              <th className="dfg-market__th">{t('dashboard.layer.entries')}</th>
              <th className="dfg-market__th">{t('dashboard.layer.rebuiltAt')}</th>
              <th className="dfg-market__th">{t('dashboard.layer.note')}</th>
            </tr>
          </thead>
          <tbody>
            {layers.map((layer) => (
              <tr key={layer.id} data-df-market="layer-row" data-df-layer={layer.id}>
                <td className="dfg-market__td">{t(layer.labelKey)}</td>
                <td className="dfg-market__td">
                  {layer.entries === null ? notReported : String(layer.entries)}
                </td>
                <td className="dfg-market__td">{layer.rebuiltAt === null ? notReported : layer.rebuiltAt}</td>
                <td className="dfg-market__td">
                  <span className="dfg-market__hint">{t(layer.noteKey)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="dfg-market__section" data-df-market="quality-boards">
        <h2 className="dfg-market__section-title">{t('dashboard.quality.title')}</h2>
        <p className="dfg-market__hint" data-df-market="thresholds-pending">
          {t('dashboard.quality.thresholdsPending')}
        </p>

        <h3 className="dfg-market__section-title">{t('dashboard.completeness.title')}</h3>
        <p className="dfg-market__hint" data-df-market="completeness-rate">
          {t('dashboard.completeness.rate', {
            rate: completeness.rate.toFixed(3),
            missing: completeness.missingTotal,
            slots: completeness.total * completeness.fields.length,
          })}
        </p>
        <table className="dfg-market__table" data-df-market="completeness-table">
          <thead>
            <tr>
              <th className="dfg-market__th">{t('dashboard.completeness.field')}</th>
              <th className="dfg-market__th">{t('dashboard.completeness.missing')}</th>
              <th className="dfg-market__th">{t('dashboard.completeness.rateOfField')}</th>
            </tr>
          </thead>
          <tbody>
            {completeness.fields.map((field) => (
              <tr key={field.field}>
                <td className="dfg-market__td">{field.field}</td>
                <td className="dfg-market__td">{field.missing}</td>
                <td className="dfg-market__td">
                  {completeness.total === 0
                    ? UNAVAILABLE_PLACEHOLDER
                    : (field.missing / completeness.total).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="dfg-market__section-title">{t('dashboard.consistency.title')}</h3>
        <div className="dfg-market__stat-grid">
          <StatCard
            label={t('dashboard.consistency.duplicateIds')}
            value={String(consistency.duplicateIdGroups.length)}
          />
          <StatCard
            label={t('dashboard.consistency.duplicateDigests')}
            value={String(consistency.duplicateDigestGroups.length)}
          />
          <StatCard
            label={t('dashboard.consistency.dangling')}
            value={String(consistency.danglingRefs)}
          />
        </div>
        <p className="dfg-market__hint">{t('dashboard.consistency.explain')}</p>

        <h3 className="dfg-market__section-title">{t('dashboard.freshness.title')}</h3>
        <div className="dfg-market__stat-grid">
          {freshness.buckets.map((bucket) => (
            <div
              key={bucket.key}
              className="dfg-market__stat-card"
              data-df-market="freshness-bucket"
              data-df-bucket={bucket.key}
            >
              <span className="dfg-market__stat-label">{t(bucket.labelKey)}</span>
              <span className="dfg-market__stat-value">{bucket.count}</span>
              <span className="dfg-market__meter-track">
                <span
                  className={meterFillClassName('primary')}
                  // 填充宽度由数据给百分比（动态值豁免——工单 06 登记表）
                  style={{ width: `${String(Math.round((bucket.count / freshMax) * 100))}%` }}
                />
              </span>
            </div>
          ))}
          <StatCard label={t('dashboard.fresh.unknown')} value={String(freshness.unknown)} />
        </div>
        <p className="dfg-market__hint" data-df-market="index-age">
          {freshness.indexAgeDays === null
            ? t('dashboard.fresh.indexAgeUnknown')
            : t('dashboard.fresh.indexAge', {
                days: freshness.indexAgeDays.toFixed(1),
                at: progress.generatedAt ?? '',
              })}
        </p>
      </section>
    </div>
  );
}

/** 统计卡（数值 + 标签）。 */
function StatCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="dfg-market__stat-card" data-df-market="stat">
      <span className="dfg-market__stat-label">{label}</span>
      <span className="dfg-market__stat-value">{value}</span>
    </div>
  );
}
