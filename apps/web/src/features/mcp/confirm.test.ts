/**
 * MCP 确认状态机测试（seam：纯状态转移——折叠/失效/一次性 ack 的对外可见状态）。
 *
 * 口径（清单 F9 + 契约 mcp）：dryRun 提案 → 一次性 ackToken（超时失效）→ 审计决策。
 * 「一次性」的语义：**确认动作一发出即视为消费**——不得二次确认、不得重复提交。
 */

import type { McpProposalResponse } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';

import {
  beginAck,
  cancelAck,
  createConfirmation,
  isAckable,
  type McpConfirmationState,
  remainingMs,
  settleAck,
  settleAckError,
  tick,
} from './confirm';

/** 提案夹具（daemon 桩响应形状；TTL 120s）。 */
function proposal(expiresAt = '2026-10-15T00:02:00.000Z'): McpProposalResponse {
  return {
    proposalId: 'prop_1',
    tool: 'df_apply_patch',
    caller: 'mcp:zcode',
    dryRun: true,
    diff: {
      documentId: 'doc-1',
      baseRev: null,
      ops: [
        {
          op: 'df_apply_patch',
          target: 'doc-1',
          summary: '桩实现：真实 diff 由 P5 网关按 Design IR 生成',
        },
      ],
      beforeHash: null,
      afterHash: null,
    },
    ackToken: 'token-abc',
    expiresAt,
    auditId: 'audit_1',
    stub: true,
  };
}

const T0 = Date.parse('2026-10-15T00:00:00.000Z');

describe('MCP 确认状态机', () => {
  it('初始：pending、可确认、剩余时效按 expiresAt 计算', () => {
    const state = createConfirmation(proposal(), T0);
    expect(state.phase).toBe('pending');
    expect(isAckable(state)).toBe(true);
    expect(remainingMs(state, T0)).toBe(120_000);
    // 桩标记来自提案本身（UI 与证据都必须显式标注）
    expect(state.proposal.stub).toBe(true);
  });

  it('超时失效：tick 越过 expiresAt 即转 expired，且不可再确认', () => {
    const state = createConfirmation(proposal(), T0);
    const before = tick(state, T0 + 119_000);
    expect(before.phase).toBe('pending');
    expect(remainingMs(before, T0 + 119_000)).toBe(1000);

    const expired = tick(state, T0 + 120_001);
    expect(expired.phase).toBe('expired');
    expect(isAckable(expired)).toBe(false);
    expect(beginAck(expired, T0 + 120_001)).toBe(expired);
  });

  it('一次性 ack：确认动作发出即消费 token，二次提交是 no-op', () => {
    const pending = createConfirmation(proposal(), T0);
    const submitting = beginAck(pending, T0 + 1000);
    expect(submitting.phase).toBe('submitting');
    expect(isAckable(submitting)).toBe(false);
    expect(beginAck(submitting, T0 + 2000)).toBe(submitting);

    const settled = settleAck(submitting, {
      proposalId: 'prop_1',
      applied: false,
      decision: 'approved',
      auditId: 'audit_1',
      note: '桩实现：已确认，真实写入由 P5 网关执行（本段不改动文档）',
    });
    expect(settled.phase).toBe('approved');
    expect(settled.decision).toBe('approved');
    // 已决策后连「取消/二次确认」都不再可能
    expect(isAckable(settled)).toBe(false);
    expect(beginAck(settled, T0 + 3000)).toBe(settled);
  });

  it('拒绝是正常决策（rejected），不是错误态', () => {
    const submitting = beginAck(createConfirmation(proposal(), T0), T0);
    const settled = settleAck(submitting, {
      proposalId: 'prop_1',
      applied: false,
      decision: 'rejected',
      auditId: 'audit_1',
      note: '用户拒绝该提案，未产生任何写入',
    });
    expect(settled.phase).toBe('rejected');
    expect(settled.decision).toBe('rejected');
  });

  it('ack 失败：过期 → expired；无效/重放 → failed 且保留错误码（需重新发起）', () => {
    const submitting = beginAck(createConfirmation(proposal(), T0), T0);
    const expired = settleAckError(submitting, {
      code: 'mcp_ack_expired',
      message: 'ackToken 已过期',
    });
    expect(expired.phase).toBe('expired');

    const replay = settleAckError(submitting, {
      code: 'mcp_ack_invalid',
      message: 'ackToken 无效或已被使用',
    });
    expect(replay.phase).toBe('failed');
    expect(replay.error?.code).toBe('mcp_ack_invalid');
    expect(isAckable(replay)).toBe(false);
  });

  it('提交中放弃（网络中止）：cancelAck 回到 pending，token 仍未被消费（未发出即未消费）', () => {
    const submitting = beginAck(createConfirmation(proposal(), T0), T0);
    const back = cancelAck(submitting);
    expect(back.phase).toBe('pending');
    expect(isAckable(back)).toBe(true);
  });

  it('diff 展开状态在状态里可测（逐项 diff 审批的展示单位）', () => {
    const state: McpConfirmationState = createConfirmation(proposal(), T0);
    expect(state.proposal.diff.ops).toHaveLength(1);
    expect(state.proposal.diff.ops[0]?.op).toBe('df_apply_patch');
  });
});
