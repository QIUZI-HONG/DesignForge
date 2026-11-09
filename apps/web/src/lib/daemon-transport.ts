/**
 * daemon 传输层（arch-v1 · 票① · 候选 1）——web 侧对 daemon HTTP 协议的**单一访问 module**。
 *
 * 为什么必须单点：收编前 8 个访问点（ai/image/mcp/diagnostics/home/settings/canvas/market）
 * 各自重推演同四件事——端点解析、令牌头、超时、`{ok,result|error}` 信封拆包，其中四家
 * 连超时都没有（daemon「活着但不响应」时界面永久停在骨架）。本 module 把四条带子藏进
 * implementation，interface 只透出两个方法 + 结构化结果：
 *
 * - `request<T>(route, init?)`：一元请求。缺省 30s **总超时**（`timeoutMs` 可覆盖），
 *   到点 abort 在飞请求并返回 `daemon_timeout`；
 * - `openStream(route, init?)`：流式请求。30s 只界**建连/响应头**——headers 到达即撤掉
 *   计时器，body 不被 abort（流本体无总超时，由消费方按需取消）。
 *
 * 失败一律归一为 {@link TransportFailure}（不抛异常）：`code` = daemon 线上码 ∪
 * `daemon_unreachable`（端点不可达 / 网络异常）∪ `daemon_timeout` ∪ `daemon_bad_response`
 * （非 JSON / 信封形状坏 / 流无 body）。**领域错误类型与界面文案由消费方适配层映射**
 * （GLOSSARY「daemon 传输层」：人话走呈现层 i18n，本 module 只给可读兜底）。
 *
 * 纪律：
 * - **不得依赖 React / 不得加 `'use client'`**——市场数据面被 Server Component 间接导入；
 * - 端点解析顺序、令牌规则不改（委托 `@/lib/daemon-endpoint`）；`daemonAuthHeaders()` 是
 *   唯一的令牌头来源；
 * - 超时机制复用 `@/lib/request-timeout`（race + abort 单点），不另写第二份。
 *
 * 测试/宿主注入口（`TransportInit` 的可选字段，不是领域概念）：`baseUrl` 给出时跳过端点
 * 解析（既有客户端在创建时已解析一次，保持「一次解析」语义）；`fetchImpl` 供单测换实现。
 */
import type { DaemonRouteSpec } from '@dforge/contracts';
import { isApiFailure, isApiSuccess } from '@dforge/contracts';

import {
  DaemonEndpointError,
  daemonAuthHeaders,
  resolveDaemonEndpoint,
} from '@/lib/daemon-endpoint';
import {
  DAEMON_REQUEST_TIMEOUT_MS,
  fetchWithinDeadline,
  RequestTimeoutError,
} from '@/lib/request-timeout';

/** 路由（取 `DAEMON_ROUTES` 的值；路径模板拼参数由消费方完成）。 */
export type DaemonRoute = DaemonRouteSpec;

/** 传输失败（结构化；码集见模块头）。 */
export interface TransportFailure {
  ok: false;
  /** daemon 线上码 ∪ `daemon_unreachable` ∪ `daemon_timeout` ∪ `daemon_bad_response`。 */
  code: string;
  /** 可读兜底（领域文案由消费方映射；daemon 给的文案本就面向用户，原样透传）。 */
  message: string;
  /** 结构化补充信息（daemon 信封 details / 传输层 bad-response 理由）。 */
  details?: unknown;
  /** 有响应时的 HTTP 状态。 */
  status?: number;
}

/** 传输结果（成功带 value，失败带结构化失败）。 */
export type TransportResult<T> = { ok: true; value: T } | TransportFailure;

/** 流式打开结果（成功带原始字节流与 Response）。 */
export type TransportStreamResult =
  | { ok: true; stream: ReadableStream<Uint8Array>; response: Response }
  | TransportFailure;

/** 请求选项（`baseUrl`/`fetchImpl` 是测试与宿主注入口，见模块头）。 */
export interface TransportInit {
  /** 覆盖方法（缺省取路由表登记的方法）。 */
  method?: DaemonRouteSpec['method'];
  /** 请求体（JSON 序列化；给出即带 `content-type: application/json`）。 */
  body?: unknown;
  /** 附加请求头（在鉴权头与 content-type 之上合并，同名覆盖）。 */
  headers?: Record<string, string>;
  /** 超时上限（毫秒；缺省 {@link DAEMON_REQUEST_TIMEOUT_MS}）。 */
  timeoutMs?: number;
  /** 形状校验（返回 false → `daemon_bad_response`，不让脏 result 过关）。 */
  validate?: (value: unknown) => boolean;
  /** 调用方取消信号（合并进超时控制器）。 */
  signal?: AbortSignal;
  /** 显式基址（缺省走 `resolveDaemonEndpoint()` 的完整解析顺序）。 */
  baseUrl?: string;
  /** 注入的 fetch（测试用；缺省全局 fetch）。 */
  fetchImpl?: typeof fetch;
}

