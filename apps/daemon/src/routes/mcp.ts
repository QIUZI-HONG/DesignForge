/**
 * @dforge/daemon · MCP 确认桩路由（dryRun → 一次性 ackToken → 审计；FE-10 确认面板消费）。
 *
 * 本段为桩：不真正改动文档，但契约形状与审计字段按架构 v1.1 §4.5.4 最终口径。
 */

import type { McpCaller } from '@dforge/contracts';
import { DAEMON_ROUTES, isMcpCaller, isMcpWriteTool, MCP_WRITE_TOOLS } from '@dforge/contracts';
import type { FastifyInstance } from 'fastify';

import type { DaemonContext } from '../app.ts';
import { sendFail, sendOk } from '../http.ts';

/** 注册 MCP 确认桩路由。 */
export function registerMcpRoutes(app: FastifyInstance, context: DaemonContext): void {
  app.post(DAEMON_ROUTES.mcpPropose.path, async (request, reply) => {
    const body = request.body;
    if (typeof body !== 'object' || body === null) {
      return sendFail(reply, 'bad_request', '请求体必须是 JSON 对象');
    }
    const record = body as Record<string, unknown>;
    if (!isMcpWriteTool(record.tool)) {
      return sendFail(reply, 'mcp_tool_unknown', `未知写工具：${String(record.tool)}`, {
        writeTools: [...MCP_WRITE_TOOLS],
      });
    }
    if (!isMcpCaller(record.caller)) {
      return sendFail(
        reply,
        'bad_request',
        'caller 必须是 user/local-ai/mcp:zcode/mcp:workbuddy/importer 之一',
      );
    }
    const args =
      typeof record.args === 'object' && record.args !== null && !Array.isArray(record.args)
        ? (record.args as Record<string, unknown>)
        : {};
    const proposal = await context.mcp.propose({
      tool: record.tool,
      args,
      caller: record.caller as McpCaller,
      documentId: typeof record.documentId === 'string' ? record.documentId : null,
    });
    context.telemetry
      .append({
        name: 'mcp.proposal',
        payload: { proposalId: proposal.proposalId, tool: proposal.tool, caller: proposal.caller },
        sessionId: null,
        appVersion: null,
        at: null,
      })
      .catch(() => undefined);
    return sendOk(reply, proposal, 201);
  });

  app.post(DAEMON_ROUTES.mcpAck.path, async (request, reply) => {
    const body = request.body;
    if (typeof body !== 'object' || body === null) {
      return sendFail(reply, 'bad_request', '请求体必须是 JSON 对象');
    }
    const record = body as Record<string, unknown>;
    if (typeof record.ackToken !== 'string' || record.ackToken.length === 0) {
      return sendFail(reply, 'bad_request', 'ackToken 必须是非空字符串');
    }
    if (typeof record.approve !== 'boolean') {
      return sendFail(reply, 'bad_request', 'approve 必须是布尔值');
    }
    const result = await context.mcp.ack({ ackToken: record.ackToken, approve: record.approve });
    if (!result.ok) {
      return sendFail(reply, result.code, result.message);
    }
    context.telemetry
      .append({
        name: 'mcp.ack',
        payload: {
          proposalId: result.response.proposalId,
          decision: result.response.decision,
          applied: result.response.applied,
        },
        sessionId: null,
        appVersion: null,
        at: null,
      })
      .catch(() => undefined);
    return sendOk(reply, result.response);
  });

  app.get(DAEMON_ROUTES.mcpAudit.path, async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const limit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : 100;
    const records = await context.mcp.audit(Number.isInteger(limit) && limit > 0 ? limit : 100);
    return sendOk(reply, { records });
  });
}
