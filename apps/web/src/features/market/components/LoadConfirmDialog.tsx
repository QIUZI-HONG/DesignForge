'use client';

/**
 * LoadConfirmDialog —— 装载确认与权限清单（D4；规格 §7.3 + v1.1 §4.5.4）。
 *
 * 三段式（状态机在有测试的 `load-token.ts`，本组件只发事件）：
 * 1. **dryRun 预览**：装载位置、license 档位与署名要求、能力清单逐项、需授权清单；
 * 2. **批准**：用户点「批准并签发一次性 token」→ token 摘要与倒计时可见（超时失效）；
 * 3. **写入**：点「确认写入」消费 token（一次性；重复点击与超时都是显式错误提示）；
 *    成功后产出审计记录交给页面写本地记录册。
 *
 * 不可装载（仅看/禁）在按钮层已挡住，本组件仍会走 `openLoadSession` 的第二道闸。
 */

import type { MarketAsset, MarketLoadPlan } from '@dforge/contracts';
import { Button, Modal } from '@dforge/ui';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';

import { describeLicenseGate } from '../capabilities';
import {
  approveLoadSession,
  consumeLoadSession,
  EMPTY_LOAD_SESSION,
  type LoadRecord,
  type LoadSession,
  openLoadSession,
  rejectLoadSession,
  remainingTokenMs,
} from '../load-token';
import {
  badgeStyle,
  hintStyle,
  kvKeyStyle,
  kvTableStyle,
  kvValueStyle,
  listItemStyle,
  listStyle,
} from '../styles';
import { CapabilityList } from './CapabilityList';

/** 对话框 props（`now` 可注入：测试模拟超时，不依赖真实时钟）。 */
export interface LoadConfirmDialogProps {
  open: boolean;
  asset: MarketAsset;
  /** daemon 出的装载提案（dryRun 结果）。 */
  plan: MarketLoadPlan;
  /** 本地已有该资产的装载记录（同名覆盖/更新提示）。 */
  ownedBefore: boolean;
  onOpenChange: (open: boolean) => void;
  /** 写入完成（页面据此写本地记录册并给 Toast）。 */
  onLoaded: (record: LoadRecord) => void;
  now?: () => number;
  tokenTtlMs?: number;
}