/** 造失败结果（`exactOptionalPropertyTypes` 下按需带上可选键）。 */
function failure(
  code: string,
  message: string,
  extras: { details?: unknown; status?: number } = {},
): TransportFailure {
  return {
    ok: false,
    code,
    message,
    ...(extras.details === undefined ? {} : { details: extras.details }),
    ...(extras.status === undefined ? {} : { status: extras.status }),
  };
}

/** 去掉尾部斜杠（拼路径时避免双斜杠）。 */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * 解析本次请求的基址：显式值优先；否则走 `resolveDaemonEndpoint()` 的完整解析顺序
 * （查询参数 → env → 端口窗探测，失败映射 `daemon_unreachable`）。
 *
 * 显式基址**不经过 await**（见 `request`/`openStream`）：消费方创建客户端时已解析过一次，
 * 这里再让出一个微任务会打乱「同帧先发的请求先到」的既有顺序（市场页取数/遥测的
 * 首请求顺序由测试钉住）。只有需要端口窗探测时才异步。
 */
async function resolveBaseUrl(init: TransportInit): Promise<string | TransportFailure> {
  if (init.baseUrl !== undefined && init.baseUrl.length > 0) {
    return trimTrailingSlash(init.baseUrl);
  }
  try {
    return trimTrailingSlash(await resolveDaemonEndpoint());
  } catch (cause) {
    if (cause instanceof DaemonEndpointError) {
      return failure(cause.code, cause.message);
    }
    return failure('daemon_unreachable', cause instanceof Error ? cause.message : String(cause));
  }
}

/** 显式基址（无需探测；缺省/空白 → undefined，走 {@link resolveBaseUrl}）。 */
function explicitBaseUrl(init: TransportInit): string | undefined {
  return init.baseUrl !== undefined && init.baseUrl.length > 0
    ? trimTrailingSlash(init.baseUrl)
    : undefined;
}

/** 拼 fetch 初始化（鉴权头 + 可选 JSON 体；调用方头最后合并）。 */
function buildRequestInit(route: DaemonRoute, init: TransportInit): RequestInit {
  const headers: Record<string, string> = { ...daemonAuthHeaders() };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.headers !== undefined) Object.assign(headers, init.headers);
  return {
    method: init.method ?? route.method,
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    ...(init.signal === undefined ? {} : { signal: init.signal }),
  };
}

/** 发请求并把网络/超时异常归一为传输失败（成功返回 Response）。 */
async function fetchRoute(
  route: DaemonRoute,
  init: TransportInit,
  baseUrl: string,
): Promise<Response | TransportFailure> {
  const fetchImpl = init.fetchImpl ?? fetch;
  const timeoutMs = init.timeoutMs ?? DAEMON_REQUEST_TIMEOUT_MS;
  try {
    return await fetchWithinDeadline(
      fetchImpl,
      `${baseUrl}${route.path}`,
      buildRequestInit(route, init),
      timeoutMs,
      (ms) => new RequestTimeoutError(ms),
    );
  } catch (cause) {
    if (cause instanceof RequestTimeoutError) {
      return failure('daemon_timeout', cause.message);
    }
    return failure('daemon_unreachable', cause instanceof Error ? cause.message : String(cause));
  }
}

/** 读响应 JSON；失败（非 JSON）归一为 `daemon_bad_response`。 */
async function readJson(response: Response): Promise<unknown | TransportFailure> {
  try {
    return await response.json();
  } catch {
    return failure('daemon_bad_response', '本地服务返回了无法解析的响应（非 JSON）', {
      details: { reason: 'invalid-json' },
      status: response.status,
    });
  }
}

/**
 * 一元请求的**总**超时：响应头已到、正文（JSON）仍可不落定——30s 界的是整次调用，
 * 不是只界响应头。到点取消 body 释放连接，并归一为 `daemon_timeout`。
 */
