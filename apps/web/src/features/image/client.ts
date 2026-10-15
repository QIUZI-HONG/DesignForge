/**
 * FE-10 · 出图端口（HTTP 到 daemon）——面板与门禁共用的最小客户端。
 *
 * 覆盖 `df.image-run/v1` 的询价-提交-轮询-取消四件事；失败一律以
 * `DaemonRequestError`（带 code/details）抛出，UI 用 `failureOf` 映射成可渲染视图。
 */
import type {
  ComfyProbeResponse,
  ImageRunHandle,
  ImageRunRequest,
  ImageRunStatus,
  ImageTemplatesResponse,
} from '@dforge/contracts';
import { DAEMON_ROUTES } from '@dforge/contracts';

/** daemon 请求失败（信封 error 的形状对齐：code/message/details）。 */
export class DaemonRequestError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | null;

  constructor(code: string, message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'DaemonRequestError';
    this.code = code;
    this.details = details;
  }
}

/** 出图端口。 */
export interface ImagePort {
  /** `GET /image/probe`（未启动 = reachable:false + failure，不抛异常）。 */
  probe(): Promise<ComfyProbeResponse>;
  /** `GET /image/templates`。 */
  templates(): Promise<ImageTemplatesResponse>;
  /** `POST /image/runs`（失败抛 DaemonRequestError，details 带 actions/missing/available）。 */
  submit(request: ImageRunRequest): Promise<ImageRunHandle>;
  /** `GET /image/runs/:runId`。 */
  status(runId: string): Promise<ImageRunStatus>;
  /** `POST /image/runs/:runId/cancel`。 */
  cancel(runId: string): Promise<ImageRunStatus>;
}

/** 缺省 daemon 地址（本机回环；与路由表的端口起点一致）。 */
const DEFAULT_BASE_URL = 'http://127.0.0.1:4318';

/** 解析 daemon 基础地址（与 AI 端口同口径：显式 > 环境变量 > 缺省回环）。 */
export function resolveDaemonBaseUrl(explicit?: string): string {
  if (explicit !== undefined && explicit.length > 0) return explicit.replace(/\/$/, '');
  const fromEnv = process.env.NEXT_PUBLIC_DF_DAEMON_URL;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv.replace(/\/$/, '');
  return DEFAULT_BASE_URL;
}

/** 解包统一信封；失败抛 DaemonRequestError（details 原样带上）。 */
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
      ? (payload as { error?: { code?: unknown; message?: unknown; details?: unknown } }).error
      : undefined;
  const code = typeof error?.code === 'string' ? error.code : `http_${String(response.status)}`;
  const message =
    typeof error?.message === 'string'
      ? error.message
      : `请求失败（HTTP ${String(response.status)}）`;
  const details =
    typeof error?.details === 'object' && error.details !== null
      ? (error.details as Record<string, unknown>)
      : null;
  throw new DaemonRequestError(code, message, details);
}

/** 创建出图端口（baseUrl / fetchImpl 可注入）。 */
export function createImagePort(
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): ImagePort {
  const baseUrl = resolveDaemonBaseUrl(options.baseUrl);
  const doFetch = options.fetchImpl ?? fetch;

  const request = async <T>(path: string, method: string, body?: unknown): Promise<T> => {
    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return readEnvelope<T>(response);
  };

  return {
    probe: () => request<ComfyProbeResponse>(DAEMON_ROUTES.imageProbe.path, 'GET'),
    templates: () => request<ImageTemplatesResponse>(DAEMON_ROUTES.imageTemplates.path, 'GET'),
    submit: (runRequest) =>
      request<ImageRunHandle>(DAEMON_ROUTES.imageRunsCreate.path, 'POST', runRequest),
    status: (runId) =>
      request<ImageRunStatus>(
        DAEMON_ROUTES.imageRunGet.path.replace(':runId', encodeURIComponent(runId)),
        'GET',
      ),
    cancel: (runId) =>
      request<ImageRunStatus>(
        DAEMON_ROUTES.imageRunCancel.path.replace(':runId', encodeURIComponent(runId)),
        'POST',
      ),
  };
}
