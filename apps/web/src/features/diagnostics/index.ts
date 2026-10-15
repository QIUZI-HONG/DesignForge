/**
 * `@dforge/web` 诊断特性（FE-10 · F8 诊断面板）——公开面。
 *
 * 消费方（FE-03 编辑器壳 / FE-09 设置页等）只需要：
 * - `DiagnosticsPanel`：可直接挂载的诊断面板（端口与环境可注入）；
 * - 纯逻辑：`environment.ts`（环境快照 / 平台识别 / 时长分段）与 `logs.ts`（日志尾部行）
 *   —— `scripts/verify-*` 与验收会话读同一份数据口径。
 */

export {
  createDiagnosticsPort,
  DaemonRequestError,
  type DiagnosticsPort,
  readEnvelope,
  resolveDaemonBaseUrl,
} from './client';
export {
  type DiagnosticsEnv,
  DiagnosticsPanel,
  type DiagnosticsPanelProps,
} from './components/DiagnosticsPanel';
export {
  LOG_TAIL_LIMIT,
  type UseDiagnosticsResult,
  useDiagnostics,
} from './components/use-diagnostics';
export {
  detectPlatform,
  ENVIRONMENT_ROW_IDS,
  type EnvironmentInput,
  type EnvironmentRowId,
  type EnvironmentSnapshot,
  environmentSnapshot,
  isElectron,
  type PlatformFamily,
  type RendererFamily,
  type UptimeParts,
  uptimeParts,
} from './environment';
export { formatLogLine, logTail } from './logs';
