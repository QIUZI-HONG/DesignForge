/**
 * @dforge/daemon · 遥测路由（本地 JSONL；FE-09 埋点开关 / FE-11 数据看板消费）。
 *
 * 默认仅本地：事件只落 `<dataRoot>/telemetry/events.jsonl`，**不出机**；
 * 提供一键查看（GET）与一键删除（DELETE）；写入前经契约层脱敏。
 */

import { DAEMON_ROUTES, isTelemetryEventName } from '@dforge/contracts';
import type { FastifyInstance } from 'fastify';

import type { DaemonContext } from '../app.ts';
import { sendFail, sendOk } from '../http.ts';
import { exceedsJsonDepth, MAX_JSON_DEPTH } from '../path-safety.ts';

/** 注册遥测路由。 */
export function registerTelemetryRoutes(app: FastifyInstance, context: DaemonContext): void {
  app.post(DAEMON_ROUTES.telemetryAppend.path, async (request, reply) => {
    const body = request.body;
    if (typeof body !== 'object' || body === null) {
      return sendFail(reply, 'telemetry_invalid_event', '请求体必须是 JSON 对象');
    }
    const record = body as Record<string, unknown>;
    if (!isTelemetryEventName(record.name)) {
      return sendFail(reply, 'telemetry_invalid_event', `未知事件名：${String(record.name)}`);
    }
    if (
      record.payload !== undefined &&
      (typeof record.payload !== 'object' ||
        record.payload === null ||
        Array.isArray(record.payload))
    ) {
      return sendFail(reply, 'telemetry_invalid_event', 'payload 必须是 JSON 对象');
    }
    // 深嵌套 payload 在脱敏 walk / JSON.stringify（递归）处会栈溢出 → 500：
    // 与 documents 正文同口径（MAX_JSON_DEPTH），入口先按深度拒为 4xx
    if (record.payload !== undefined && exceedsJsonDepth(record.payload, MAX_JSON_DEPTH)) {
      return sendFail(
        reply,
        'telemetry_invalid_event',
        `payload 嵌套深度超过上限 ${MAX_JSON_DEPTH} 层（拒绝写入以避免栈溢出）`,
        { maxDepth: MAX_JSON_DEPTH },
      );
    }
    const result = await context.telemetry.append({
      name: record.name,
      payload: (record.payload as Record<string, unknown> | undefined) ?? {},
      sessionId: typeof record.sessionId === 'string' ? record.sessionId : null,
      appVersion: typeof record.appVersion === 'string' ? record.appVersion : null,
      at: typeof record.at === 'string' ? record.at : null,
    });
    return sendOk(reply, {
      stored: result.stored,
      id: result.id,
      reason: result.stored ? null : 'disabled',
    });
  });

  app.get(DAEMON_ROUTES.telemetryQuery.path, async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const limit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : 200;
    const events = await context.telemetry.query(Number.isInteger(limit) ? limit : 200);
    const total = await context.telemetry.count();
    return sendOk(reply, { events, total });
  });

  app.delete(DAEMON_ROUTES.telemetryClear.path, async (_request, reply) => {
    const removed = await context.telemetry.clear();
    return sendOk(reply, { cleared: true, removed });
  });
}
