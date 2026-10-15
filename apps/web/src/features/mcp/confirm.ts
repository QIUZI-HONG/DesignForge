/**
 * FE-10 · MCP 确认状态机（纯逻辑，零 React）。
 *
 * 口径（清单 F9 + 架构 v1.1 §4.5.4 + 契约 mcp）：
 * - 写路径三段式：**dryRun 提案 → 一次性 ackToken → 审计**；
 * - ackToken **短时效**（daemon 侧 `MCP_ACK_TTL_MS`），UI 用 `expiresAt` 倒计时，
 *   越过即转「已失效」且不可再确认（超时失效态是必验状态）；
 * - **一次性**：确认动作一发出即视为消费——重复提交与二次确认都是 no-op；
 * - 本段是**桩**：提案带 `stub: true`，UI 与证据都必须显式标注（达标语义要求）。
 */
import type { McpAckResponse, McpProposalResponse } from '@dforge/contracts';

/** 确认阶段。 */
export type McpConfirmationPhase =
  | 'pending'
  | 'submitting'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'failed';

/** 确认状态。 */
export interface McpConfirmationState {
  proposal: McpProposalResponse;
  phase: McpConfirmationPhase;
  decision: 'approved' | 'rejected' | null;
  /** ack 响应（决策后给出；桩的 note 里写明「不改动文档」）。 */
  result: McpAckResponse | null;
  /** 失败信息（如 mcp_ack_invalid：token 已被消费/无效——需重新发起 dryRun）。 */
  error: { code: string; message: string } | null;
}

/** 初始态：登记提案（pending）。 */
export function createConfirmation(
  proposal: McpProposalResponse,
  _nowMs: number,
): McpConfirmationState {
  return { proposal, phase: 'pending', decision: null, result: null, error: null };
}

/** 剩余时效（毫秒，可为负；UI 显示前先 clamp 到 0）。 */
export function remainingMs(state: McpConfirmationState, nowMs: number): number {
  const expiresAtMs = Date.parse(state.proposal.expiresAt);
  if (Number.isNaN(expiresAtMs)) return 0;
  return expiresAtMs - nowMs;
}

/** 是否可以确认（pending 且未过期）。 */
export function isAckable(state: McpConfirmationState): boolean {
  return state.phase === 'pending';
}

/** 走表：越过 expiresAt → expired（幂等；已决策的终态不受影响）。 */
export function tick(state: McpConfirmationState, nowMs: number): McpConfirmationState {
  if (state.phase !== 'pending' && state.phase !== 'submitting') return state;
  if (nowMs <= Date.parse(state.proposal.expiresAt)) return state;
  return { ...state, phase: 'expired' };
}

/** 发起 ack（一次性消费：进入 submitting 后不可再次发起）。 */
export function beginAck(state: McpConfirmationState, _nowMs: number): McpConfirmationState {
  if (!isAckable(state)) return state;
  return { ...state, phase: 'submitting' };
}

/** 提交被中止（网络失败在客户端侧）：回到 pending（请求未发出即未消费）。 */
export function cancelAck(state: McpConfirmationState): McpConfirmationState {
  if (state.phase !== 'submitting') return state;
  return { ...state, phase: 'pending' };
}

/** ack 成功：落决策（approved / rejected）。 */
export function settleAck(
  state: McpConfirmationState,
  response: McpAckResponse,
): McpConfirmationState {
  if (state.phase !== 'submitting') return state;
  return {
    ...state,
    phase: response.decision === 'approved' ? 'approved' : 'rejected',
    decision: response.decision,
    result: response,
    error: null,
  };
}

/** ack 失败：`mcp_ack_expired` → expired；其余（无效/重放）→ failed（需重新发起 dryRun）。 */
export function settleAckError(
  state: McpConfirmationState,
  error: { code: string; message: string },
): McpConfirmationState {
  if (state.phase !== 'submitting' && state.phase !== 'pending') return state;
  if (error.code === 'mcp_ack_expired') {
    return { ...state, phase: 'expired', error };
  }
  return { ...state, phase: 'failed', error };
}

/** 是否已决策（approved / rejected）。 */
export function isSettled(state: McpConfirmationState): boolean {
  return state.phase === 'approved' || state.phase === 'rejected';
}
