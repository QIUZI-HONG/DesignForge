/**
 * @dforge/daemon —— 本地服务（Fastify 5；前端数据面子集）。
 *
 * 定位（前端实现规格 v1 §一.7）：配置与凭据（BYOK，key 只在 daemon 解密）、文档读写
 * （`.dfg` 目录态、原子写）、导出（PNG/SVG/PDF）、AI 代理（无 key/失败 → 降级响应同构）、
 * 出图调度（ComfyUI，未启动/缺模型是一等状态）、市场服务（读索引，无索引 → 空态）、
 * 本地遥测（默认仅本地）、MCP 确认桩（dryRun → 一次性 ackToken → 审计）。
 * 圈外（本段）：daemon 握手全量、更新通道、Agent 运维通道、真实 MCP 网关（P5）。
 * 跨进程契约类型一律定义在 @dforge/contracts；路由表见 DAEMON_ROUTES。
 */

export type { DaemonAppOptions, DaemonContext } from './app.ts';
export { createDaemonApp } from './app.ts';
export type { DaemonPaths } from './context.ts';
export { DAEMON_VERSION, defaultDataRoot, resolveDaemonPaths } from './context.ts';
export type { RunningDaemon, StartDaemonOptions } from './server.ts';
export { startDaemon } from './server.ts';

/** 服务标识。 */
export const DAEMON_PACKAGE = '@dforge/daemon' as const;

/** 本段 daemon 提供的服务面。 */
export const DAEMON_SURFACES = [
  'config-and-credentials',
  'documents',
  'export',
  'ai-proxy',
  'comfy-schedule',
  'market',
  'telemetry-local',
  'mcp-confirmation-stub',
] as const;
