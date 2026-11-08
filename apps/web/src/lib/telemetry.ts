/**
 * 本地埋点发射客户端（票② · 论文数据源预埋）。
 *
 * 口径（架构 v1.1 §4.4.5 / 市场规格 §8.3）：事件经 daemon `POST /telemetry/events`
 * 落 `<dataRoot>/telemetry/events.jsonl`——**默认仅本地**，不出机；敏感键由契约层在
 * 写入前脱敏（本客户端不发敏感键）。事件名词表在 `@dforge/contracts`
 * （`TELEMETRY_EVENT_NAMES`，本票新增 market.view / market.search / market.load-attempt /
 * market.asset-detail，跟随词表既有点号族）。
 *
 * 发射纪律：**fire-and-forget**——网络失败/服务不可达一律静默吞掉（埋点永远不打扰用户、
 * 不产生 unhandled rejection）；调用方 `void emitTelemetryEvent(...)` 即可，无需 await。
 */

import type { TelemetryEventName } from '@dforge/contracts';
import { DAEMON_ROUTES } from '@dforge/contracts';

import { daemonAuthHeaders, resolveDaemonEndpointSync } from './daemon-endpoint';

/** 发射选项（baseUrl/fetch 可注入——测试与宿主替换缝）。 */
export interface TelemetryEmitOptions {
  /** daemon 基址（缺省按收敛解析：`?daemon=` → env → 端口窗起点）。 */
  baseUrl?: string;
  /** fetch 替身（测试注入）。 */
  fetchImpl?: typeof fetch;
}

/** 发射一条本地事件（不等待结果、不抛异常；返回的 promise 永不 reject）。 */
export function emitTelemetryEvent(
  name: TelemetryEventName,
  payload?: Record<string, unknown>,
  options: TelemetryEmitOptions = {},
): void {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = (options.baseUrl ?? resolveDaemonEndpointSync()).replace(/\/+$/, '');
  const body = JSON.stringify({
    name,
    ...(payload === undefined ? {} : { payload }),
  });
  // 拒绝路径就地吞掉：埋点失败（不可达/4xx/5xx）对用户不可见，也不污染全局拒绝队列
  void fetchImpl(`${base}${DAEMON_ROUTES.telemetryAppend.path}`, {
    method: 'POST',
    headers: {
      ...daemonAuthHeaders(),
      'content-type': 'application/json',
    },
    body,
  }).catch(() => undefined);
}
