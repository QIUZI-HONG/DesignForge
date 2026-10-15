/**
 * FE-10 · AI 端口（HTTP 到 daemon）——抽屉与门禁共用的最小客户端。
 *
 * 端口只暴露抽屉真正用到的两件事：`status`（是否配置 → 降级提示）与
 * `chatStream`（SSE 文本块）。**不做任何降级分支**：无 key / 上游失败由 daemon
 * 以同构响应表达（`AiStreamEvent` 通道不变），适配层（stream.ts）统一处理。
 */
import type { AiChatRequest, AiStatusResponse } from '@dforge/contracts';
import { DAEMON_ROUTES } from '@dforge/contracts';

/** daemon 请求失败（信封 error 的形状对齐；UI 只读 code/message）。 */
export class DaemonRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DaemonRequestError';
    this.code = code;
  }
}

/** AI 端口。 */
export interface AiPort {
  /** `GET /ai/status`（未配置也是正常响应，不是错误）。 */
  status(signal?: AbortSignal): Promise<AiStatusResponse>;
  /** `POST /ai/chat`（stream: true）：产出 SSE 原文本块（解析归 stream.ts）。 */
  chatStream(request: AiChatRequest, signal?: AbortSignal): AsyncIterable<string>;
}

/** 缺省 daemon 地址（本机回环；与路由表的端口起点一致）。 */
const DEFAULT_BASE_URL = 'http://127.0.0.1:4318';

/**
 * 解析 daemon 基础地址：显式参数 > `NEXT_PUBLIC_DF_DAEMON_URL` > 缺省回环。
 * （跨票约定：设置页/市场/诊断同此口径；daemon 端口探测后的实际端口由该环境变量注入。）
 */
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

/** 创建 AI 端口（baseUrl / fetchImpl 可注入，测试与门禁直接换实现）。 */
export function createAiPort(options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): AiPort {
  const baseUrl = resolveDaemonBaseUrl(options.baseUrl);
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async status(signal) {
      const response = await doFetch(`${baseUrl}${DAEMON_ROUTES.aiStatus.path}`, {
        method: DAEMON_ROUTES.aiStatus.method,
        ...(signal === undefined ? {} : { signal }),
      });
      return readEnvelope<AiStatusResponse>(response);
    },

    async *chatStream(request, signal) {
      const response = await doFetch(`${baseUrl}${DAEMON_ROUTES.aiChat.path}`, {
        method: DAEMON_ROUTES.aiChat.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...request, stream: true }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok || response.body === null) {
        // 流式通道未建立：优先用信封里的错误码（如 ai_invalid_request），否则退化为 HTTP 码
        const fallback = new DaemonRequestError(
          `http_${String(response.status)}`,
          'AI 流式通道建立失败',
        );
        const failure = await readEnvelope<never>(response).then(
          () => fallback,
          (error: unknown) => (error instanceof DaemonRequestError ? error : fallback),
        );
        throw failure;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        yield decoder.decode(value, { stream: true });
      }
    },
  };
}
