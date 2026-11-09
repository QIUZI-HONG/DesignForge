/**
 * 文档接口客户端（FE-02；daemon `/documents`）。
 *
 * 路径与方法**取自契约路由表**（`DAEMON_ROUTES`），不手写字符串——避免前端与 daemon 漂移。
 * 响应统一走信封：`{ ok:true, result }` / `{ ok:false, error }`；任何网络/解析异常归一为
 * `daemon_unreachable`，**请求悬挂归一为 `daemon_timeout`**（统一超时上限见 `gateway-timeout`，
 * 页面对「连不上」与「不回话」给不同引导），调用方只需处理一种错误类型（`DocumentApiError`）。
 *
 * 传输（arch-v1 · 票①）：端点/令牌/信封/超时（经 `timeoutMs`）全部由
 * `@/lib/daemon-transport` 承担；本模块只做**首页领域错误映射**（公开错误类型与文案不变）。
 *
 * 消费方：首页（FE-02）的列表/新建/删除；FE-03/06 的文档读写可复用同一形状（本模块
 * 只覆盖首页需要的三个动作，扩展时按同一错误归一纪律追加，**读端点不另写一套请求实现**）。
 */
import {
  DAEMON_ROUTES,
  type DfErrorCode,
  type DocumentDeleteResponse,
  type DocumentListResponse,
  type DocumentSummary,
} from '@dforge/contracts';

import { t } from '@/i18n';
import type { DaemonRoute, TransportFailure } from '@/lib/daemon-transport';
import { request as daemonRequest } from '@/lib/daemon-transport';
import { GATEWAY_TIMEOUT_MS } from './gateway-timeout';

/** 前端侧错误码：daemon 错误码 ∪ 传输层归一码（超时/不可达是本机数据面的传输层事实，
 *  daemon 自身不产出，故只在 web 侧声明，不进 `@dforge/contracts` 的线上错误码表）。 */
export type HomeApiErrorCode = 'daemon_unreachable' | 'daemon_timeout' | DfErrorCode;

/** 首页数据面统一错误（携带码，供错误态展示与重试分支）。 */
export class DocumentApiError extends Error {
  readonly code: HomeApiErrorCode;

  constructor(code: HomeApiErrorCode, message: string) {
    super(message);
    this.name = 'DocumentApiError';
    this.code = code;
  }
}

/**
 * 错误码 → 展示用码（错误态里的「错误码」文本：统一 `E_DF_` 前缀 + 大写下划线）。
 * 展示码同时便于用户报障时一眼说清（验收标准 §5 的 error 态取证挂点）。
 */
export function describeApiErrorCode(code: HomeApiErrorCode): string {
  return `E_DF_${code.toUpperCase()}`;
}

/** 文档接口（首页需要的三个动作）。 */
export interface DocumentsGateway {
  list(): Promise<DocumentListResponse>;
  create(name: string): Promise<DocumentSummary>;
  remove(documentId: string): Promise<DocumentDeleteResponse>;
}

/** 构造选项。 */
export interface DocumentsGatewayOptions {
  /** daemon 基址（由 `resolveDaemonBaseUrl` 解析）。 */
  baseUrl: string;
  /** 注入的 fetch（测试用；缺省全局 fetch）。 */
  fetchImpl?: typeof fetch;
  /** 统一超时上限（毫秒；测试注入小值，缺省 {@link GATEWAY_TIMEOUT_MS}）。 */
  timeoutMs?: number;
}

/** 路径模板 → 实际路径（`:` 段替换为编码后的路径参数；基址由传输层拼）。 */
function routePath(template: string, params: Record<string, string> = {}): string {
  return template.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = params[name];
    return encodeURIComponent(value ?? '');
  });
}

/** 传输失败 → 首页领域错误（公开错误类型与文案零变化）。 */
function toDocumentApiError(failure: TransportFailure, timeoutMs: number): DocumentApiError {
  switch (failure.code) {
    case 'daemon_timeout':
      return new DocumentApiError(
        'daemon_timeout',
        t('home.error.daemonTimeout', { ms: timeoutMs }),
      );
    case 'daemon_unreachable':
      return new DocumentApiError('daemon_unreachable', t('home.error.unreachable'));
    case 'daemon_bad_response': {
      const reason = (failure.details as { reason?: unknown } | undefined)?.reason;
      return new DocumentApiError(
        'daemon_unreachable',
        t(
          reason === 'invalid-json'
            ? 'home.error.unparseableResponse'
            : 'home.error.unknownShapeResponse',
        ),
      );
    }
    default:
      return new DocumentApiError(failure.code as HomeApiErrorCode, failure.message);
  }
}

/** 创建文档接口客户端。 */
export function createDocumentsGateway(options: DocumentsGatewayOptions): DocumentsGateway {
  const { baseUrl } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? GATEWAY_TIMEOUT_MS;

  const request = async <T>(route: DaemonRoute, init: { body?: unknown } = {}): Promise<T> => {
    const result = await daemonRequest<T>(route, {
      baseUrl,
      fetchImpl,
      timeoutMs,
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    if (!result.ok) throw toDocumentApiError(result, timeoutMs);
    return result.value;
  };

  return {
    async list(): Promise<DocumentListResponse> {
      const result = await request<DocumentListResponse>(DAEMON_ROUTES.documents);
      // 契约外的脏响应（缺 warnings）不该让 UI 崩：按空告警处理
      return {
        documents: Array.isArray(result.documents) ? result.documents : [],
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
      };
    },

    async create(name: string): Promise<DocumentSummary> {
      const result = await request<{ document: DocumentSummary }>(DAEMON_ROUTES.documentCreate, {
        body: { name },
      });
      return result.document;
    },

    async remove(documentId: string): Promise<DocumentDeleteResponse> {
      return request<DocumentDeleteResponse>({
        method: DAEMON_ROUTES.documentDelete.method,
        path: routePath(DAEMON_ROUTES.documentDelete.path, { documentId }),
      });
    },
  };
}
