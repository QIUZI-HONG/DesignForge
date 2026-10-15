/**
 * @dforge/contracts · IPC 错误码表与统一错误形状。
 *
 * 真源纪律：错误码是跨进程契约的一部分——daemon 用它构造失败响应，
 * 前端/CLI 用它做分支（如出图未启动态给出「重试探测/手填地址/一键启动」三个动作）。
 * 新增错误码必须同时补 HTTP 状态映射（测试断言完整性）。
 */

/** 全量错误码（按链路分组，注释即分组语义）。 */
export const DF_ERROR_CODES = [
  // 通用
  'bad_request',
  'not_found',
  'conflict',
  'internal',
  // 文档（.dfg 目录态）
  'doc_not_found',
  'doc_exists',
  'doc_invalid_name',
  'doc_invalid_body',
  'doc_invalid_manifest',
  'doc_last_page',
  // 导出
  'export_unsupported_format',
  'export_page_not_found',
  'export_render_failed',
  // 配置与凭据（凭据只在 daemon 解密使用，任何响应/日志不得出现明文 key）
  'config_invalid',
  'credential_invalid',
  // AI（配置性错误；运行时失败不是错误而是降级响应）
  'ai_invalid_request',
  // 出图（ComfyUI；未启动/缺模型是一等状态，见架构 v1.1 §5.5 失败态表）
  'comfy_unreachable',
  'comfy_model_missing',
  'comfy_oom',
  'comfy_timeout',
  'comfy_interrupted',
  'comfy_invalid_template',
  'comfy_invalid_request',
  'comfy_run_not_found',
  // 市场（索引缺失是空态而非错误；仅详情/装载目标缺失走错误码）
  'market_asset_not_found',
  // MCP 确认桩（dryRun → 一次性 ackToken → 审计）
  'mcp_ack_invalid',
  'mcp_ack_expired',
  'mcp_proposal_not_found',
  'mcp_tool_unknown',
  // 遥测（默认仅本地）
  'telemetry_invalid_event',
] as const;

/** 错误码联合类型。 */
export type DfErrorCode = (typeof DF_ERROR_CODES)[number];

/** 错误码 → HTTP 状态码（daemon 响应与前端分支共用）。 */
export const DF_ERROR_HTTP_STATUS: Record<DfErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  conflict: 409,
  internal: 500,
  doc_not_found: 404,
  doc_exists: 409,
  doc_invalid_name: 400,
  doc_invalid_body: 400,
  doc_invalid_manifest: 422,
  doc_last_page: 409,
  export_unsupported_format: 400,
  export_page_not_found: 404,
  export_render_failed: 500,
  config_invalid: 400,
  credential_invalid: 400,
  ai_invalid_request: 400,
  comfy_unreachable: 503,
  comfy_model_missing: 422,
  comfy_oom: 507,
  comfy_timeout: 504,
  comfy_interrupted: 409,
  comfy_invalid_template: 422,
  comfy_invalid_request: 400,
  comfy_run_not_found: 404,
  market_asset_not_found: 404,
  mcp_ack_invalid: 403,
  mcp_ack_expired: 410,
  mcp_proposal_not_found: 404,
  mcp_tool_unknown: 400,
  telemetry_invalid_event: 400,
};

/** 统一错误形状（所有失败响应、SSE error 事件、IPC 失败信封共用）。 */
export interface DaemonError {
  code: DfErrorCode;
  message: string;
  /** 结构化补充信息（如缺失模型清单、可执行动作建议）；不含任何密钥明文。 */
  details?: Record<string, unknown>;
}

/** 校验任意值是否为已知错误码。 */
export function isDfErrorCode(value: unknown): value is DfErrorCode {
  return typeof value === 'string' && (DF_ERROR_CODES as readonly string[]).includes(value);
}

/** 校验任意值是否为统一错误形状。 */
export function isDaemonError(value: unknown): value is DaemonError {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return isDfErrorCode(record.code) && typeof record.message === 'string';
}

/** 构造统一错误（未提供 details 时不落 details 键，保持线上形状稳定）。 */
export function makeError(
  code: DfErrorCode,
  message: string,
  details?: Record<string, unknown>,
): DaemonError {
  return details === undefined ? { code, message } : { code, message, details };
}
