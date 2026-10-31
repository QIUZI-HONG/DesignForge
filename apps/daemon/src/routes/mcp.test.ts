import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTestDaemon, injectJson } from '../testing/harness.ts';

async function propose(
  daemon: Awaited<ReturnType<typeof createTestDaemon>>,
  overrides: Record<string, unknown> = {},
) {
  return injectJson(daemon.app, {
    method: 'POST',
    url: '/mcp/proposals',
    payload: {
      tool: 'df_apply_patch',
      caller: 'mcp:zcode',
      documentId: 'demo',
      args: { ops: [{ op: 'set_prop', id: 'rect:7', path: 'fills[0].color', value: '#E0A458' }] },
      ...overrides,
    },
  });
}

describe('mcp · 确认桩（dryRun → 一次性 ackToken → 审计）', () => {
  it('提案：201 + dryRun + ackToken；审计落 pending 且 token 只以哈希入档', async () => {
    const daemon = await createTestDaemon();
    try {
      const { statusCode, payload } = await propose(daemon);
      expect(statusCode).toBe(201);
      const proposal = (
        payload as {
          result: {
            proposalId: string;
            dryRun: boolean;
            ackToken: string;
            expiresAt: string;
            stub: boolean;
            diff: { ops: unknown[] };
          };
        }
      ).result;
      expect(proposal.dryRun).toBe(true);
      expect(proposal.stub).toBe(true);
      expect(proposal.ackToken.length).toBeGreaterThan(20);
      expect(Date.parse(proposal.expiresAt)).toBeGreaterThan(Date.now());

      const auditRaw = await readFile(join(daemon.dataRoot, 'audit', 'mcp-audit.jsonl'), 'utf8');
      expect(auditRaw).toContain('"decision":"pending"');
      // 一次性 token 本体绝不入档（审计只记哈希）
      expect(auditRaw).not.toContain(proposal.ackToken);
      expect(auditRaw).toContain('sha256:');
    } finally {
      await daemon.cleanup();
    }
  });

  it('批准：记录 approved（桩不真实写入）；拒绝记录 rejected', async () => {
    const daemon = await createTestDaemon();
    try {
      const first = await propose(daemon);
      const token = (first.payload as { result: { ackToken: string } }).result.ackToken;
      const approved = await injectJson(daemon.app, {
        method: 'POST',
        url: '/mcp/ack',
        payload: { ackToken: token, approve: true },
      });
      expect(approved.statusCode).toBe(200);
      const decision = (
        approved.payload as { result: { applied: boolean; decision: string; note: string } }
      ).result;
      expect(decision.decision).toBe('approved');
      expect(decision.applied).toBe(false);
      expect(decision.note).toContain('桩');

      const second = await propose(daemon);
      const token2 = (second.payload as { result: { ackToken: string } }).result.ackToken;
      const rejected = await injectJson(daemon.app, {
        method: 'POST',
        url: '/mcp/ack',
        payload: { ackToken: token2, approve: false },
      });
      expect((rejected.payload as { result: { decision: string } }).result.decision).toBe(
        'rejected',
      );

      const audit = await injectJson(daemon.app, { method: 'GET', url: '/mcp/audit' });
      const records = (audit.payload as { result: { records: { decision: string }[] } }).result
        .records;
      expect(records.map((record) => record.decision)).toContain('approved');
      expect(records.map((record) => record.decision)).toContain('rejected');
    } finally {
      await daemon.cleanup();
    }
  });

  it('token 一次性：重复使用 → 403 mcp_ack_invalid', async () => {
    const daemon = await createTestDaemon();
    try {
      const first = await propose(daemon);
      const token = (first.payload as { result: { ackToken: string } }).result.ackToken;
      await injectJson(daemon.app, {
        method: 'POST',
        url: '/mcp/ack',
        payload: { ackToken: token, approve: true },
      });
      const reused = await injectJson(daemon.app, {
        method: 'POST',
        url: '/mcp/ack',
        payload: { ackToken: token, approve: true },
      });
      expect(reused.statusCode).toBe(403);
      expect((reused.payload as { error: { code: string } }).error.code).toBe('mcp_ack_invalid');
    } finally {
      await daemon.cleanup();
    }
  });

  it('token 超时（短时效）→ 410 mcp_ack_expired，审计记 expired', async () => {
    const daemon = await createTestDaemon({ mcpAckTtlMs: 5 });
    try {
      const first = await propose(daemon);
      const token = (first.payload as { result: { ackToken: string } }).result.ackToken;
      await new Promise((resolve) => setTimeout(resolve, 30));
      const expired = await injectJson(daemon.app, {
        method: 'POST',
        url: '/mcp/ack',
        payload: { ackToken: token, approve: true },
      });
      expect(expired.statusCode).toBe(410);
      expect((expired.payload as { error: { code: string } }).error.code).toBe('mcp_ack_expired');
      const auditRaw = await readFile(join(daemon.dataRoot, 'audit', 'mcp-audit.jsonl'), 'utf8');
      expect(auditRaw).toContain('"decision":"expired"');
    } finally {
      await daemon.cleanup();
    }
  });

  it('未知写工具 → 400 mcp_tool_unknown（列出允许的 7 个写工具）', async () => {
    const daemon = await createTestDaemon();
    try {
      const { statusCode, payload } = await propose(daemon, { tool: 'df_get_tree' });
      expect(statusCode).toBe(400);
      const error = (payload as { error: { code: string; details: { writeTools: string[] } } })
        .error;
      expect(error.code).toBe('mcp_tool_unknown');
      expect(error.details.writeTools).toHaveLength(7);
    } finally {
      await daemon.cleanup();
    }
  });

  // 证据 test-2026-10-31 §D2：深嵌套 args 在桩的 JSON.stringify（argsDigest，递归）处栈溢出 → 500；
  // 修复后与 documents 同口径：入口按深度拒为 4xx
  it('深嵌套 args（万层级、约 120KB）→ 400 bad_request 而不是 500；不落审计、后续浅提案不受影响', async () => {
    const daemon = await createTestDaemon();
    try {
      // 手拼原始 JSON 字符串：测试进程自己 JSON.stringify 万层结构也会栈溢出
      const deep = `{"tool":"df_apply_patch","caller":"mcp:zcode","args":${'{"a":'.repeat(20_000)}1${'}'.repeat(20_000)}}`;
      const res = await daemon.app.inject({
        method: 'POST',
        url: '/mcp/proposals',
        headers: { 'content-type': 'application/json' },
        payload: deep,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: { code: 'bad_request' } });

      // 提案被拒即未登记：审计应为空
      const audit = await injectJson(daemon.app, { method: 'GET', url: '/mcp/audit' });
      expect((audit.payload as { result: { records: unknown[] } }).result.records).toEqual([]);

      // 拒绝不污染 daemon 状态：浅提案照常 201
      const shallow = await propose(daemon);
      expect(shallow.statusCode).toBe(201);
    } finally {
      await daemon.cleanup();
    }
  });

  it('args 深度恰好等于上限（与 documents 同口径 1024）照常提案；超一层即拒', async () => {
    const daemon = await createTestDaemon();
    try {
      const atLimit = `{"tool":"df_apply_patch","caller":"mcp:zcode","args":${'{"a":'.repeat(1_024)}1${'}'.repeat(1_024)}}`;
      const ok = await daemon.app.inject({
        method: 'POST',
        url: '/mcp/proposals',
        headers: { 'content-type': 'application/json' },
        payload: atLimit,
      });
      expect(ok.statusCode).toBe(201);

      const overLimit = `{"tool":"df_apply_patch","caller":"mcp:zcode","args":${'{"a":'.repeat(1_025)}1${'}'.repeat(1_025)}}`;
      const rejected = await daemon.app.inject({
        method: 'POST',
        url: '/mcp/proposals',
        headers: { 'content-type': 'application/json' },
        payload: overLimit,
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json()).toMatchObject({ ok: false, error: { code: 'bad_request' } });
    } finally {
      await daemon.cleanup();
    }
  });

  it('非法 caller / 缺 ackToken 参数 → 400 bad_request', async () => {
    const daemon = await createTestDaemon();
    try {
      const badCaller = await propose(daemon, { caller: 'rando' });
      expect(badCaller.statusCode).toBe(400);

      const badAck = await injectJson(daemon.app, {
        method: 'POST',
        url: '/mcp/ack',
        payload: { approve: true },
      });
      expect(badAck.statusCode).toBe(400);
      expect((badAck.payload as { error: { code: string } }).error.code).toBe('bad_request');
    } finally {
      await daemon.cleanup();
    }
  });
});
