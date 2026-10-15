/**
 * @dforge/daemon · MCP 确认桩（dryRun → 一次性 ackToken → 审计，架构 v1.1 §4.5.4）。
 *
 * 本段为**桩**（真实网关/写事务归 P5）：不真正改动文档，但严格执行三段式纪律——
 * 1. 提案：登记 diff 摘要 + 签发一次性短时效 token + 审计落 `decision: 'pending'`；
 * 2. 确认：token 一次性消费（重复使用/超时均为显式错误态），审计追加最终决策；
 * 3. 审计：JSONL 追加（调用方/工具/参数摘要哈希/决策），**token 本身只存哈希**。
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type {
  McpAckResponse,
  McpAuditRecord,
  McpCaller,
  McpDiffSummary,
  McpProposalResponse,
} from '@dforge/contracts';
import { MCP_ACK_TTL_MS } from '@dforge/contracts';

import { appendJsonLine } from '../fs-atomic.ts';

/** MCP 确认桩接口。 */
export interface McpStub {
  /** 登记提案（dryRun），返回一次性 token 与审计 id。 */
  propose(input: {
    tool: string;
    args: Record<string, unknown>;
    caller: McpCaller;
    documentId: string | null;
  }): Promise<McpProposalResponse>;
  /** 消费 token（一次性）：批准/拒绝；未知/过期 token 返回显式原因。 */
  ack(input: {
    ackToken: string;
    approve: boolean;
  }): Promise<
    | { ok: true; response: McpAckResponse }
    | { ok: false; code: 'mcp_ack_invalid' | 'mcp_ack_expired'; message: string }
  >;
  /** 审计记录（最新在前）。 */
  audit(limit?: number): Promise<McpAuditRecord[]>;
}

interface PendingProposal {
  proposalId: string;
  tool: string;
  caller: McpCaller;
  argsDigest: string;
  auditId: string;
  expiresAtMs: number;
  consumed: boolean;
  documentId: string | null;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** token 只存哈希（审计可核对、泄露不可回放）。 */
function tokenHash(token: string): string {
  return `sha256:${sha256(token)}`;
}

/** 创建 MCP 确认桩（auditPath 为注入点；提案登记在内存——桩不做崩溃恢复）。 */
export function createMcpStub(options: { auditPath: string }): McpStub {
  const pending = new Map<string, PendingProposal>();

  const appendAudit = async (record: McpAuditRecord): Promise<void> => {
    await appendJsonLine(options.auditPath, record, 0o600);
  };

  return {
    async propose(input: {
      tool: string;
      args: Record<string, unknown>;
      caller: McpCaller;
      documentId: string | null;
    }): Promise<McpProposalResponse> {
      const nowMs = Date.now();
      const proposalId = `prop_${randomBytes(6).toString('hex')}`;
      const ackToken = randomBytes(24).toString('hex');
      const argsDigest = tokenHash(JSON.stringify(input.args));
      const auditId = `audit_${randomBytes(6).toString('hex')}`;
      const expiresAt = new Date(nowMs + MCP_ACK_TTL_MS).toISOString();

      const diff: McpDiffSummary = {
        documentId: input.documentId,
        baseRev: null,
        ops: [
          {
            op: input.tool,
            target: input.documentId ?? '（未指定文档）',
            summary: '桩实现：真实 diff 由 P5 网关按 Design IR 生成',
          },
        ],
        beforeHash: null,
        afterHash: null,
      };

      pending.set(ackToken, {
        proposalId,
        tool: input.tool,
        caller: input.caller,
        argsDigest,
        auditId,
        expiresAtMs: nowMs + MCP_ACK_TTL_MS,
        consumed: false,
        documentId: input.documentId,
      });

      await appendAudit({
        auditId,
        at: new Date(nowMs).toISOString(),
        caller: input.caller,
        tool: input.tool,
        proposalId,
        argsDigest,
        decision: 'pending',
        applied: false,
        note: 'dryRun 提案（桩）；ackToken 已签发（仅哈希可审计）',
      });

      return {
        proposalId,
        tool: input.tool,
        caller: input.caller,
        dryRun: true,
        diff,
        ackToken,
        expiresAt,
        auditId,
        stub: true,
      };
    },

    async ack(input: { ackToken: string; approve: boolean }) {
      const proposal = pending.get(input.ackToken);
      if (proposal === undefined || proposal.consumed) {
        return {
          ok: false as const,
          code: 'mcp_ack_invalid' as const,
          message: 'ackToken 无效或已被使用（一次性 token 不可复用）',
        };
      }
      if (Date.now() > proposal.expiresAtMs) {
        proposal.consumed = true;
        await appendAudit({
          auditId: proposal.auditId,
          at: new Date().toISOString(),
          caller: proposal.caller,
          tool: proposal.tool,
          proposalId: proposal.proposalId,
          argsDigest: proposal.argsDigest,
          decision: 'expired',
          applied: false,
          note: 'ackToken 超时未确认，已失效',
        });
        return {
          ok: false as const,
          code: 'mcp_ack_expired' as const,
          message: 'ackToken 已过期（短时效，需重新发起 dryRun）',
        };
      }

      proposal.consumed = true;
      const decision = input.approve ? ('approved' as const) : ('rejected' as const);
      const note = input.approve
        ? '桩实现：已确认，真实写入由 P5 网关执行（本段不改动文档）'
        : '用户拒绝该提案，未产生任何写入';
      await appendAudit({
        auditId: proposal.auditId,
        at: new Date().toISOString(),
        caller: proposal.caller,
        tool: proposal.tool,
        proposalId: proposal.proposalId,
        argsDigest: proposal.argsDigest,
        decision,
        applied: false,
        note,
      });

      return {
        ok: true as const,
        response: {
          proposalId: proposal.proposalId,
          applied: false,
          decision,
          auditId: proposal.auditId,
          note,
        },
      };
    },

    async audit(limit = 100): Promise<McpAuditRecord[]> {
      let raw: string;
      try {
        raw = await readFile(options.auditPath, 'utf8');
      } catch {
        return [];
      }
      const records: McpAuditRecord[] = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (typeof parsed === 'object' && parsed !== null) records.push(parsed as McpAuditRecord);
        } catch {
          // 单行损坏跳过
        }
      }
      return records.slice(-Math.min(Math.max(1, limit), 1000)).reverse();
    },
  };
}
