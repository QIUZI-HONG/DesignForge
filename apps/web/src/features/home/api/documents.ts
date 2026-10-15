/**
 * 文档接口客户端（FE-02；daemon `/documents`）。
 *
 * 路径与方法**取自契约路由表**（`DAEMON_ROUTES`），不手写字符串——避免前端与 daemon 漂移。
 * 响应统一走信封：`{ ok:true, result }` / `{ ok:false, error }`（`@dforge/contracts` 的
 * `isApiSuccess` / `isApiFailure` 判别）；任何网络/解析异常归一为 `daemon_unreachable`，
 * 调用方只需处理一种错误类型（`DocumentApiError`）。
 *
 * 消费方：首页（FE-02）的列表/新建/删除；FE-03/06 的文档读写可复用同一形状（本模块
 * 只覆盖首页需要的三个动作，扩展时按同一错误归一纪律追加）。
 */
import {
  DAEMON_ROUTES,
  type DfErrorCode,
  type DocumentDeleteResponse,
  type DocumentListResponse,
  type DocumentSummary,
  isApiFailure,
  isApiSuccess,
} from '@dforge/contracts';

/** 前端侧错误码：daemon 错误码 ∪ 传输层归一码。 */
export type HomeApiErrorCode = 'daemon_unreachable' | DfErrorCode;

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
}

/** 拼 URL：基址 + 路由模板（`:` 段替换为编码后的路径参数）。 */
function buildUrl(baseUrl: string, template: string, params: Record<string, string> = {}): string {
  const path = template.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = params[name];
    return encodeURIComponent(value ?? '');
  });
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/** 解包信封：成功取 result，失败/脏响应抛统一错误。 */
async function readEnvelope<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DocumentApiError('daemon_unreachable', '本地服务返回了无法解析的响应。');
  }
  if (isApiFailure(payload)) {
    throw new DocumentApiError(payload.error.code, payload.error.message);
  }
  if (!isApiSuccess<T>(payload)) {
    throw new DocumentApiError('daemon_unreachable', '本地服务返回了未知形状的响应。');
  }
  return payload.result;
}

/** 发请求并解包；网络异常统一归一。 */
async function request<T>(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new DocumentApiError('daemon_unreachable', '无法连接本地服务（daemon 未启动？）。');
  }
  return readEnvelope<T>(response);
}

/** 创建文档接口客户端。 */
export function createDocumentsGateway(options: DocumentsGatewayOptions): DocumentsGateway {
  const { baseUrl } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async list(): Promise<DocumentListResponse> {
      const result = await request<DocumentListResponse>(
        fetchImpl,
        buildUrl(baseUrl, DAEMON_ROUTES.documents.path),
        { method: DAEMON_ROUTES.documents.method },
      );
      // 契约外的脏响应（缺 warnings）不该让 UI 崩：按空告警处理
      return {
        documents: Array.isArray(result.documents) ? result.documents : [],
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
      };
    },

    async create(name: string): Promise<DocumentSummary> {
      const result = await request<{ document: DocumentSummary }>(
        fetchImpl,
        buildUrl(baseUrl, DAEMON_ROUTES.documentCreate.path),
        {
          method: DAEMON_ROUTES.documentCreate.method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        },
      );
      return result.document;
    },

    async remove(documentId: string): Promise<DocumentDeleteResponse> {
      return request<DocumentDeleteResponse>(
        fetchImpl,
        buildUrl(baseUrl, DAEMON_ROUTES.documentDelete.path, { documentId }),
        { method: DAEMON_ROUTES.documentDelete.method },
      );
    },
  };
}
