'use client';

/**
 * MCP 确认条（F9 · **桩**）——逐项 diff 审批 + 一次性 ack + 超时失效态。
 *
 * 口径（清单 F9 + 架构 v1.1 §4.5.4 + 契约 mcp）：
 * - 三段式：dryRun 提案（带逐项 diff）→ 一次性 ackToken（批准/拒绝）→ 审计留痕；
 * - **一次性**：确认动作发出即消费 token——按钮随即消失，重复提交是 no-op；
 * - **超时失效**：按 `expiresAt` 倒计时，越过即「已失效（超时未确认）」且不可再确认；
 * - **桩必须显式标注**：角标「桩」（`data-df-stub="true"` 是门禁挂点），
 *   结果区再补一句「未产生真实写入」——UI 与证据口径一致（达标语义要求）。
 */
import type { McpProposalResponse } from '@dforge/contracts';
import { Button, Spinner, Tooltip } from '@dforge/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { t } from '@/i18n';

import { createMcpPort, DaemonRequestError, type McpPort } from '../client';
import {
  beginAck,
  createConfirmation,
  isSettled,
  type McpConfirmationState,
  settleAck,
  settleAckError,
  tick,
} from '../confirm';

import './mcp.css';

/** McpConfirmBar props。 */
export interface McpConfirmBarProps {
  /** dryRun 提案（来自 `POST /mcp/proposals`；`stub: true` 是桩的声明）。 */
  proposal: McpProposalResponse;
  /** 端口（测试/门禁注入假实现；缺省真 daemon）。 */
  port?: McpPort;
  /** 时钟（测试注入；缺省 `Date.now`）。 */
  now?: () => number;
  onSettled?: (state: McpConfirmationState) => void;
}

/** 毫秒 → `M:SS`（倒计时展示）。 */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

/** 异常 → {code, message}（daemon 失败信封或兜底）。 */
function errorInfo(error: unknown): { code: string; message: string } {
  if (error instanceof DaemonRequestError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: 'internal', message: error.message };
  return { code: 'internal', message: '确认请求失败' };
}

/** 写操作确认条。 */
export function McpConfirmBar(props: McpConfirmBarProps) {
  const { proposal, port: injectedPort, now: injectedNow, onSettled } = props;
  const port = useMemo(() => injectedPort ?? createMcpPort(), [injectedPort]);
  const now = useMemo(() => injectedNow ?? (() => Date.now()), [injectedNow]);

  const [state, setState] = useState<McpConfirmationState>(() =>
    createConfirmation(proposal, now()),
  );
  const [nowMs, setNowMs] = useState(() => now());
  const [expanded, setExpanded] = useState(false);
  const settledNotified = useRef(false);

  // 提案换新（重新发起 dryRun）即重置确认状态
  useEffect(() => {
    setState(createConfirmation(proposal, now()));
    setNowMs(now());
    setExpanded(false);
    settledNotified.current = false;
  }, [proposal, now]);

  // 倒计时：每秒走表（超时失效由纯函数 tick 判定）
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [now]);

  const view = tick(state, nowMs);

  useEffect(() => {
    if (isSettled(view) && !settledNotified.current) {
      settledNotified.current = true;
      onSettled?.(view);
    }
  }, [view, onSettled]);

  const ack = useCallback(
    (approve: boolean) => {
      const submitting = beginAck(view, now());
      if (submitting.phase !== 'submitting') return; // 已失效 / 已决策：一次性 token 不再接受确认
      setState(submitting);
      port
        .ack({ ackToken: proposal.ackToken, approve })
        .then((response) => {
          setState((current) => settleAck(current, response));
        })
        .catch((error: unknown) => {
          setState((current) => settleAckError(current, errorInfo(error)));
        });
    },
    [now, port, proposal.ackToken, view],
  );

  const remaining = Math.max(0, Date.parse(proposal.expiresAt) - nowMs);
  const canAct = view.phase === 'pending';
  const diffCount = proposal.diff.ops.length;

  return (
    <section aria-label={t('mcp.title')} className="dfg-mcp__bar" data-df-mcp-confirm={view.phase}>
      <div className="dfg-mcp__header">
        <span className="dfg-mcp__title">
          {t('mcp.proposal', { id: proposal.proposalId })}·{t('mcp.tool')}{' '}
          <span className="dfg-mcp__tool">{proposal.tool}</span>
        </span>
        <span className="dfg-mcp__spacer" />
        {/* 桩的显式标注（角标 + 悬停说明）：门禁断言 data-df-stub 挂点 */}
        <Tooltip content={t('mcp.stub.desc')}>
          <span data-df-stub="true" title={t('mcp.stub.desc')} className="dfg-mcp__stub-badge">
            {t('mcp.stub')}
          </span>
        </Tooltip>
      </div>

      <div className="dfg-mcp__meta">
        <span className="dfg-mcp__meta-item">
          <span>{t('mcp.caller')}：</span>
          <span>{t(`mcp.caller.${proposal.caller}`)}</span>
        </span>
        <span className="dfg-mcp__meta-item">{t('mcp.audit', { id: proposal.auditId })}</span>
      </div>

      <div>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t('mcp.diff.collapse') : t('mcp.diff.expand', { count: diffCount })}
        </Button>
        {expanded ? (
          <ul className="dfg-mcp__diff-list" aria-label={t('mcp.title')}>
            {proposal.diff.ops.map((op, index) => (
              <li key={`${op.op}-${String(index)}`} className="dfg-mcp__diff-row">
                <span className="dfg-mcp__diff-head">
                  <span className="dfg-mcp__diff-op">{op.op}</span>
                  <span className="dfg-mcp__diff-target">
                    {t('mcp.diff.target', { target: op.target })}
                  </span>
                </span>
                <span className="dfg-mcp__diff-summary">{op.summary}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {view.phase === 'expired' ? (
        <div className="dfg-mcp__expired" role="status">
          <strong>{t('mcp.expiry.expired')}</strong>
          <span className="dfg-mcp__stub-note">{t('mcp.error.reissue')}</span>
        </div>
      ) : null}

      {view.phase === 'failed' && view.error !== null ? (
        <div className="dfg-mcp__failure" role="alert">
          <strong>{view.error.message}</strong>
          <span className="dfg-mcp__stub-note">{t('mcp.error.reissue')}</span>
        </div>
      ) : null}

      {view.phase === 'approved' || view.phase === 'rejected' ? (
        <div
          className="dfg-mcp__result"
          role="status"
          data-df-mcp-decision={view.decision ?? ''}
        >
          <strong>
            {view.decision === 'approved' ? t('mcp.result.approved') : t('mcp.result.rejected')}
          </strong>
          <span className="dfg-mcp__stub-note">{t('mcp.result.stubNote')}</span>
        </div>
      ) : null}

      {canAct || view.phase === 'submitting' ? (
        <div className="dfg-mcp__actions">
          <Button
            size="sm"
            variant="primary"
            disabled={!canAct}
            loading={view.phase === 'submitting'}
            loadingLabel={t('mcp.state.submitting')}
            onClick={() => ack(true)}
          >
            {t('mcp.action.approve')}
          </Button>
          <Button size="sm" disabled={!canAct} onClick={() => ack(false)}>
            {t('mcp.action.reject')}
          </Button>
          <span className="dfg-mcp__spacer" />
          {view.phase === 'submitting' ? (
            <Spinner size="sm" />
          ) : (
            <span className="dfg-mcp__countdown">
              {t('mcp.expiry.remaining', { time: formatRemaining(remaining) })}
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}
