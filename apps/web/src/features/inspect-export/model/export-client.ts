/**
 * 导出客户端：daemon `POST /export`（PNG / SVG / PDF 三档）。
 *
 * 分工：本模块只管**传输与解包**（信封、错误码、超时、离线），不碰 UI 状态；
 * 面板按 `ExportOutcome` 的 `code` 分派「失败态 / 离线态 / 重试」。
 * 路由与错误码一律取 `@dforge/contracts`（避免路径/码字符串各写一份漂移）。
 *
 * 超时机制（quality-p1 · B8）：接 `@/lib/request-timeout` 的总预算单点
 * `fetchWithinTotalDeadline`——建连、响应头与正文读取共用同一条上限（race + abort；
 * 不理会 signal 的测试替身/宿主实现同样被 race 界住），不再手写第二份 deadline 实现。
 * 失败文案经 i18n 目录（键 `editor.export.client.*`，zh-CN/en 同键），公开错误形状不变。
 */

import {
  DAEMON_ROUTES,
  type ExportArtifact,
  type ExportRequest,
  isApiFailure,
  isApiSuccess,
} from '@dforge/contracts';
import { t } from '@/i18n';
import { daemonAuthHeaders, resolveDaemonEndpointSync } from '@/lib/daemon-endpoint';
import {
  fetchWithinTotalDeadline,
  RequestTimeoutError,
  type TotalDeadlineResponse,
} from '@/lib/request-timeout';

/** 客户端结果：成功给产物；失败给稳定错误码 + 文案（面板映射为文案）。 */
export type ExportOutcome =
  | { ok: true; artifact: ExportArtifact }
  | { ok: false; code: string; message: string };

/** 客户端选项。 */
export interface ExportClientOptions {
  /** daemon 基址（缺省经 `@/lib/daemon-endpoint` 单点解析；ADR-0004 裁决 ①）。 */
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

/**
 * 缺省基址：经 `@/lib/daemon-endpoint` 全站单点解析
 * （`?daemon=` → `NEXT_PUBLIC_DF_DAEMON_URL` → 缺省端口窗起点；ADR-0004 裁决 ①）——
 * 本模块不另立端口口径，宿主仍可经 `baseUrl` 显式覆盖。
 */
export function defaultDaemonBaseUrl(): string {
  return resolveDaemonEndpointSync();
}

/** 正文读取失败哨兵（`response.json()` 解析异常 → 归一 invalid-response，不悬挂）。 */
const READ_FAILED: unique symbol = Symbol('export.readFailed');

/** 构造导出客户端。 */
export function createExportClient(options: ExportClientOptions = {}): ExportClient {
  const baseUrl = options.baseUrl ?? defaultDaemonBaseUrl();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async exportDocument(request: ExportRequest): Promise<ExportOutcome> {
      let deadline: TotalDeadlineResponse | null = null;
      try {
        // 总预算单点（B8）：headers + 正文同一上限；到点 abort 在飞请求并抛超时哨兵——
        // 即使 fetch 实现不理会 signal（测试替身/其他运行时），race 也保证必然落定。
        deadline = await fetchWithinTotalDeadline(
          doFetch,
          `${baseUrl}${DAEMON_ROUTES.exportDocument.path}`,
          {
            method: DAEMON_ROUTES.exportDocument.method,
            headers: { 'content-type': 'application/json', ...daemonAuthHeaders() },
            body: JSON.stringify(request),
          },
          timeoutMs,
          (ms) => new RequestTimeoutError(ms),
        );
        // 正文读取并入同一预算：滴流挂死的正文到点按 timeout 落定（旧实现 json() 无界悬挂）。
        // 解析异常经哨兵归一（落定为值而非拒绝），超时胜出后也不会留下 unhandled rejection。
        const reading = deadline.response.json().catch(() => READ_FAILED) as Promise<unknown>;
        const payload = await Promise.race([reading, deadline.timeout]);

        if (payload === READ_FAILED) {
          return {
            ok: false,
            code: 'daemon_invalid_response',
            message: t('editor.export.client.invalidJson', { status: deadline.response.status }),
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
          message: t('editor.export.client.invalidEnvelope', { status: deadline.response.status }),
        };
      } catch (error) {
        // 超时与连接层失败（daemon 未启动/被挡）要分开：面板文案与重试语义都不同
        if (error instanceof RequestTimeoutError) {
          return { ok: false, code: 'timeout', message: error.message };
        }
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, code: 'daemon_offline', message };
      } finally {
        deadline?.dispose(); // 正文已落定（或已按超时放弃）：撤掉计时器与监听
      }
    },
  };
}
