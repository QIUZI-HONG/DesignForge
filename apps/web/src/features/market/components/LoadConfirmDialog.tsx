'use client';

/**
 * LoadConfirmDialog —— 装载确认与权限清单（D4；规格 §7.3 + v1.1 §4.5.4）。
 *
 * 三段式（状态机在有测试的 `load-token.ts`，本组件只发事件）：
 * 1. **dryRun 预览**：装载位置、license 档位与署名要求、能力清单逐项、需授权清单；
 * 2. **批准**：用户点「批准并签发一次性 token」→ token 摘要与倒计时可见（超时失效）；
 * 3. **写入**：点「确认写入」→ `stageLoadForInstall`（本地闸）→ daemon
 *    `POST /market/install` 真写（票③接线，`install` 注入的装载客户端）→
 *    `completeLoadInstall` 收敛：成功回填 daemon 真值（digest/loadedAt）并交页面记本地账；
 *    失败进入显式错误态（错误码可诊断），daemon 侧 token 已一次性消费——重装须重新出提案。
 *
 * 不可装载（仅看/禁）在按钮层已挡住，本组件仍会走 `openLoadSession` 的第二道闸。
 */

import type { MarketAsset, MarketLoadPlan } from '@dforge/contracts';
import { Button, Modal } from '@dforge/ui';
import { useEffect, useRef, useState } from 'react';

import { t } from '@/i18n';
import { emitTelemetryEvent } from '@/lib/telemetry';
import { badgeClassName } from '../badge-classes';
import { describeLicenseGate } from '../capabilities';
import {
  approveLoadSession,
  completeLoadInstall,
  EMPTY_LOAD_SESSION,
  type LoadRecord,
  type LoadSession,
  loadErrorCopyKey,
  type MarketInstallClient,
  openLoadSession,
  rejectLoadSession,
  remainingTokenMs,
  stageLoadForInstall,
} from '../load-token';
import { CapabilityList } from './CapabilityList';

import '../market.css';

