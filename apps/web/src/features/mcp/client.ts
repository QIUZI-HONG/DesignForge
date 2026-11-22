/**
 * FE-10 · MCP 端口（HTTP 到 daemon 的确认桩）——确认条与门禁共用。
 *
 * 覆盖三段式写路径：`POST /mcp/proposals`（dryRun）→ `POST /mcp/ack`（一次性 token）
 * → `GET /mcp/audit`（审计）。失败一律以 `DaemonRequestError`（带 code）抛出，
 * UI 据此区分「已失效」与「无效/重放」。
 *
 * 传输（arch-v1 · 票①）：端点/令牌/超时/信封经 `@/lib/daemon-transport` 单点；
 * 本模块只保留领域错误映射。**新增 30s 请求超时**（此前请求悬挂无出口）。
 */
import type {
  McpAckRequest,
  McpAckResponse,
  McpAuditResponse,
  McpProposalRequest,
  McpProposalResponse,
} from '@dforge/contracts';
import { DAEMON_ROUTES } from '@dforge/contracts';

import { resolveDaemonEndpointSync } from '@/lib/daemon-endpoint';
import { request as daemonRequest } from '@/lib/daemon-transport';

/** daemon 请求失败（信封 error 的形状对齐）。 */
export class DaemonRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DaemonRequestError';
    this.code = code;
  }
}

/** MCP 确认端口。 */
export interface McpPort {
  /** `POST /mcp/proposals`（写工具首次调用默认 dryRun）。 */
  propose(request: McpProposalRequest): Promise<McpProposalResponse>;
  /** `POST /mcp/ack`（一次性 token：批准/拒绝）。 */
  ack(request: McpAckRequest): Promise<McpAckResponse>;
  /** `GET /mcp/audit`（审计最新在前）。 */
  audit(limit?: number): Promise<McpAuditResponse>;
}

/**
 * 解析 daemon 基础地址：显式参数 > 收敛模块（`?daemon=` → `NEXT_PUBLIC_DF_DAEMON_URL` →
 * 缺省端口窗起点）。顺序与常量见 `@/lib/daemon-endpoint`（ADR-0004 裁决 ①）。
 */
export function resolveDaemonBaseUrl(explicit?: string): string {
  if (explicit !== undefined && explicit.length > 0) return explicit.replace(/\/+$/, '');
  return resolveDaemonEndpointSync();
}

/** 创建 MCP 端口（baseUrl / fetchImpl 可注入）。 */
export function createMcpPort(
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): McpPort {
  const baseUrl = resolveDaemonBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  const request = async <T>(path: string, method: string, body?: unknown): Promise<T> => {
    const result = await daemonRequest<T>(
      { method: method as 'GET' | 'POST', path },
      { baseUrl, fetchImpl, ...(body === undefined ? {} : { body }) },
    );
    if (!result.ok) throw new DaemonRequestError(result.code, result.message);
    return result.value;
  };

  return {
    propose: (proposal) =>
      request<McpProposalResponse>(DAEMON_ROUTES.mcpPropose.path, 'POST', proposal),
    ack: (ackRequest) => request<McpAckResponse>(DAEMON_ROUTES.mcpAck.path, 'POST', ackRequest),
    audit: (limit) =>
      request<McpAuditResponse>(
        limit === undefined
          ? DAEMON_ROUTES.mcpAudit.path
          : `${DAEMON_ROUTES.mcpAudit.path}?limit=${String(limit)}`,
        'GET',
      ),
  };
}
