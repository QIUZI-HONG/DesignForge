/**
 * MCP 确认条测试装配（本票自管）。
 *
 * - RTL 自动清理；
 * - 提案夹具：daemon 桩响应形状（含 `stub: true` 与逐项 diff）；
 * - 假端口：propose/ack/audit 可编程序列（ack 失败注入）。
 */
import type { McpAckResponse, McpProposalResponse } from '@dforge/contracts';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import type { McpPort } from './client';

afterEach(() => {
  cleanup();
});

/** 基准时刻。 */
export const T0 = Date.parse('2026-10-15T00:00:00.000Z');

/** 提案夹具（TTL 120s，桩标记显式）。 */
export function proposalFixture(overrides: Partial<McpProposalResponse> = {}): McpProposalResponse {
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
    expiresAt: new Date(T0 + 120_000).toISOString(),
    auditId: 'audit_1',
    stub: true,
    ...overrides,
  };
}

/** ack 成功响应夹具。 */
export function ackApproved(): McpAckResponse {
  return {
    proposalId: 'prop_1',
    applied: false,
    decision: 'approved',
    auditId: 'audit_1',
    note: '桩实现：已确认，真实写入由 P5 网关执行（本段不改动文档）',
  };
}

/** 假端口。 */
export interface FakeMcpPort extends McpPort {
  readonly ackCalls: { ackToken: string; approve: boolean }[];
}

/** 构建假端口；`ackError` 给出时 ack 抛错（重放/过期等）。 */
export function fakeMcpPort(
  options: { ackResult?: McpAckResponse; ackError?: Error } = {},
): FakeMcpPort {
  const ackCalls: { ackToken: string; approve: boolean }[] = [];
  const port: FakeMcpPort = {
    get ackCalls() {
      return ackCalls;
    },
    async propose() {
      return await Promise.resolve(proposalFixture());
    },
    async ack(request) {
      ackCalls.push({ ackToken: request.ackToken, approve: request.approve });
      if (options.ackError !== undefined) throw options.ackError;
      return await Promise.resolve(options.ackResult ?? ackApproved());
    },
    async audit() {
      return await Promise.resolve({ records: [] });
    },
  };
  return port;
}