/** 装载确认对话框。 */
export function LoadConfirmDialog({
  open,
  asset,
  plan,
  ownedBefore,
  onOpenChange,
  onLoaded,
  now,
  tokenTtlMs,
}: LoadConfirmDialogProps) {
  const clock = now ?? ((): number => Date.now());
  const [session, setSession] = useState<LoadSession>(EMPTY_LOAD_SESSION);
  const [tick, setTick] = useState(0);

  // 打开时重建会话：提案 → 预览（第二次打开不复用旧 token）
  useEffect(() => {
    if (!open) return;
    const opened = openLoadSession(plan, {
      name: asset.name,
      kind: asset.kind,
      digest: asset.digest,
      ref: asset.source.ref,
    });
    setSession(opened.session);
    setTick((value) => value + 1);
  }, [open, plan, asset.name, asset.kind, asset.digest, asset.source.ref]);

  // 已批准态：秒级刷新剩余有效期（超时后按钮点击即得显式失效提示）
  useEffect(() => {
    if (!open || session.status !== 'approved') return;
    const timer = setInterval(() => {
      setTick((value) => value + 1);
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [open, session.status]);

  const nowMs = clock();
  const remainingMs = remainingTokenMs(session, nowMs);
  const expired = session.status === 'approved' && remainingMs === 0;

  const approve = (): void => {
    const approved = approveLoadSession(session, clock(), {
      ...(tokenTtlMs === undefined ? {} : { ttlMs: tokenTtlMs }),
    });
    setSession(approved.session);
  };

  const commit = (): void => {
    const consumed = consumeLoadSession(session, clock());
    setSession(consumed.session);
    if (consumed.ok && consumed.record !== undefined) {
      onLoaded(consumed.record);
    }
  };

  const cancel = (): void => {
    setSession(rejectLoadSession(session));
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('market.load.title', { name: asset.displayName['zh-CN'] ?? asset.name })}
      description={t('market.load.desc')}
      size="lg"
      closeLabel={t('market.load.close')}
      footer={
        <>
          <Button
            variant={session.status === 'consumed' ? 'primary' : 'secondary'}
            onClick={
              session.status === 'consumed'
                ? () => {
                    onOpenChange(false);
                  }
                : cancel
            }
          >
            {session.status === 'consumed' ? t('market.load.done') : t('market.load.cancel')}
          </Button>
          {session.status === 'preview' ? (
            <Button variant="primary" onClick={approve} data-df-market="approve-load">
              {t('market.load.approve')}
            </Button>
          ) : null}
          {session.status === 'approved' || session.status === 'expired' ? (
            <Button
              variant="primary"
              onClick={commit}
              data-df-market="commit-load"
              data-df-state={expired ? 'disabled' : 'enabled'}
            >
              {t('market.load.commit')}
            </Button>
          ) : null}
        </>
      }
    >
      <div
        style={{ display: 'grid', gap: 'var(--dfg-space-3)' }}
        data-df-market="load-confirm"
        data-df-status={session.status}
      >
        {session.errorCode === null ? null : (
          <p style={badgeStyle('danger')} role="alert" data-df-market="load-error">
            {t(
              session.errorCode === 'load_token_expired'
                ? 'market.load.tokenExpired'
                : session.errorCode === 'load_token_used'
                  ? 'market.load.tokenUsed'
                  : session.errorCode === 'load_already_approved'
                    ? 'market.load.alreadyApproved'
                    : 'market.load.notLoadable',
            )}
          </p>
        )}

        <dl style={kvTableStyle}>
          <dt style={kvKeyStyle}>{t('market.load.targetPath')}</dt>
          <dd style={kvValueStyle} data-df-market="load-target">
            {plan.targetPathHint ?? t('market.load.targetPathUnknown')}
          </dd>
          <dt style={kvKeyStyle}>{t('market.load.license')}</dt>
          <dd style={kvValueStyle} data-df-market="load-license">
            {t('market.load.licenseDetail', {
              tier: t(describeLicenseGate(asset.source.license.gate).labelKey),
              spdx: asset.source.license.spdx ?? t('market.load.spdxUnknown'),
              path: asset.source.license.evidence.path,
              sha: asset.source.license.evidence.sha256.slice(0, 12),
            })}
          </dd>
          <dt style={kvKeyStyle}>{t('market.load.attribution')}</dt>
          <dd style={kvValueStyle}>
            {t('market.load.attributionValue', { repo: asset.source.repo })}
          </dd>
        </dl>

        <h3 style={{ margin: '0' }}>{t('market.cap.list.title')}</h3>
        <CapabilityList capabilities={asset.capabilities} ackRequired={plan.ackRequired} />

        {ownedBefore ? (
          <p style={badgeStyle('warn')} data-df-market="load-overwrite">
            {t('market.load.overwriteNotice')}
          </p>
        ) : null}

        <ul style={listStyle}>
          <li style={listItemStyle}>
            <span style={hintStyle}>{t('market.load.dryRun')}</span>
            <span>{plan.notice}</span>
            {plan.reasons.length === 0 ? null : <span>{plan.reasons.join('；')}</span>}
          </li>
        </ul>

        {session.status === 'consumed' ? (
          <p style={badgeStyle('ok')} role="status" data-df-market="load-done">
            {t('market.load.loadedDone')}
          </p>
        ) : null}

        {session.status === 'approved' ? (
          <p
            style={badgeStyle(expired ? 'danger' : 'ok')}
            role="status"
            data-df-market="load-token"
          >
            {expired
              ? t('market.load.tokenExpired')
              : t('market.load.tokenIssued', {
                  tokenId: session.token?.tokenId.slice(0, 8) ?? '',
                  seconds: Math.ceil(remainingMs / 1000),
                })}
          </p>
        ) : null}

        <p style={hintStyle} data-df-market="load-audit-hint">
          {t('market.load.auditHint')}
        </p>
        <span hidden data-df-tick={tick} />
      </div>
    </Modal>
  );
}
