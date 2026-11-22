/**
 * FE-10 · 诊断端口（HTTP 到 daemon）——诊断面板与门禁共用。
 *
 * 三件数据源：`GET /health`（版本/环境）、`POST /config/connectivity`（逐项自检，
 * **不真调云端**）、`GET /telemetry/events`（本地事件日志尾部）。
 *
 * 传输（arch-v1 · 票①）：端点/令牌/超时/信封经 `@/lib/daemon-transport` 单点；
 * 本模块只保留领域错误映射。**新增 30s 请求超时**（此前请求悬挂无出口）。
 */
import type {
  ConnectivityReport,
  DaemonHealthResponse,
  TelemetryQueryResponse,
} from '@dforge/contracts';
import { DAEMON_ROUTES } from '@dforge/contracts';

import { resolveDaemonEndpointSync } from '@/lib/daemon-endpoint';
import { request as daemonRequest } from '@/lib/daemon-transport';

/** daemon 请求失败（信封 error 的形状对齐）。 */
export class DaemonRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DaemonRequestError';
    this.code = code;
  }
}

/** 诊断端口。 */
export interface DiagnosticsPort {
  /** `GET /health`（daemon 握手信息）。 */
  health(): Promise<DaemonHealthResponse>;
  /** `POST /config/connectivity`（daemon / ComfyUI / AI 配置逐项自检）。 */
  connectivity(): Promise<ConnectivityReport>;
  /** `GET /telemetry/events`（本地事件日志；limit 为尾部条数）。 */
  events(limit?: number): Promise<TelemetryQueryResponse>;
}

/**
 * 解析 daemon 基础地址：显式参数 > 收敛模块（`?daemon=` → `NEXT_PUBLIC_DF_DAEMON_URL` →
 * 缺省端口窗起点）。顺序与常量见 `@/lib/daemon-endpoint`（ADR-0004 裁决 ①）。
 */
export function resolveDaemonBaseUrl(explicit?: string): string {
  if (explicit !== undefined && explicit.length > 0) return explicit.replace(/\/+$/, '');
  return resolveDaemonEndpointSync();
}

/** 创建诊断端口（baseUrl / fetchImpl 可注入）。 */
export function createDiagnosticsPort(
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): DiagnosticsPort {
  const baseUrl = resolveDaemonBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  const request = async <T>(path: string, method: string): Promise<T> => {
    const result = await daemonRequest<T>(
      { method: method as 'GET' | 'POST', path },
      { baseUrl, fetchImpl },
    );
    if (!result.ok) throw new DaemonRequestError(result.code, result.message);
    return result.value;
  };

  return {
    health: () => request<DaemonHealthResponse>(DAEMON_ROUTES.health.path, 'GET'),
    connectivity: () => request<ConnectivityReport>(DAEMON_ROUTES.configConnectivity.path, 'POST'),
    events: (limit) =>
      request<TelemetryQueryResponse>(
        limit === undefined
          ? `${DAEMON_ROUTES.telemetryQuery.path}?limit=8`
          : `${DAEMON_ROUTES.telemetryQuery.path}?limit=${String(limit)}`,
        'GET',
      ),
  };
}
