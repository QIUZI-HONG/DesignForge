/**
 * `df config *` 的 daemon 地址解析与凭据写读客户端（工作包 F · 凭据 stdin 注入）。
 *
 * 地址口径**对齐 web 的收敛单点** `apps/web/src/lib/daemon-endpoint.ts`（ADR-0004 裁决 ①），
 * 只换消费方形态，不新造第三套：显式指向（CLI 形态为 `--daemon <url>`，对应 web 的 `?daemon=`）
 * → 环境变量 `NEXT_PUBLIC_DF_DAEMON_URL`（Electron 壳/部署注入）→ 缺省端点（端点串由契约包
 * `daemonEndpointDefault()` 单点构造，CLI 与 web 不再各自自拼）。CLI 不做端口窗探测——探测是
 * web 页面级异步路径的兜底；CLI 单次命令要一个确定的地址，不可达即报错（阻塞语义）。
 *
 * 传输口径与 web 设置页客户端（`apps/web/src/features/settings/api/daemon-client.ts`）同构：
 * 解 daemon 统一信封 `{ ok, result | error }`，失败归一为两类——`network`（不可达/不可解析）
 * 与 `api`（daemon 明确拒绝，错误码/文案原样上抛）。
 *
 * **安全纪律（本模块最要紧的约束）**：请求体携带明文 key，只在调用栈内流转——
 * 本模块不打印、不记录、不回显任何请求体；失败文案只来自 daemon 的结构化错误
 * （daemon 侧已保证不含明文）。
 */

import {
  type DaemonRouteSpec,
  daemonEndpointDefault,
  isApiFailure,
  isApiSuccess,
} from '@dforge/contracts';

/** 缺省 daemon 基址（端口纪律起点，本机回环；构造在契约包单点，web 同一源）。 */
export const CLI_DAEMON_DEFAULT_URL = daemonEndpointDefault();

/** 单次请求超时（毫秒；本地回环。超时即视为不可达，不让 CLI 永久挂起）。 */
export const CLI_DAEMON_TIMEOUT_MS = 10_000;

/** 解析 daemon 基址（`--daemon` → env → 缺省；尾部斜杠容忍）。 */
export function resolveDaemonBaseUrl(explicit: string | null): string {
  const envUrl = process.env.NEXT_PUBLIC_DF_DAEMON_URL ?? null;
  for (const candidate of [explicit, envUrl]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim().replace(/\/+$/, '');
    }
  }
  return CLI_DAEMON_DEFAULT_URL;
}

/** 请求失败（见模块头两类归一）。 */
export interface DaemonRequestFailure {
  kind: 'network' | 'api';
  message: string;
  /** daemon 错误码（kind=api 时必有；network 恒为 null）。 */
  code: string | null;
}

export type DaemonRequestResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: DaemonRequestFailure };

/** 请求一个已登记路由并解包信封（可选 JSON 请求体）。 */
export async function requestDaemon<T>(
  baseUrl: string,
  route: DaemonRouteSpec,
  body?: unknown,
): Promise<DaemonRequestResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const init: RequestInit = {
    method: route.method,
    headers,
    signal: AbortSignal.timeout(CLI_DAEMON_TIMEOUT_MS),
  };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${route.path}`, init);
  } catch {
    return {
      ok: false,
      failure: {
        kind: 'network',
        message: `无法连接本地服务（${baseUrl}）——请确认 daemon 已启动（pnpm --filter @dforge/daemon dev）后重试。`,
        code: null,
      },
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      failure: {
        kind: 'network',
        message: `本地服务响应不可解析（HTTP ${String(response.status)}）。`,
        code: null,
      },
    };
  }

  if (isApiSuccess<T>(payload)) return { ok: true, value: payload.result };
  if (isApiFailure(payload)) {
    return {
      ok: false,
      failure: { kind: 'api', message: payload.error.message, code: payload.error.code },
    };
  }
  return {
    ok: false,
    failure: {
      kind: 'network',
      message: `本地服务响应形状不合法（HTTP ${String(response.status)}）。`,
      code: null,
    },
  };
}
