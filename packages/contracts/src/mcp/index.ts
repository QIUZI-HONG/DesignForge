/**
 * @dforge/contracts · mcp 命名空间（确认桩契约，架构 v1.1 §4.5.4）。
 *
 * 写路径三段式：**dryRun → 一次性 ackToken → 审计**。
 * 本段为桩（真实网关归 P5）：daemon 只存提案、发一次性短时效 token、落审计 JSONL，
 * 不真正改动文档——但**契约形状与审计字段按最终口径**，P5 换实现不改契约。
 * 消费方：FE-10（MCP 确认面板）、FE-03（确认条）。
 */

/** 调用方（五类 actor 在事务层等价；审计必须留痕）。 */
export type McpCaller = 'user' | 'local-ai' | 'mcp:zcode' | 'mcp:workbuddy' | 'importer';

/** 写工具清单（架构 v1.1 §4.5.4 的 7 个写工具）。 */
export const MCP_WRITE_TOOLS = [
  'df_apply_patch',
  'df_create_component',
  'df_swap_instance',
  'df_run_skill',
  'df_sync_tokens',
  'df_comment_add',
  'df_version_restore',
] as const;

/** 写工具联合类型。 */
export type McpWriteTool = (typeof MCP_WRITE_TOOLS)[number];

/** ackToken 时效（一次性、短时效；超时失效）。 */
export const MCP_ACK_TTL_MS = 120_000;

/** `POST /mcp/proposals` 请求（写工具首次调用默认 dryRun）。 */
export interface McpProposalRequest {
  tool: string;
  args: Record<string, unknown>;
  caller: McpCaller;
  documentId?: string | null;
}

/** 单条将产生的变更（逐项 diff 审批的展示单位）。 */
export interface McpDiffEntry {
  op: string;
  target: string;
  summary: string;
}

/** diff 摘要（绑定 ackToken 的审批对象）。 */
export interface McpDiffSummary {
  documentId: string | null;
  baseRev: string | null;
  ops: McpDiffEntry[];
  beforeHash: string | null;
  afterHash: string | null;
}

/** `POST /mcp/proposals` 响应（dryRun 提案 + 一次性 token）。 */
export interface McpProposalResponse {
  proposalId: string;
  tool: string;
  caller: McpCaller;
  dryRun: true;
  diff: McpDiffSummary;
  /** 一次性 token：仅用于本次 ack；不得日志/响应外泄（审计只记哈希）。 */
  ackToken: string;
  expiresAt: string;
  auditId: string;
  /** 本段为桩实现的显式标记（P5 网关接管后移除）。 */
  stub: true;
}

/** `POST /mcp/ack` 请求（批准/拒绝）。 */
export interface McpAckRequest {
  ackToken: string;
  approve: boolean;
}

/** `POST /mcp/ack` 响应。 */
export interface McpAckResponse {
  proposalId: string;
  applied: boolean;
  decision: 'approved' | 'rejected';
  auditId: string;
  note: string;
}

/** 审计决策（pending 为提案落档时的初始态）。 */
export type McpAuditDecision = 'pending' | 'approved' | 'rejected' | 'expired';

/** 审计记录（`provenance/mcp-audit.jsonl` 一条；参数只存摘要，不存原文）。 */
export interface McpAuditRecord {
  auditId: string;
  at: string;
  caller: McpCaller;
  tool: string;
  proposalId: string;
  /** 参数摘要 sha256（审计可核对、不可回放出密钥/隐私原文）。 */
  argsDigest: string;
  decision: McpAuditDecision;
  applied: boolean;
  note: string | null;
}

/** `GET /mcp/audit` 响应。 */
export interface McpAuditResponse {
  records: McpAuditRecord[];
}

/** 校验工具名是否为已知写工具（未知工具 → mcp_tool_unknown）。 */
export function isMcpWriteTool(value: unknown): value is McpWriteTool {
  return typeof value === 'string' && (MCP_WRITE_TOOLS as readonly string[]).includes(value);
}

/** 校验调用方枚举。 */
export function isMcpCaller(value: unknown): value is McpCaller {
  return (
    value === 'user' ||
    value === 'local-ai' ||
    value === 'mcp:zcode' ||
    value === 'mcp:workbuddy' ||
    value === 'importer'
  );
}
