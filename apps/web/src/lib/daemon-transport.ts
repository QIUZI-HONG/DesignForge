/**
 * daemon 传输层（arch-v1 · 票① · 候选 1）——web 侧对 daemon HTTP 协议的**收敛访问
 * module**（D-19 #4 注释如实：不是「单一访问」，仍有自建访问点，见下）。
 *
 * 收编范围（经本 module 的消费方，2026-11 实况）：ai / mcp / image / diagnostics /
 * home（documents）/ settings（daemon-client）/ canvas 持久化（documents-client）/
 * market（api.ts）。收编前这些访问点各自重推演同四件事——端点解析、令牌头、超时、
 * `{ok,result|error}` 信封拆包，其中四家连超时都没有（daemon「活着但不响应」时界面
 * 永久停在骨架）。本 module 把四条带子藏进 implementation，interface 只透出两个方法 +
 * 结构化结果：
 *
 * - `request<T>(route, init?)`：一元请求。缺省 30s **总超时**（`timeoutMs` 可覆盖），
 *   到点 abort 在飞请求并返回 `daemon_timeout`；
 * - `openStream(route, init?)`：流式请求。30s 界**建连/响应头**——2xx 的 body 在 headers
 *   到达后不再被 abort（流本体无总超时，由消费方按需取消）；**非 2xx 的错误正文仍在同一
 *   预算内读取**（超时/取消即取消上游，按 `http_<status>` 失败）；调用方 `signal` 在流
 *   阶段继续生效（包装层在 abort 时取消上游 reader，消费方收到终止）。
 *
 * **仍自建访问 / 读入的点（未收编；继续收敛是后续批次）**：
 * - `lib/telemetry.ts`：fire-and-forget 直连 `POST /telemetry/events`（不拆信封、只吞错）；
 * - `features/inspect-export/model/export-client.ts`：自建 fetch + 信封拆包；超时已接
 *   lib 总预算单点（B8）；
 * - `tools/cli` 的 market 命令（deploy / search）：直接读 ADS 产物文件（读入路径，非 HTTP）。
 *
 * 失败一律归一为 {@link TransportFailure}（不抛异常）：`code` = daemon 线上码 ∪
 * `daemon_unreachable`（端点不可达 / 网络异常）∪ `daemon_timeout` ∪ `daemon_bad_response`
 * （非 JSON / 信封形状坏 / 流无 body）。坏响应的细分理由以 {@link TRANSPORT_BAD_RESPONSE_REASONS}
 * / {@link TransportBadResponseReason} 导出（票 #130）：消费方（market `api.ts`）据此把归一
 * 判据在**编译期锁定**到同一份码表，不再自写字面量对账。**领域错误类型与界面文案由消费方
 * 适配层映射**（GLOSSARY「daemon 传输层」：人话走呈现层 i18n，本 module 只给可读兜底）。
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

/**
 * 坏响应（`daemon_bad_response`）的细分理由码表（注入失败 `details.reason`；票 #130 导出）。
 * 单一真源：类型 {@link TransportBadResponseReason} 由本表派生，消费方（market `api.ts`）
 * 引用常量而非自写字面量——归一判据「reason 为 invalid-shape 保留 `daemon_bad_response`，
 * 其余一律归一 `daemon_unreachable`（评审 F4）」编译期锁定在同一份码表上。
 */
export const TRANSPORT_BAD_RESPONSE_REASONS = {
  /** 响应体不是合法 JSON（反代错页 / 截断正文）。 */
  invalidJson: 'invalid-json',
  /** 信封形状合法但 result 未过 `validate` 谓词（内层形状坏）。 */
  invalidShape: 'invalid-shape',
  /** 可识别 JSON 但不是 `{ok,result|error}` 信封（含缺 result 键）。 */
  malformedEnvelope: 'malformed-envelope',
} as const;

/** 坏响应理由类型（由 {@link TRANSPORT_BAD_RESPONSE_REASONS} 派生，编译期同源）。 */
export type TransportBadResponseReason =
  (typeof TRANSPORT_BAD_RESPONSE_REASONS)[keyof typeof TRANSPORT_BAD_RESPONSE_REASONS];

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

/** 请求选项（`baseUrl`/`fetchImpl` 是测试与宿主注入口，见模块头；D-19 #6：泛型参数
 * 承载 `validate` 谓词收窄的 result 类型——传守卫函数即让调用方拿到收窄后的 `value`）。 */
