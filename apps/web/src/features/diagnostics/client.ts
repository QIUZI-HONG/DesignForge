/**
 * FE-10 · 诊断端口（HTTP 到 daemon）——诊断面板与门禁共用。
 *
 * 三件数据源：`GET /health`（版本/环境）、`POST /config/connectivity`（逐项自检，
 * **不真调云端**）、`GET /telemetry/events`（本地事件日志尾部）。
 */
import type {
  ConnectivityReport,
  DaemonHealthResponse,
  TelemetryQueryResponse,
} from '@dforge/contracts';
import { DAEMON_ROUTES } from '@dforge/contracts';

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

/** 缺省 daemon 地址（本机回环；与路由表的端口起点一致）。 */
const DEFAULT_BASE_URL = 'http://127.0.0.1:4318';

/** 解析 daemon 基础地址（与其他端口同口径）。 */
export function resolveDaemonBaseUrl(explicit?: string): string {
  if (explicit !== undefined && explicit.length > 0) return explicit.replace(/\/$/, '');
  const fromEnv = process.env.NEXT_PUBLIC_DF_DAEMON_URL;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv.replace(/\/$/, '');
  return DEFAULT_BASE_URL;
}

/** 解包统一信封；失败抛 DaemonRequestError。 */
export async function readEnvelope<T>(response: Response): Promise<T> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { ok?: unknown }).ok === true
  ) {
    return (payload as { result: T }).result;
  }
  const error =
    typeof payload === 'object' && payload !== null
      ? (payload as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
  const code = typeof error?.code === 'string' ? error.code : `http_${String(response.status)}`;
  const message =
    typeof error?.message === 'string'
      ? error.message
      : `请求失败（HTTP ${String(response.status)}）`;
  throw new DaemonRequestError(code, message);
}

/** 创建诊断端口（baseUrl / fetchImpl 可注入）。 */
export function createDiagnosticsPort(
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): DiagnosticsPort {
  const baseUrl = resolveDaemonBaseUrl(options.baseUrl);
  const doFetch = options.fetchImpl ?? fetch;

  const request = async <T>(path: string, method: string): Promise<T> => {
    const response = await doFetch(`${baseUrl}${path}`, { method });
    return readEnvelope<T>(response);
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
