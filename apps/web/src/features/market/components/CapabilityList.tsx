'use client';

/**
 * CapabilityList —— 能力清单（D2 详情「能力与安全」区 / D4 装载确认条）。
 *
 * 逐项列能力：人话标签（词表外回落原始 id）+ 授予口径 + 风险标记；词表外的能力按
 * 「需显式授权」处理（`describeCapabilities` 保证），`subprocess`/`bash` 与未知能力
 * 标 danger（默认拒绝，红标）。清单不折叠、不静默——装载前必须看得见。
 */

import { t } from '@/i18n';

import { type CapabilityRisk, describeCapabilities } from '../capabilities';
import { badgeClassName } from '../badge-classes';

import '../market.css';

/** 风险档 → 徽标色调。 */
const RISK_TONE: Record<CapabilityRisk, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  granted: 'ok',
  scoped: 'neutral',
  declared: 'warn',
  denied: 'danger',
  unknown: 'danger',
};

/** 风险档 → i18n 键。 */
const RISK_LABEL_KEYS: Record<CapabilityRisk, string> = {
  granted: 'market.cap.risk.granted',
  scoped: 'market.cap.risk.scoped',
  declared: 'market.cap.risk.declared',
  denied: 'market.cap.risk.denied',
  unknown: 'market.cap.risk.unknown',
};

/** 能力清单（`ackRequired` 给出时与词表判定取并集，保证不漏授权项）。 */
export function CapabilityList({
  capabilities,
  ackRequired,
}: {
  capabilities: readonly string[];
  ackRequired?: readonly string[];
}) {
  const { items, ackList } = describeCapabilities(capabilities, ackRequired ?? []);
  if (items.length === 0) {
    return (
      <p className="dfg-market__hint" data-df-market="capability-empty">
        {t('market.cap.empty')}
      </p>
    );
  }
  return (
    <div data-df-market="capability-list">
      <ul className="dfg-market__list">
        {items.map((item) => (
          <li
            key={item.id}
            className="dfg-market__list-item"
            data-df-market="capability-item"
            data-df-cap={item.id}
          >
            <span className="dfg-market__cap-row">
              <strong>{item.labelKey === null ? item.id : t(item.labelKey)}</strong>
              <span
                className={badgeClassName(RISK_TONE[item.risk])}
                data-df-market="capability-risk"
              >
                {t(RISK_LABEL_KEYS[item.risk])}
              </span>
              {item.ackRequired ? (
                <span className={badgeClassName('danger')} data-df-market="capability-ack">
                  {t('market.cap.ackBadge')}
                </span>
              ) : null}
            </span>
            <span className="dfg-market__hint">
              {item.labelKey === null ? `${item.id} · ${t(item.scopeKey)}` : t(item.scopeKey)}
            </span>
          </li>
        ))}
      </ul>
      {ackList.length === 0 ? null : (
        <p className="dfg-market__hint" data-df-market="capability-ack-list">
          {t('market.cap.ackList', { list: ackList.join('、') })}
        </p>
      )}
    </div>
  );
}
