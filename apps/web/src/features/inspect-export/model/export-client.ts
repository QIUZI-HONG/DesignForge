/**
 * 导出客户端：daemon `POST /export`（PNG / SVG / PDF 三档）。
 *
 * 分工：本模块只管**传输与解包**（信封、错误码、超时、离线），不碰 UI 状态；
 * 面板按 `ExportOutcome` 的 `code` 分派「失败态 / 离线态 / 重试」。
 * 路由与错误码一律取 `@dforge/contracts`（避免路径/码字符串各写一份漂移）。
 */

import {
  DAEMON_PORT_BASE,
  DAEMON_ROUTES,
  type ExportArtifact,
  type ExportRequest,
  isApiFailure,
  isApiSuccess,
} from '@dforge/contracts';

/** 客户端结果：成功给产物；失败给稳定错误码 + 文案（面板映射为文案）。 */
export type ExportOutcome =
  | { ok: true; artifact: ExportArtifact }
  | { ok: false; code: string; message: string };

/** 客户端选项。 */
export interface ExportClientOptions {
  /** daemon 基址（缺省 `http://127.0.0.1:${DAEMON_PORT_BASE}`——契约的端口基准）。 */
  baseUrl?: string;
  /** fetch 注入（测试用；缺省全局 fetch）。 */
  fetchImpl?: typeof fetch;
  /** 单次导出超时（毫秒，缺省 15s）。 */
  timeoutMs?: number;
}

/** 导出客户端。 */
export interface ExportClient {
  exportDocument(request: ExportRequest): Promise<ExportOutcome>;
}

/** 缺省基址（daemon 端口探测起点；实际端口以 config/evidence 为准，宿主可覆盖）。 */
export function defaultDaemonBaseUrl(): string {
  return `http://127.0.0.1:${DAEMON_PORT_BASE}`;
}

/** 构造导出客户端。 */
export function createExportClient(options: ExportClientOptions = {}): ExportClient {
  const baseUrl = options.baseUrl ?? defaultDaemonBaseUrl();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async exportDocument(request: ExportRequest): Promise<ExportOutcome> {
      const controller = new AbortController();
      let timedOut = false;
      // 双层超时：signal 让真实 fetch 主动取消；Promise.race 保证**任何** fetch 实现下都不悬挂
      //（测试替身/其他运行时可能不理会 signal）。
      let rejectTimeout: ((error: Error) => void) | null = null;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        rejectTimeout = reject;
      });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        rejectTimeout?.(new Error(`导出请求超时（${String(timeoutMs)}ms）`));
      }, timeoutMs);

      let response: Response;
      try {
        response = await Promise.race([
          doFetch(`${baseUrl}${DAEMON_ROUTES.exportDocument.path}`, {
            method: DAEMON_ROUTES.exportDocument.method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request),
            signal: controller.signal,
          }),
          timeoutPromise,
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // 超时与连接层失败（daemon 未启动/被挡）要分开：面板文案与重试语义都不同
        return { ok: false, code: timedOut ? 'timeout' : 'daemon_offline', message };
      } finally {
        clearTimeout(timer);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return {
          ok: false,
          code: 'daemon_invalid_response',
          message: `响应不是合法 JSON（HTTP ${String(response.status)}）`,
        };
      }

      if (isApiSuccess<{ artifact: ExportArtifact }>(payload)) {
        return { ok: true, artifact: payload.result.artifact };
      }
      if (isApiFailure(payload)) {
        return { ok: false, code: payload.error.code, message: payload.error.message };
      }
      return {
        ok: false,
        code: 'daemon_invalid_response',
        message: `响应信封不符合契约（HTTP ${String(response.status)}）`,
      };
    },
  };
}
