/**
 * FE-10 · MCP 端口（HTTP 到 daemon 的确认桩）——确认条与门禁共用。
 *
 * 覆盖三段式写路径：`POST /mcp/proposals`（dryRun）→ `POST /mcp/ack`（一次性 token）
 * → `GET /mcp/audit`（审计）。失败一律以 `DaemonRequestError`（带 code）抛出，
 * UI 据此区分「已失效」与「无效/重放」。
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

/** 解包统一信封；失败抛 DaemonRequestError。 */
export async function readEnvelope<T>(response: Response): Promise<T> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { ok?: unknown }).ok === true
  ) {
    return (payload as { result: T }).result;
  }
  const error =
    typeof payload === 'object' && payload !== null
      ? (payload as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
  const code = typeof error?.code === 'string' ? error.code : `http_${String(response.status)}`;
  const message =
    typeof error?.message === 'string'
      ? error.message
      : `请求失败（HTTP ${String(response.status)}）`;
  throw new DaemonRequestError(code, message);
}

/** 创建 MCP 端口（baseUrl / fetchImpl 可注入）。 */
export function createMcpPort(
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): McpPort {
  const baseUrl = resolveDaemonBaseUrl(options.baseUrl);
  const doFetch = options.fetchImpl ?? fetch;

  const request = async <T>(path: string, method: string, body?: unknown): Promise<T> => {
    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return readEnvelope<T>(response);
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