export interface TransportInit<T = unknown> {
  /** 覆盖方法（缺省取路由表登记的方法）。 */
  method?: DaemonRouteSpec['method'];
  /** 请求体（JSON 序列化；给出即带 `content-type: application/json`）。 */
  body?: unknown;
  /** 附加请求头（在鉴权头与 content-type 之上合并，同名覆盖）。 */
  headers?: Record<string, string>;
  /** 超时上限（毫秒；缺省 {@link DAEMON_REQUEST_TIMEOUT_MS}）。 */
  timeoutMs?: number;
  /**
   * 形状校验（**类型谓词**，D-19 #6）：返回 false → `daemon_bad_response`，不让脏 result
   * 过关；谓词签名让守卫函数在 `request<T>` 的成功分支里把 result 收窄为 `T`。
   */
  validate?: (value: unknown) => value is T;
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

/**
 * 造坏响应失败（票 #130：reason 注入处**类型化**——理由必须 ∈ {@link TransportBadResponseReason}，
 * 取值统一走 {@link TRANSPORT_BAD_RESPONSE_REASONS}，注入点不再裸写字面量）。
 */
function badResponseFailure(
  message: string,
  reason: TransportBadResponseReason,
  status: number,
): TransportFailure {
  return failure('daemon_bad_response', message, { details: { reason }, status });
}

/** 去掉尾部斜杠（拼路径时避免双斜杠）。 */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * 端口窗探测的**在飞合并表**（评审 F3）：键 = 注入的 fetch（undefined = 全局 fetch）。
 *
 * 现场缺陷：daemon 停机时市场页 N 个并发请求各自跑完整端口窗（33 个 `/health`），
 * 每波 ~2.4s——`resolveDaemonEndpoint()` 的进程内缓存只在**落定后**生效，并发窗口内
 * 全部未命中。这里让并发调用共享同一次在飞探测；**落定即摘除**（成功后续请求命中
 * daemon-endpoint 的缓存，失败不缓存、下次重新探测——只合并并发窗口，不改变失败语义）。
 */
const endpointProbesInFlight = new Map<typeof fetch | undefined, Promise<string>>();

/** 取（必要时发起）本次注入对应的在飞端口窗探测。 */
function shareEndpointProbe(fetchImpl: typeof fetch | undefined): Promise<string> {
  const existing = endpointProbesInFlight.get(fetchImpl);
  if (existing !== undefined) return existing;
  const probe = resolveDaemonEndpoint(fetchImpl === undefined ? {} : { fetchImpl }).finally(() => {
    // 落定即摘除：成功走 daemon-endpoint 的进程内缓存；失败不缓存（下次重新探测）
    endpointProbesInFlight.delete(fetchImpl);
  });
  endpointProbesInFlight.set(fetchImpl, probe);
  return probe;
}

/**
 * 解析本次请求的基址：显式值优先；否则走 `resolveDaemonEndpoint()` 的完整解析顺序
 * （查询参数 → env → 端口窗探测，失败映射 `daemon_unreachable`）。
 *
 * 显式基址**不经过 await**（见 `request`/`openStream`）：多数消费方（ai / mcp / image /
 * diagnostics / settings / canvas 持久化）在创建端口时已同步解析出基址，显式路径再让出
 * 一个微任务只会推迟 fetch 的发出（「同帧先后发出的请求谁先到」的既有顺序会变）。
 * **并非所有消费方都预解析**：市场取数无注入 `baseUrl` 时把解析交给本函数的异步端口窗
 * 探测（评审 F3）——所以本函数必须保留异步路径，显式基址只省掉那一次 await。
 * 探测本身经 {@link shareEndpointProbe} 做并发窗口合并（冷缓存 N 个并发调用只跑一波）。
 */
async function resolveBaseUrl(init: TransportInit): Promise<string | TransportFailure> {
  if (init.baseUrl !== undefined && init.baseUrl.length > 0) {
    return trimTrailingSlash(init.baseUrl);
  }
  try {
    // 注入的 fetch 一并用于端口窗探测（测试替身不真连网络；生产为全局 fetch）。
    const endpoint = await shareEndpointProbe(init.fetchImpl);
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
    return badResponseFailure(
      t('daemon.transport.badResponse'),
      TRANSPORT_BAD_RESPONSE_REASONS.invalidJson,
      status,
    );
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
 * 读全响应体文本，**到点必然落定**。
 *
 * - 真实 Response 的 body 走自有 reader（{@link readBodyText}）：abort 时 `reader.cancel()`
 *   取消上游、释放连接；
 * - 204/HEAD 的 null body 与宿主替身的 `text()` 回退没有 reader 可取消：同样与
 *   `deadline.timeout` race（评审 R2-N2），到上限必然落定；
 * - 两条路径都 race `deadline.timeout`：即使上游流无视 `cancel()`，读取也不会无界悬挂。
 */
async function readTextWithinDeadline(deadline: TotalDeadlineResponse): Promise<string> {
  const { response, signal, timeout } = deadline;
  const body = response.body as ReadableStream<Uint8Array> | null | undefined;
  const reading =
    body === null || body === undefined || typeof body.getReader !== 'function'
      ? response.text()
      : readBodyText(body, signal);
  return await Promise.race([reading, timeout]);
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
  init: TransportInit<T>,
  status: number,
): TransportResult<T> {
  if (isApiSuccess<T>(payload)) {
    if (init.validate !== undefined && !init.validate(payload.result)) {
      return badResponseFailure(
        t('daemon.transport.invalidShape'),
        TRANSPORT_BAD_RESPONSE_REASONS.invalidShape,
        status,
      );
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
  return badResponseFailure(
    t('daemon.transport.malformedEnvelope'),
    TRANSPORT_BAD_RESPONSE_REASONS.malformedEnvelope,
    status,
  );
}

/** 一元请求：缺省 30s 总超时（头 + 正文同一预算）；失败一律结构化返回（不抛）。
 * `T` 由调用方显式给出，或经 `validate` 谓词守卫函数推断（D-19 #6）。 */
export async function request<T>(
  route: DaemonRoute,
  init: TransportInit<T> = {},
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
