/**
 * FE-10 · 诊断面板 · 日志尾部（纯逻辑）。
 *
 * 数据源：daemon 本地事件日志（`GET /telemetry/events`，JSONL 落盘、**仅本地**）。
 * 口径：取最后 N 条（尾部语义：最新在最后），时间按 UTC 原样切到秒
 * （不引时区换算，保证证据 JSON 与界面逐字可复现）；载荷摘要限长，防大载荷撑爆面板。
 *
 * 行携带**事件 id**（daemon 生成，唯一）：面板列表必须以它作 React key——重复事件
 * （同秒同事件同载荷，如连开同一文档）的格式化行完全相同，以行文本作 key 会触发
 * 「Encountered two children with the same key」（票 10 · spec P1-6）。
 */
import type { TelemetryEvent } from '@dforge/contracts';

/** 单条事件的日志行（UTC 时间切到秒 + 事件名 + 载荷摘要）。 */
export function formatLogLine(event: TelemetryEvent, payloadLimit = 120): string {
  const at = event.at.slice(0, 19).replace('T', ' ');
  let payload = JSON.stringify(event.payload);
  if (payload.length > payloadLimit) {
    payload = `${payload.slice(0, Math.max(0, payloadLimit - 1))}…`;
  }
  return `${at}  ${event.name}  ${payload}`;
}

/** 日志行（事件 id 供列表 key；line 为格式化行）。 */
export interface LogTailRow {
  /** daemon 生成的事件 id（唯一；重复内容事件的行文本相同，id 不同）。 */
  id: string;
  /** 格式化行（可读文本）。 */
  line: string;
}

/** 日志尾部：取最后 `limit` 条（保持时间序，最新在最后）。 */
export function logTail(events: readonly TelemetryEvent[], limit = 8): LogTailRow[] {
  return events
    .slice(-Math.max(0, limit))
    .map((event) => ({ id: event.id, line: formatLogLine(event) }));
}