/** 对话框 props（`now` 可注入：测试模拟超时，不依赖真实时钟；`install` 为 daemon 真写客户端）。 */
export interface LoadConfirmDialogProps {
  open: boolean;
  asset: MarketAsset;
  /** daemon 出的装载提案（dryRun 结果；可装载提案随响应携带一次性 ackToken）。 */
  plan: MarketLoadPlan;
  /** 本地已有该资产的装载记录（同名覆盖/更新提示）。 */
  ownedBefore: boolean;
  onOpenChange: (open: boolean) => void;
  /** 写入完成（页面据此写本地记录册并给 Toast）。 */
  onLoaded: (record: LoadRecord) => void;
  /** daemon 真写客户端（票③接线；生产用 `api.makeMarketInstallClient()`，测试注入桩）。 */
  install: MarketInstallClient;
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
  install,
  now,
  tokenTtlMs,
}: LoadConfirmDialogProps) {
  const clock = now ?? ((): number => Date.now());
  const [session, setSession] = useState<LoadSession>(EMPTY_LOAD_SESSION);
  const [tick, setTick] = useState(0);
  // 卸载后不再回写状态（真写在途时用户可能已关闭对话框）
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 打开时重建会话：提案 → 预览。plan 由页面在每次打开时重新拉取（见 page.tsx 的
  // onLoadClick——daemon ackToken 一次性，重开不复用旧 plan/旧 token），本组件收到
  // 新 plan 对象即重建新会话。
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

  // 已批准态：秒级刷新剩余有效期（到期时刻锚定 daemon 的 plan.ackExpiresAt——批准不续期；
  // 超时后按钮点击即得显式失效提示）
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

  // 写入（票③）：本地闸（一次性/时效）→ daemon 真写 → 收敛（成功回填真值 / 失败显式错误态）
  const commit = (): void => {
    const staged = stageLoadForInstall(session, clock());
    setSession(staged.session);
    if (!staged.ok) {
      // 装载尝试事件（票②）：闸门即失败（超时/重复/未授权）也如实记一次尝试——
      // 「确认写入」被点了就是尝试，结果只有成功/显式失败两态。fire-and-forget。
      emitTelemetryEvent('market.load-attempt', {
        assetId: asset.id,
        result: 'failed',
        code: staged.code,
      });
      return;
    }
    const stagedPlan = staged.session.plan;
    if (stagedPlan === null) return;
    void install({
      assetId: stagedPlan.assetId,
      ackToken: stagedPlan.ackToken ?? '',
    }).then((outcome) => {
      if (!mountedRef.current) return;
      const done = completeLoadInstall(staged.session, outcome);
      setSession(done.session);
      // 装载尝试事件（票② · 论文数据源预埋；票③合入后以 daemon 真写结果为准）：
      // 结果只有成功/显式失败两态——失败带原因码。fire-and-forget，失败静默。
      emitTelemetryEvent('market.load-attempt', {
        assetId: asset.id,
        result: done.ok ? 'success' : 'failed',
        ...(done.ok ? {} : { code: done.code }),
      });
      if (done.ok && done.record !== undefined) {
        onLoaded(done.record);
      }
    });
  };

  const cancel = (): void => {
    setSession(rejectLoadSession(session));
    onOpenChange(false);
  };

  const terminal = session.status === 'consumed' || session.status === 'failed';
  // 装载中禁关（评审 F6）：daemon 真写在途，中途关闭会造成「token 已消费、本地无账」的
  // 悬空态——遮罩/Esc/关闭按钮全部失效，取消按钮一并隐藏（完成或失败后恢复出口）。
  const loading = session.status === 'loading';

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('market.load.title', { name: asset.displayName['zh-CN'] ?? asset.name })}
      description={t('market.load.desc')}
      size="lg"
      closeLabel={t('market.load.close')}
      disableClose={loading}
      footer={
        <>
          {loading ? null : (
            <Button
              variant={terminal ? 'primary' : 'secondary'}
              onClick={
                terminal
                  ? () => {
                      onOpenChange(false);
                    }
                  : cancel
              }
            >
              {terminal ? t('market.load.done') : t('market.load.cancel')}
            </Button>
          )}
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
        className="dfg-market__stack dfg-market__stack--gap-3"
        data-df-market="load-confirm"
        data-df-status={session.status}
      >
        {session.errorCode === null ? null : (
          <p
            className={badgeClassName('danger')}
            role="alert"
            data-df-market="load-error"
            data-df-error-code={session.installErrorCode ?? session.errorCode}
          >
            {/* code 占位恒有值：daemon 原码优先，本地码兜底——installFailed 族文案
                缺 {code} 变量会直接抛 intl 异常（渲染期白屏），本地码也如实可引用 */}
            {t(loadErrorCopyKey(session.errorCode), {
              code: session.installErrorCode ?? session.errorCode,
            })}
          </p>
        )}

        {session.status === 'loading' ? (
          <p
            className={badgeClassName('neutral')}
            role="status"
            data-df-market="load-installing"
            data-df-loading="load-install"
          >
            {t('market.load.installing')}
          </p>
        ) : null}

        <dl className="dfg-market__kv-table">
          <dt className="dfg-market__kv-key">{t('market.load.targetPath')}</dt>
          <dd className="dfg-market__kv-value" data-df-market="load-target">
            {plan.targetPathHint ?? t('market.load.targetPathUnknown')}
          </dd>
          <dt className="dfg-market__kv-key">{t('market.load.license')}</dt>
          <dd className="dfg-market__kv-value" data-df-market="load-license">
            {t('market.load.licenseDetail', {
              tier: t(describeLicenseGate(asset.source.license.gate).labelKey),
              spdx: asset.source.license.spdx ?? t('market.load.spdxUnknown'),
              path: asset.source.license.evidence.path,
              sha: asset.source.license.evidence.sha256.slice(0, 12),
            })}
          </dd>
          <dt className="dfg-market__kv-key">{t('market.load.attribution')}</dt>
          <dd className="dfg-market__kv-value">
            {t('market.load.attributionValue', { repo: asset.source.repo })}
          </dd>
        </dl>

        <h3 className="dfg-market__heading-reset">{t('market.cap.list.title')}</h3>
        <CapabilityList capabilities={asset.capabilities} ackRequired={plan.ackRequired} />

        {ownedBefore ? (
          <p className={badgeClassName('warn')} data-df-market="load-overwrite">
            {t('market.load.overwriteNotice')}
          </p>
        ) : null}

        <ul className="dfg-market__list">
          <li className="dfg-market__list-item">
            <span className="dfg-market__hint">{t('market.load.dryRun')}</span>
            <span>{plan.notice}</span>
            {plan.reasons.length === 0 ? null : <span>{plan.reasons.join('；')}</span>}
          </li>
        </ul>

        {session.status === 'consumed' ? (
          <p className={badgeClassName('ok')} role="status" data-df-market="load-done">
            {t('market.load.loadedDone')}
          </p>
        ) : null}

        {session.status === 'approved' ? (
          <p
            className={badgeClassName(expired ? 'danger' : 'ok')}
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

        <p className="dfg-market__hint" data-df-market="load-audit-hint">
          {t('market.load.auditHint')}
        </p>
        <span hidden data-df-tick={tick} />
      </div>
    </Modal>
  );
}
