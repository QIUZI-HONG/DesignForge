/**
 * @dforge/web · 设置数据面 · daemon 客户端（FE-09）。
 *
 * 传输口径（`@dforge/contracts`）：daemon 全站统一信封 `{ ok, result | error }`。
 * 本客户端只做三件事——拼路由（路径取 `DAEMON_ROUTES`，不手写字符串，避免路径漂移）、
 * 把传输层结果归一为**两类错误**、给调用方透出领域码：
 * - `api`     = daemon 明确拒绝（错误码 + 文案原样上抛，调用方按 code 分支）；
 * - `network` = daemon 未启动 / 不可达 / 响应非 JSON / 超时（前端给「启动本地服务」引导）。
 *
 * 为什么分两类：设置页对「daemon 没起来」与「配置被 daemon 拒绝」的恢复路径不同——
 * 前者引导启动服务，后者把 daemon 的 message 原样展示给用户。
 *
 * 传输（arch-v1 · 票①）：端点/令牌/超时/信封全部由 `@/lib/daemon-transport` 承担；
 * 本模块只保留两类错误映射（公开类型 DaemonClientError 与 i18n 文案不变）。
 * `daemon_unreachable`/`daemon_timeout` → `kind:'network'`，daemon 线上码 → `kind:'api'`。
 *
 * 密钥纪律：写入 key 的请求体只存在于调用栈内，模块**不记录**任何请求体；
 * 返回结构一律沿用契约的掩码摘要（`CredentialSummary`，永不携带明文）。
 */
import type { DaemonRouteSpec, DfErrorCode } from '@dforge/contracts';
import { t } from '@/i18n';
import { resolveDaemonEndpointSync } from '@/lib/daemon-endpoint';
import {
  type DaemonRoute,
  request as daemonRequest,
  type TransportFailure,
} from '@/lib/daemon-transport';
import { DAEMON_REQUEST_TIMEOUT_MS } from '@/lib/request-timeout';

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

/** 传输层 details 收窄为信封 details 形状（非对象一律 null）。 */
function detailsOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** 传输失败 → 设置页两类错误（文案与 kind 口径零变化）。 */
function toDaemonClientError(failure: TransportFailure, baseUrl: string): DaemonClientError {
  switch (failure.code) {
    case 'daemon_timeout':
      // 超时 ≠ 连不上：daemon 往往活着，只是没回应——文案用超时哨兵自己的人话
      // （含「请稍后重试」），不套「请确认 daemon 已启动」的不可达引导。
      return new DaemonClientError({ kind: 'network', message: failure.message });
    case 'daemon_unreachable':
      return new DaemonClientError({
        kind: 'network',
        message: t('settings.error.network.unreachable', { url: baseUrl }),
      });
    case 'daemon_bad_response': {
      const reason = (failure.details as { reason?: unknown } | undefined)?.reason;
      const status = failure.status ?? null;
      return new DaemonClientError({
        kind: 'network',
        message: t(
          reason === 'invalid-json'
            ? 'settings.error.network.unparseable'
            : 'settings.error.network.malformed',
          { status: status ?? 0 },
        ),
        status,
      });
    }
    default:
      return new DaemonClientError({
        kind: 'api',
        message: failure.message,
        code: failure.code as DfErrorCode,
        status: failure.status ?? null,
        details: detailsOf(failure.details),
      });
  }
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
      const daemonRoute: DaemonRoute = {
        method: requestOptions.method ?? route.method,
        path: route.path,
      };
      const result = await daemonRequest<T>(daemonRoute, {
        baseUrl,
        fetchImpl,
        timeoutMs,
        headers: { accept: 'application/json' },
        ...(requestOptions.body === undefined ? {} : { body: requestOptions.body }),
      });
      if (!result.ok) throw toDaemonClientError(result, baseUrl);
      return result.value;
    },
  };
}
