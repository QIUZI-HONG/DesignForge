/**
 * @dforge/contracts · telemetry 命名空间。
 *
 * 本地埋点事件形状：**默认仅本地**（JSONL 追加），用户显式授权后才参与云端聚合
 * （架构 v1.1 §4.4.5/§8.3）。写入前经白名单脱敏：任何疑似密钥字段一律剔除。
 * 消费方：FE-09（埋点开关）、FE-11（数据看板）、FE-10（诊断）。
 */

/** 事件名词表（本段范围；新增须同步 sanitize 用例）。 */
export const TELEMETRY_EVENT_NAMES = [
  'doc.created',
  'doc.opened',
  'doc.saved',
  'doc.renamed',
  'doc.deleted',
  'page.saved',
  'export.completed',
  'ai.run',
  'ai.degraded',
  'image.run.submitted',
  'image.run.completed',
  'image.run.failed',
  'market.install',
  'market.uninstall',
  'market.adopt',
  'market.abandon',
  'market.time-saved',
  'config.updated',
  'mcp.proposal',
  'mcp.ack',
] as const;

/** 事件名联合类型。 */
export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number];

/** 落盘事件（id/at 由 daemon 生成，调用方不可指定 id）。 */
export interface TelemetryEvent {
  id: string;
  name: TelemetryEventName;
  at: string;
  sessionId: string | null;
  appVersion: string | null;
  /** 已脱敏载荷（敏感键在写入前剔除）。 */
  payload: Record<string, unknown>;
}

/** `POST /telemetry/events` 请求。 */
export interface TelemetryAppendRequest {
  name: TelemetryEventName;
  payload?: Record<string, unknown>;
  sessionId?: string | null;
  appVersion?: string | null;
  at?: string;
}

/** `POST /telemetry/events` 响应（disabled 时 stored=false，属正常态）。 */
export interface TelemetryAppendResponse {
  stored: boolean;
  id: string | null;
  reason: 'disabled' | null;
}

/** `GET /telemetry/events` 响应（一键查看原始记录）。 */
export interface TelemetryQueryResponse {
  events: TelemetryEvent[];
  total: number;
}

/** `DELETE /telemetry/events` 响应（一键删除）。 */
export interface TelemetryClearResponse {
  cleared: boolean;
  removed: number;
}

/** 敏感键白名单正则（命中即剔除：key/secret/token/password/authorization/credential/cookie）。 */
export const TELEMETRY_SENSITIVE_KEY_PATTERN =
  /(api[-_]?key|apikey|secret|token|password|authorization|credential|cookie)/i;

/** 校验事件名。 */
export function isTelemetryEventName(value: unknown): value is TelemetryEventName {
  return typeof value === 'string' && (TELEMETRY_EVENT_NAMES as readonly string[]).includes(value);
}

/** 敏感信息以占位符替换（保留键名便于排查，值不落盘）。 */
export const TELEMETRY_REDACTED_PLACEHOLDER = '[redacted]';

/**
 * 载荷脱敏（递归）：命中敏感键的**值**替换为占位符，其余保留；
 * 返回被替换的键路径清单（供诊断核对）。
 */
export function sanitizeTelemetryPayload(payload: Record<string, unknown>): {
  payload: Record<string, unknown>;
  redactedKeys: string[];
} {
  const redactedKeys: string[] = [];

  const walk = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) {
      return value.map((item, index) => walk(item, `${path}[${index}]`));
    }
    if (typeof value === 'object' && value !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value)) {
        const childPath = path.length === 0 ? key : `${path}.${key}`;
        if (TELEMETRY_SENSITIVE_KEY_PATTERN.test(key)) {
          redactedKeys.push(childPath);
          result[key] = TELEMETRY_REDACTED_PLACEHOLDER;
          continue;
        }
        result[key] = walk(nested, childPath);
      }
      return result;
    }
    return value;
  };

  const sanitized = walk(payload, '');
  return {
    payload: (typeof sanitized === 'object' && sanitized !== null ? sanitized : {}) as Record<
      string,
      unknown
    >,
    redactedKeys,
  };
}
