/**
 * MCP 端口测试（seam：注入 fetch 后的请求面与解包语义）。
 *
 * 关键断言：ack 的重放/过期错误码必须原样抛出（UI 据此分「已失效」与「需重新发起」）。
 */
import { describe, expect, it, vi } from 'vitest';

import { createMcpPort, DaemonRequestError } from './client';

function jsonResponse(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status });
}

describe('MCP 端口', () => {
  it('propose：POST /mcp/proposals（dryRun 请求体原样上行）', async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          {
            proposalId: 'prop_1',
            tool: 'df_apply_patch',
            caller: 'mcp:zcode',
            dryRun: true,
            diff: { documentId: null, baseRev: null, ops: [], beforeHash: null, afterHash: null },
            ackToken: 't',
            expiresAt: '2026-10-15T00:02:00.000Z',
            auditId: 'a',
            stub: true,
          },
          201,
        ),
      ),
    );
    const port = createMcpPort({ baseUrl: 'http://127.0.0.1:4318', fetchImpl });
    const result = await port.propose({ tool: 'df_apply_patch', caller: 'mcp:zcode', args: {} });
    expect(result.dryRun).toBe(true);
    expect(result.stub).toBe(true);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('http://127.0.0.1:4318/mcp/proposals');
    expect(call[1].method).toBe('POST');
  });

  it('ack：一次性 token 上送；重放错误码 mcp_ack_invalid 原样抛出', async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'mcp_ack_invalid',
              message: 'ackToken 无效或已被使用（一次性 token 不可复用）',
            },
          }),
          { status: 403 },
        ),
      ),
    );
    const port = createMcpPort({ baseUrl: 'http://127.0.0.1:4318', fetchImpl });
    const error = await port
      .ack({ ackToken: 'token-abc', approve: true })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DaemonRequestError);
    expect((error as DaemonRequestError).code).toBe('mcp_ack_invalid');
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({ ackToken: 'token-abc', approve: true });
  });

  it('audit：GET /mcp/audit（可带 limit）', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({ records: [] })));
    const port = createMcpPort({ baseUrl: 'http://127.0.0.1:4318', fetchImpl });
    await port.audit(5);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('http://127.0.0.1:4318/mcp/audit?limit=5');
    expect(call[1].method).toBe('GET');
  });
});