async function readJsonWithin(
  response: Response,
  timeoutMs: number,
): Promise<unknown | TransportFailure> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TransportFailure>((resolve) => {
    timer = setTimeout(
      () => {
        void response.body?.cancel().catch(() => undefined);
        resolve(failure('daemon_timeout', new RequestTimeoutError(timeoutMs).message));
      },
      Math.max(0, timeoutMs),
    );
  });
  try {
    return await Promise.race([readJson(response), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** 判别一个值是否为结构化失败（`readJson` 的返回是 unknown，需显式收窄）。 */
function isTransportFailure(value: unknown): value is TransportFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

/** 解包信封：成功取 result（可选形状校验），失败透传 daemon 码，脏形状归一 bad-response。 */
function unwrapEnvelope<T>(
  payload: unknown,
  init: TransportInit,
  status: number,
): TransportResult<T> {
  if (isApiSuccess<T>(payload)) {
    if (init.validate !== undefined && !init.validate(payload.result)) {
      return failure('daemon_bad_response', '本地服务返回的 result 形状不符合契约', {
        details: { reason: 'invalid-shape' },
        status,
      });
    }
    return { ok: true, value: payload.result };
  }
  if (isApiFailure(payload)) {
    const raw = (payload as { error?: unknown }).error;
    const error = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    return failure(
      typeof error.code === 'string' ? error.code : `http_${String(status)}`,
      typeof error.message === 'string' ? error.message : `请求失败（HTTP ${String(status)}）`,
      {
        ...(typeof error.details === 'object' && error.details !== null
          ? { details: error.details }
          : {}),
        status,
      },
    );
  }
  return failure('daemon_bad_response', '本地服务返回了不可识别的 JSON 信封', {
    details: { reason: 'malformed-envelope' },
    status,
  });
}

/** 一元请求：缺省 30s 总超时；失败一律结构化返回（不抛）。 */
export async function request<T>(
  route: DaemonRoute,
  init: TransportInit = {},
): Promise<TransportResult<T>> {
  const explicit = explicitBaseUrl(init);
  const baseUrl = explicit ?? (await resolveBaseUrl(init));
  if (typeof baseUrl !== 'string') return baseUrl;

  const timeoutMs = init.timeoutMs ?? DAEMON_REQUEST_TIMEOUT_MS;
  const startedAt = Date.now();
  const response = await fetchRoute(route, init, baseUrl);
  if (isTransportFailure(response)) return response;

  // 总超时：fetch 只界到响应头；正文读取用剩余预算（头到正文挂死同样有界失败）。
  const remaining = timeoutMs - (Date.now() - startedAt);
  const payload = await readJsonWithin(response, remaining);
  if (isTransportFailure(payload)) return payload;
  return unwrapEnvelope<T>(payload, init, response.status);
}

/**
 * 流式请求：30s 只界建连/响应头（headers 到达即 clearTimeout，不 abort body）。
 * 非 2xx 或失败信封 → 读信封后返回失败（顺序与既有 AI 客户端一致）。
 */
export async function openStream(
  route: DaemonRoute,
  init: TransportInit = {},
): Promise<TransportStreamResult> {
  const explicit = explicitBaseUrl(init);
  const baseUrl = explicit ?? (await resolveBaseUrl(init));
  if (typeof baseUrl !== 'string') return baseUrl;

  const response = await fetchRoute(route, init, baseUrl);
  if (isTransportFailure(response)) return response;

  if (!response.ok) {
    const payload = await readJson(response);
    if (isTransportFailure(payload)) {
      // 非 2xx 且正文不是 JSON：仍按 HTTP 状态给码（旧 AI 客户端同口径）
      return failure(
        `http_${String(response.status)}`,
        `请求失败（HTTP ${String(response.status)}）`,
        {
          status: response.status,
        },
      );
    }
    if (isApiFailure(payload)) {
      const raw = (payload as { error?: unknown }).error;
      const error = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
      return failure(
        typeof error.code === 'string' ? error.code : `http_${String(response.status)}`,
        typeof error.message === 'string'
          ? error.message
          : `请求失败（HTTP ${String(response.status)}）`,
        {
          ...(typeof error.details === 'object' && error.details !== null
            ? { details: error.details }
            : {}),
          status: response.status,
        },
      );
    }
    return failure(
      `http_${String(response.status)}`,
      `请求失败（HTTP ${String(response.status)}）`,
      {
        status: response.status,
      },
    );
  }

  if (response.body === null) {
    return failure('daemon_bad_response', '本地服务流式响应没有响应体', {
      details: { reason: 'no-body' },
      status: response.status,
    });
  }
  return { ok: true, stream: response.body, response };
}
