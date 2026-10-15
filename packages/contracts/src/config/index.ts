/**
 * @dforge/contracts · config 命名空间。
 *
 * daemon 配置（工作目录 / ComfyUI / 埋点 / AI 供应商）与凭据摘要的跨进程形状。
 * 纪律：**任何响应不得携带明文 key**——对外一律只给掩码摘要（`sk-…abcd`）。
 * 消费方：FE-09（设置页）、FE-10（诊断面板）。
 */

import type { DfErrorCode } from '../ipc/errors.ts';

/** AI 供应商（本段仅 DeepSeek；适配层预留可插拔，换后端=改 baseUrl+model+key）。 */
export type AiProvider = 'deepseek';

/** AI 适配层配置。 */
export interface AiConfig {
  provider: AiProvider;
  model: string;
  baseUrl: string;
}

/** ComfyUI 配置（installPath 供「一键启动」动作使用，可空）。 */
export interface ComfyConfig {
  baseUrl: string;
  installPath: string | null;
}

/** 遥测配置（默认仅本地；enabled 关闭后事件只回执不落盘）。 */
export interface TelemetryConfig {
  enabled: boolean;
}

/** daemon 当前配置（GET /config 的载荷）。 */
export interface DaemonConfig {
  /** 工作目录（绝对路径，已规范化：展开 `~`、resolve）。 */
  workspaceDir: string;
  ai: AiConfig;
  comfy: ComfyConfig;
  telemetry: TelemetryConfig;
}

/** 局部更新载荷（PUT /config；未出现的字段保持原值）。 */
export interface DaemonConfigPatch {
  workspaceDir?: string;
  ai?: Partial<AiConfig>;
  comfy?: Partial<ComfyConfig>;
  telemetry?: Partial<TelemetryConfig>;
}

/** 凭据来源：stored = 本地加密凭据库；env = 环境变量（只读，优先级更高）。 */
export type CredentialSource = 'stored' | 'env';

/** 凭据摘要（**永不携带明文**；maskedKey 形如 `sk-…abcd`）。 */
export interface CredentialSummary {
  provider: AiProvider;
  hasKey: boolean;
  maskedKey: string | null;
  source: CredentialSource | null;
  updatedAt: string | null;
}

/** GET /config 响应。 */
export interface ConfigResponse {
  config: DaemonConfig;
  credentials: { deepseek: CredentialSummary };
}

/** PUT /config/credentials 请求。 */
export interface CredentialSetRequest {
  provider?: AiProvider;
  apiKey: string;
}

/** PUT /config/credentials 响应（只回摘要）。 */
export interface CredentialSetResponse {
  summary: CredentialSummary;
}

/** DELETE /config/credentials 响应。 */
export interface CredentialClearResponse {
  cleared: boolean;
  summary: CredentialSummary;
}

/** 连通性自检条目 id。 */
export type ConnectivityItemId = 'daemon' | 'comfyui' | 'ai';

/** 连通性状态（`not-configured` 是正常态而非错误：如 AI 无 key 即降级态）。 */
export type ConnectivityStatus = 'ok' | 'degraded' | 'unavailable' | 'not-configured';

/** 单条连通性结果（actions 为可执行动作建议，前端按序展示）。 */
export interface ConnectivityItem {
  id: ConnectivityItemId;
  label: string;
  status: ConnectivityStatus;
  detail: string | null;
  actions: string[];
  code: DfErrorCode | null;
}

/** POST /config/connectivity 响应（**不真调云端**：AI 只查是否配置）。 */
export interface ConnectivityReport {
  checkedAt: string;
  items: ConnectivityItem[];
}

/** 校验值是否为合法 DaemonConfig（daemon 读取 config.json 时使用）。 */
export function isDaemonConfig(value: unknown): value is DaemonConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const ai = record.ai as Record<string, unknown> | undefined;
  const comfy = record.comfy as Record<string, unknown> | undefined;
  const telemetry = record.telemetry as Record<string, unknown> | undefined;
  return (
    typeof record.workspaceDir === 'string' &&
    typeof ai === 'object' &&
    ai !== null &&
    ai.provider === 'deepseek' &&
    typeof ai.model === 'string' &&
    typeof ai.baseUrl === 'string' &&
    typeof comfy === 'object' &&
    comfy !== null &&
    typeof comfy.baseUrl === 'string' &&
    (comfy.installPath === null || typeof comfy.installPath === 'string') &&
    typeof telemetry === 'object' &&
    telemetry !== null &&
    typeof telemetry.enabled === 'boolean'
  );
}

/**
 * 密钥脱敏（唯一实现，前端展示与 daemon 日志共用）：
 * 保留可识别前缀与末 4 位，其余以 `…` 折叠——如 `sk-abcdef…abcd` → `sk-…abcd`。
 */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '****';
  const head = secret.startsWith('sk-') ? 'sk-' : secret.slice(0, 2);
  return `${head}…${secret.slice(-4)}`;
}

/** 密钥形态校验（DeepSeek key 形如 `sk-` + 长串；过短/无前缀一律拒绝）。 */
export function isPlausibleApiKey(value: unknown): value is string {
  return typeof value === 'string' && /^sk-[A-Za-z0-9_-]{8,}$/.test(value);
}
