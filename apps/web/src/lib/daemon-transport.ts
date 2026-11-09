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
 * - `openStream(route, init?)`：流式请求。30s 界**建连/响应头**——2xx 的 body 在 headers
 *   到达后不再被 abort（流本体无总超时，由消费方按需取消）；**非 2xx 的错误正文仍在同一
 *   预算内读取**（超时/取消即取消上游，按 `http_<status>` 失败）；调用方 `signal` 在流
 *   阶段继续生效（包装层在 abort 时取消上游 reader，消费方收到终止）。
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

import { t } from '@/i18n';
import {
  DaemonEndpointError,
  daemonAuthHeaders,
  resolveDaemonEndpoint,
} from '@/lib/daemon-endpoint';
import {
  DAEMON_REQUEST_TIMEOUT_MS,
  fetchWithinTotalDeadline,
  RequestTimeoutError,
  type TotalDeadlineResponse,
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
    // 注入的 fetch 一并用于端口窗探测（测试替身不真连网络；生产为全局 fetch）。
    const endpoint = await resolveDaemonEndpoint(
      init.fetchImpl === undefined ? {} : { fetchImpl: init.fetchImpl },
    );
    return trimTrailingSlash(endpoint);
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

/** 发一个总预算请求：成功返回句柄（`dispose` 归调用方），网络/超时异常归一为传输失败。 */
async function fetchTotalDeadline(
  route: DaemonRoute,
  init: TransportInit,
  baseUrl: string,
): Promise<TotalDeadlineResponse | TransportFailure> {
  const fetchImpl = init.fetchImpl ?? fetch;
  const timeoutMs = init.timeoutMs ?? DAEMON_REQUEST_TIMEOUT_MS;
  try {
    return await fetchWithinTotalDeadline(
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

/** JSON 解析单点：文本 → 值；解析失败归一 `daemon_bad_response`（invalid-json）。 */
function parseJsonText(text: string, status: number): unknown | TransportFailure {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return failure('daemon_bad_response', t('daemon.transport.badResponse'), {
      details: { reason: 'invalid-json' },
      status,
    });
  }
}

/**
 * 读全响应体文本（**自有 reader**，不用 `response.json()`/`response.text()` 的托管读取）。
 *
 * 为什么必须自有 reader：`response.json()` 会锁定流，随后对 `response.body.cancel()`
 * 是无效操作（locked stream 不可 cancel）——正文滴流挂死时调用方虽已按超时返回，
 * 底层连接却永不释放。这里在 abort（超时到点 / 调用方取消）时 `reader.cancel()`，
 * 正常读完与中途异常也 cancel（幂等），**任何路径都释放连接**。
 */
async function readBodyText(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const cancel = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal.aborted) cancel();
  else signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal.removeEventListener('abort', cancel);
    // 读完时是幂等空操作；被 abort / 中途异常时真正取消上游（释放连接）
    await reader.cancel().catch(() => undefined);
  }
}

/** abort 后的失败归一：超时哨兵 → `daemon_timeout`；其余（调用方取消/连接中断）→ `daemon_unreachable`。 */
function abortFailure(signal: AbortSignal): TransportFailure {
  const reason: unknown = signal.reason;
  if (reason instanceof RequestTimeoutError) return failure('daemon_timeout', reason.message);
  return failure(
    'daemon_unreachable',
    reason instanceof Error ? reason.message : String(reason ?? 'aborted'),
  );
}

/**
 * 读全响应体文本，**到点必然落定**：真实 Response 的 body 走自有 reader
 * （{@link readBodyText}，abort 时 cancel 上游并释放连接），读取整体与
 * `deadline.timeout` race——即使上游流无视 `cancel()`，到上限也不会无界悬挂（评审 F6）。
 */
async function readTextWithinDeadline(deadline: TotalDeadlineResponse): Promise<string> {
  const { response, signal, timeout } = deadline;
  const body = response.body as ReadableStream<Uint8Array> | null | undefined;
  if (body === null || body === undefined || typeof body.getReader !== 'function') {
    // 204/HEAD 的 null body 与宿主替身的 text() 回退（无 reader 可取消）
    return await response.text();
  }
  return await Promise.race([readBodyText(body, signal), timeout]);
}

/**
 * 读一元响应正文：读文本 → `JSON.parse`（超时/取消经 signal 取消 reader）。
 * 解析失败仍是 `daemon_bad_response`（与旧 `response.json()` 的语义一致）。
 */
async function readPayload(deadline: TotalDeadlineResponse): Promise<unknown | TransportFailure> {
  const { response, signal } = deadline;
  let text: string;
  try {
    text = await readTextWithinDeadline(deadline);
  } catch (cause) {
    if (signal.aborted) return abortFailure(signal);
    return failure('daemon_unreachable', cause instanceof Error ? cause.message : String(cause), {
      status: response.status,
    });
  }
  // abort 可能让 reader 以 done 落定（而非抛错）：到点/取消仍按失败归一
  if (signal.aborted) return abortFailure(signal);
  return parseJsonText(text, response.status);
}

/** 判别一个值是否为结构化失败（`readPayload` 的返回是 unknown，需显式收窄）。 */
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
      return failure('daemon_bad_response', t('daemon.transport.invalidShape'), {
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
      typeof error.message === 'string'
        ? error.message
        : t('daemon.transport.httpFailure', { status }),
      {
        ...(typeof error.details === 'object' && error.details !== null
          ? { details: error.details }
          : {}),
        status,
      },
    );
  }
  return failure('daemon_bad_response', t('daemon.transport.malformedEnvelope'), {
    details: { reason: 'malformed-envelope' },
    status,
  });
}

