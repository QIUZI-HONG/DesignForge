/**
 * @dforge/daemon —— 本地服务（骨架占位，Fastify 5）。
 *
 * 定位（前端实现规格 v1 §一.7）：文档读写、导出、AI 代理（BYOK 凭据解密）、出图调度、
 * 市场服务、本地遥测；MCP 确认为桩（契约形状 dryRun → 一次性 ackToken → 审计）。
 * 圈外（本段）：daemon 握手全量、更新通道、Agent 运维通道。
 * 跨进程契约类型一律定义在 @dforge/contracts。
 */

/** 服务标识（占位导出）。 */
export const DAEMON_PACKAGE = '@dforge/daemon' as const;

/** 本段 daemon 提供的服务面（占位清单，随对应实现票逐项落地）。 */
export const DAEMON_SURFACES = [
  'documents',
  'export',
  'ai-proxy',
  'comfy-schedule',
  'market',
  'telemetry-local',
] as const;
