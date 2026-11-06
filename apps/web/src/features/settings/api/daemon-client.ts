/**
 * @dforge/web · 设置数据面 · daemon 客户端（FE-09）。
 *
 * 传输口径（`@dforge/contracts`）：daemon 全站统一信封 `{ ok, result | error }`。
 * 本客户端只做三件事——拼 URL（路径取 `DAEMON_ROUTES`，不手写字符串，避免路径漂移）、
 * 解包信封、把失败归一为**两类错误**：
 * - `api`     = daemon 明确拒绝（错误码 + 文案原样上抛，调用方按 code 分支）；
 * - `network` = daemon 未启动 / 不可达 / 响应非 JSON（前端给「启动本地服务」引导）。
 *
 * 为什么分两类：设置页对「daemon 没起来」与「配置被 daemon 拒绝」的恢复路径不同——
 * 前者引导启动服务，后者把 daemon 的 message 原样展示给用户。
 *
 * baseUrl 解析已**全站收敛**到 `@/lib/daemon-endpoint`（ADR-0004 裁决 ①）：
 * `?daemon=` 查询参数 → `NEXT_PUBLIC_DF_DAEMON_URL`（端到端与门禁指向实例）→ 端口窗起点
 * `DAEMON_PORT_BASE`（daemon 铁律从该端口起探测，避免随机端口）。本模块不另立口径。
 * 每个请求有超时上限（audit-d04 · D-04，`lib/request-timeout` 单点机制，写路径 30s）。
 *
 * 密钥纪律：写入 key 的请求体只存在于调用栈内，模块**不记录**任何请求体；
 * 返回结构一律沿用契约的掩码摘要（`CredentialSummary`，永不携带明文）。
 */
import {
  type ApiFailure,
  type DaemonError,
  type DaemonRouteSpec,
  type DfErrorCode,
  isApiFailure,
  isApiSuccess,
} from '@dforge/contracts';

import { daemonAuthHeaders, resolveDaemonEndpointSync } from '@/lib/daemon-endpoint';
import {
  DAEMON_REQUEST_TIMEOUT_MS,
  fetchWithinDeadline,
  RequestTimeoutError,
} from '@/lib/request-timeout';

/** 失败类别（见模块头注释）。 */
export type DaemonClientErrorKind = 'api' | 'network';

/** 统一客户端错误。 */
export class DaemonClientError extends Error {
  readonly kind: DaemonClientErrorKind;
  /** daemon 错误码（kind=api 时必有；kind=network 时恒为 null）。 */
  readonly code: DfErrorCode | null;
  /** HTTP 状态码（拿不到响应时为 null）。 */
  readonly status: number | null;
  /** daemon 结构化补充信息（无则 null）。 */
  readonly details: Record<string, unknown> | null;

  constructor(args: {
    kind: DaemonClientErrorKind;
    message: string;
    code?: DfErrorCode | null;
    status?: number | null;
    details?: Record<string, unknown> | null;
  }) {
    super(args.message);
    this.name = 'DaemonClientError';
    this.kind = args.kind;
    this.code = args.code ?? null;
    this.status = args.status ?? null;
    this.details = args.details ?? null;
  }
}

/** 单次请求的可选项。 */
export interface DaemonRequestOptions {
  /** 请求体（JSON 序列化；给出即带 content-type）。 */
  body?: unknown;
  /** 覆盖方法（默认取路由表登记的方法）。 */
  method?: DaemonRouteSpec['method'];
}

/** 客户端实例。 */
export interface DaemonClient {
  readonly baseUrl: string;
  /** 请求一个已登记路由并解包信封。 */
  request<T>(route: DaemonRouteSpec, options?: DaemonRequestOptions): Promise<T>;
}

/** 客户端构造选项（测试注入假 fetch / 改端口）。 */
export interface DaemonClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** 单请求超时上限（毫秒；测试注入小值。缺省见 `DAEMON_REQUEST_TIMEOUT_MS`——audit-d04 · D-04）。 */
  timeoutMs?: number;
}

/** 解析 daemon baseUrl（顺序与常量见 `@/lib/daemon-endpoint`；尾部斜杠容忍）。 */
export function resolveDaemonBaseUrl(): string {
  return resolveDaemonEndpointSync();
}

/** 创建 daemon 客户端（默认走全局 fetch）。 */
export function createDaemonClient(options: DaemonClientOptions = {}): DaemonClient {
  const baseUrl = (options.baseUrl ?? resolveDaemonBaseUrl()).replace(/\/+$/, '');
  const fetchImpl: typeof fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DAEMON_REQUEST_TIMEOUT_MS;

  return {
    baseUrl,

    async request<T>(
      route: DaemonRouteSpec,
      requestOptions: DaemonRequestOptions = {},
    ): Promise<T> {
      const url = `${baseUrl}${route.path}`;
      // 本地令牌鉴权（audit-d02 · D-02）：单点解析鉴权头（无令牌 → 空对象，头不存在）
      const headers: Record<string, string> = {
        accept: 'application/json',
        ...daemonAuthHeaders(),
      };
      const init: RequestInit = { method: requestOptions.method ?? route.method, headers };
      if (requestOptions.body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(requestOptions.body);
      }

      let response: Response;
      try {
        // 请求带超时上限（audit-d04 · D-04）：daemon「活着但不响应」时设置请求不得
        // 永久 pending——到点 abort 并落为 network 类有界失败（同 J9 保存链口径）。
        response = await fetchWithinDeadline(
          fetchImpl,
          url,
          init,
          timeoutMs,
          (ms) => new RequestTimeoutError(ms),
        );
      } catch (error) {
        if (error instanceof RequestTimeoutError) {
          // 超时 ≠ 连不上：daemon 往往活着，只是没回应——文案用超时哨兵自己的
          // 人话（含「请稍后重试」），不套「请确认 daemon 已启动」的不可达引导。
          throw new DaemonClientError({ kind: 'network', message: error.message });
        }
        throw new DaemonClientError({
          kind: 'network',
          message: `无法连接本地服务（${baseUrl}）——请确认 daemon 已启动后重试。`,
        });
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new DaemonClientError({
          kind: 'network',
          message: `本地服务响应不可解析（HTTP ${String(response.status)}）。`,
          status: response.status,
        });
      }

      if (isApiSuccess<T>(payload)) return payload.result;
      if (isApiFailure(payload)) {
        const failure: ApiFailure = payload;
        const error: DaemonError = failure.error;
        throw new DaemonClientError({
          kind: 'api',
          message: error.message,
          code: error.code,
          status: response.status,
          details: error.details ?? null,
        });
      }
      throw new DaemonClientError({
        kind: 'network',
        message: `本地服务响应形状不合法（HTTP ${String(response.status)}）。`,
        status: response.status,
      });
    },
  };
}