/** 一元请求：缺省 30s 总超时（头 + 正文同一预算）；失败一律结构化返回（不抛）。 */
export async function request<T>(
  route: DaemonRoute,
  init: TransportInit = {},
): Promise<TransportResult<T>> {
  const explicit = explicitBaseUrl(init);
  const baseUrl = explicit ?? (await resolveBaseUrl(init));
  if (typeof baseUrl !== 'string') return baseUrl;

  // 总超时：一条 AbortController 覆盖建连 + 响应头 + 正文读取；到点 abort 即取消 reader。
  const deadline = await fetchTotalDeadline(route, init, baseUrl);
  if (isTransportFailure(deadline)) return deadline;

  try {
    const payload = await readPayload(deadline);
    if (isTransportFailure(payload)) return payload;
    return unwrapEnvelope<T>(payload, init, deadline.response.status);
  } finally {
    deadline.dispose(); // 正文已落定：撤掉计时器与调用方监听
  }
}

/**
 * 把上游 body 包一层，让**调用方 signal 在响应头到达后仍然生效**。
 *
 * 背景：传输层的总预算在 2xx 响应头到达即 `dispose()`（流式语义只界 headers）——
 * 若把 `response.body` 原样交出，此后调用方 abort（抽屉卸载 / 切换会话）不会再触达
 * 上游——消费方以为取消了，连接却悬着。本包装自持 reader：signal abort 即
 * `reader.cancel()`（真实 fetch 据此释放连接）；消费方 cancel、流正常结束同样摘监听、
 * 清资源。流本体仍无总超时（design 决定：流由消费方按需取消）。
 */
function wrapStreamWithCancel(
  upstream: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  let finished = false;
  let removeAbort = (): void => undefined;

  return new ReadableStream<Uint8Array>({
    start() {
      if (signal === undefined) return;
      const onAbort = (): void => {
        // 取消上游：pending read 以 done 落定，由 pull 收口下游
        void reader.cancel().catch(() => undefined);
      };
      removeAbort = () => signal.removeEventListener('abort', onAbort);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    },
    async pull(controller) {
      if (finished) return;
      try {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          removeAbort();
          controller.close();
          return;
        }
        if (value !== undefined) controller.enqueue(value);
      } catch (cause) {
        finished = true;
        removeAbort();
        controller.error(cause);
      }
    },
    cancel(reason) {
      finished = true;
      removeAbort();
      return reader.cancel(reason);
    },
  });
}

/**
 * 流式请求：30s 界建连/响应头——2xx 的 body 在 headers 到达后不再被 abort（流本体无总
 * 超时，由消费方按需取消）；**非 2xx 的错误正文仍在同一预算内读取**：超时/调用方取消
 * 时取消上游 reader，并按 `http_<status>` 失败（保留状态码，评审 F6）。
 * 非 2xx 或失败信封 → 读信封后返回失败（顺序与既有 AI 客户端一致）。
 * 2xx 的 body 经 {@link wrapStreamWithCancel} 包装：调用方 signal 在流阶段继续生效。
 */
export async function openStream(
  route: DaemonRoute,
  init: TransportInit = {},
): Promise<TransportStreamResult> {
  const explicit = explicitBaseUrl(init);
  const baseUrl = explicit ?? (await resolveBaseUrl(init));
  if (typeof baseUrl !== 'string') return baseUrl;

  // 与一元请求同一总预算机制，但 2xx 在下面立即 dispose（只界到 headers）；非 2xx 则
  // 保持计时器到错误正文读完——否则 502 + 永不 close 的正文会让 openStream 永不落定。
  const deadline = await fetchTotalDeadline(route, init, baseUrl);
  if (isTransportFailure(deadline)) return deadline;

  const { response } = deadline;
  if (!response.ok) {
    try {
      const payload = await readPayload(deadline);
      if (isTransportFailure(payload)) {
        // 非 2xx 且正文不可用（非 JSON / 超时 / 调用方取消）：仍按 HTTP 状态给码
        // （旧 AI 客户端同口径；状态码保留，文案走既有 i18n 键）
        return failure(
          `http_${String(response.status)}`,
          t('daemon.transport.httpFailure', { status: response.status }),
          {
            status: response.status,
          },
        );
      }
      if (isApiFailure(payload)) {
        const raw = (payload as { error?: unknown }).error;
        const error =
          typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
        return failure(
          typeof error.code === 'string' ? error.code : `http_${String(response.status)}`,
          typeof error.message === 'string'
            ? error.message
            : t('daemon.transport.httpFailure', { status: response.status }),
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
        t('daemon.transport.httpFailure', { status: response.status }),
        {
          status: response.status,
        },
      );
    } finally {
      deadline.dispose(); // 错误正文已落定（含超时/取消）：撤掉计时器与调用方监听
    }
  }

  deadline.dispose(); // 2xx：headers 已到即撤计时器，流本体由消费方按需取消
  if (response.body === null) {
    return failure('daemon_bad_response', t('daemon.transport.noBody'), {
      details: { reason: 'no-body' },
      status: response.status,
    });
  }
  return { ok: true, stream: wrapStreamWithCancel(response.body, init.signal), response };
}
