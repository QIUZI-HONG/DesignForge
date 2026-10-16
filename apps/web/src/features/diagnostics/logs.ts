/**
 * FE-10 · 诊断面板 · 日志尾部（纯逻辑）。
 *
 * 数据源：daemon 本地事件日志（`GET /telemetry/events`，JSONL 落盘、**仅本地**）。
 * 口径：取最后 N 条（尾部语义：最新在最后），时间按 UTC 原样切到秒
 * （不引时区换算，保证证据 JSON 与界面逐字可复现）；载荷摘要限长，防大载荷撑爆面板。
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

/** 日志尾部：取最后 `limit` 条（保持时间序，最新在最后）。 */
export function logTail(events: readonly TelemetryEvent[], limit = 8): string[] {
  return events.slice(-Math.max(0, limit)).map((event) => formatLogLine(event));
}
