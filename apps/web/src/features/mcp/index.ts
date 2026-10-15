/**
 * `@dforge/web` MCP 确认特性（FE-10 · F9，**桩**）——公开面。
 *
 * 消费方（FE-03 编辑器壳的确认条容器等）只需要：
 * - `McpConfirmBar`：挂载 dryRun 提案即得到「逐项 diff → 一次性 ack → 审计」确认条；
 * - 纯逻辑：`confirm.ts`（超时失效 / 一次性消费的状态机）——`scripts/verify-mcp-stub.mjs`
 *   用同一份语义对真 daemon 取证。
 *
 * 硬纪律：本段是桩（真实网关归 P5）——提案的 `stub: true` 必须在 UI 显式渲染（角标「桩」）。
 */

export {
  createMcpPort,
  DaemonRequestError,
  type McpPort,
  readEnvelope,
  resolveDaemonBaseUrl,
} from './client';
export {
  formatRemaining,
  McpConfirmBar,
  type McpConfirmBarProps,
} from './components/McpConfirmBar';
export {
  beginAck,
  cancelAck,
  createConfirmation,
  isAckable,
  isSettled,
  type McpConfirmationPhase,
  type McpConfirmationState,
  remainingMs,
  settleAck,
  settleAckError,
  tick,
} from './confirm';
