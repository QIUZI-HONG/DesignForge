'use client';

/**
 * QualityPanel —— 五维评分可解释面板（D2：分维度雷达 + 扣分原因）。
 *
 * 组成：左侧雷达（SVG，五轴；**无信号点画空心**——区别于 0 分）+ 右侧分维度条与数值，
 * 下方「为什么是这个分」逐维列扣分原因（每维最多 3 条，人话文案优先取词表、回落数据 reason）。
 * 雷达本体 `aria-hidden`（纯装饰），可访问性由旁边的维度表与扣分列表承担。
 */

import type { MarketQuality } from '@dforge/contracts';

import { t } from '@/i18n';

import {
  buildRadarDims,
  deductionLabelKey,
  radarPolygon,
  summarizeDeductions,
  toPointsAttr,
} from '../quality';
import { badgeClassName, meterFillClassName } from '../badge-classes';

import '../market.css';

/** 雷达画布几何（SVG 用户单位，非 CSS 像素——不产生裸值）。 */
const RADAR_SIZE = 200;
const RADAR_CENTER = RADAR_SIZE / 2;
const RADAR_RADIUS = 72;

/** 分维度数值行。 */
export function QualityPanel({ quality }: { quality: MarketQuality }) {
  const dims = buildRadarDims(quality.dims, quality.explain);
  const groups = summarizeDeductions(quality.explain);

  const dataPoints = radarPolygon(
    dims.map((dim) => dim.value),
    RADAR_CENTER,
    RADAR_RADIUS,
  );
  const dotPoints = radarPolygon(
    dims.map(() => 1),
    RADAR_CENTER,
    RADAR_RADIUS,
  );

  return (
    <section className="dfg-market__section" data-df-market="quality-panel">
      <h2 className="dfg-market__section-title">{t('market.quality.title')}</h2>
      <p className="dfg-market__hint" data-df-market="quality-score">
        {t('market.quality.score', { score: quality.score.toFixed(2) })}
      </p>

      <div className="dfg-market__quality-layout">
        <svg
          width={RADAR_SIZE}
          height={RADAR_SIZE}
          viewBox={`0 0 ${String(RADAR_SIZE)} ${String(RADAR_SIZE)}`}
          aria-hidden
          data-df-market="radar"
        >
          {[0.25, 0.5, 0.75, 1].map((ring) => (
            <polygon
              key={`ring-${String(ring)}`}
              points={toPointsAttr(
                radarPolygon(
                  dims.map(() => ring),
                  RADAR_CENTER,
                  RADAR_RADIUS,
                ),
              )}
              fill="none"
              stroke="var(--dfg-color-border)"
              strokeWidth="1"
            />
          ))}
          {dotPoints.map((point, index) => (
            <line
              key={`axis-${String(index)}`}
              x1={RADAR_CENTER}
              y1={RADAR_CENTER}
              x2={point.x}
              y2={point.y}
              stroke="var(--dfg-color-border)"
              strokeWidth="1"
            />
          ))}
          <polygon
            points={toPointsAttr(dataPoints)}
            fill="var(--dfg-color-selection)"
            stroke="var(--dfg-color-primary)"
            strokeWidth="2"
          />
          {dataPoints.map((point, index) => {
            const dim = dims[index];
            const noSignal = dim?.hasSignal === false;
            return (
              <circle
                key={`dot-${String(index)}`}
                cx={point.x}
                cy={point.y}
                r="4"
                fill={noSignal ? 'var(--dfg-color-surface)' : 'var(--dfg-color-primary)'}
                stroke="var(--dfg-color-primary)"
                strokeWidth="2"
                data-df-market="radar-dot"
                data-df-dim={dim?.key ?? ''}
                data-df-signal={noSignal ? 'none' : 'present'}
              />
            );
          })}
        </svg>

        <div className="dfg-market__stack dfg-market__stack--gap-2 dfg-market__stack--menu-min">
          {dims.map((dim) => (
            <div
              key={dim.key}
              className="dfg-market__dim-row"
              data-df-market="dim-row"
              data-df-dim={dim.key}
            >
              <span>{t(dim.labelKey)}</span>
              <span className="dfg-market__meter-track">
                <span
                  className={meterFillClassName(
                    dim.value >= 0.6 ? 'primary' : dim.value >= 0.3 ? 'warn' : 'danger',
                  )}
                  // 填充宽度由数据给百分比（动态值豁免——工单 06 登记表）
                  style={{ width: `${String(Math.round(dim.value * 100))}%` }}
                />
              </span>
              <span className="dfg-market__score">
                {dim.hasSignal ? dim.value.toFixed(2) : t('market.dim.noSignal')}
              </span>
            </div>
          ))}
        </div>
      </div>

      <h3 className="dfg-market__section-title">{t('market.quality.why')}</h3>
      {groups.length === 0 ? (
        <p className="dfg-market__hint" data-df-market="quality-no-deductions">
          {t('market.quality.noDeductions')}
        </p>
      ) : (
        <ul className="dfg-market__list" data-df-market="deductions">
          {groups.map((group) => (
            <li key={group.dim} className="dfg-market__list-item">
              <span className="dfg-market__hint">{t(group.labelKey)}</span>
              {group.deductions.map((deduction) => {
                const labelKey = deductionLabelKey(deduction.code);
                return (
                  <span key={`${group.dim}-${deduction.code}-${deduction.reason}`}>
                    {labelKey === null
                      ? `${deduction.code} ${deduction.reason}`.trim()
                      : t(labelKey)}
                    {deduction.delta === null
                      ? ''
                      : ` · ${t('market.quality.delta', { delta: deduction.delta.toFixed(2) })}`}
                  </span>
                );
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
