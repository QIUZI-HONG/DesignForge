/**
 * 文档持久化客户端（走 daemon 的 `.dfg` 目录态 API）。
 *
 * 映射口径（与 daemon 的 manifest 约定一致）：
 * - 一个 daemon 文档 ↔ 一个设界文档（Design IR）；**页 id 是身份**——load 按 manifest 的
 *   `pages[]` 读、`page.id` 即 daemon 页 id，save 按 `page.id` 定位（mapping 归 `./page-set`）；
 * - 页面正文是 **opaque JSON**：本客户端在其中放 `{ $format, $version, page, tokens }`
 *   （daemon 只校验 JSON 可解析，不解析节点语义——归属裁决见 `_shared.md` §2）；
 * - 读回时用引擎的 `parseDocument` 做**结构校验**（悬空引用/多父/环都会在此被打回）；
 * - 每个请求有超时上限（audit-d04 · D-04，`lib/request-timeout` 单点机制）——daemon
 *   「活着但不响应」时保存链有界失败，不再永久「保存中…」。
 */

import type { DocumentDetail } from '@dforge/contracts';
import { DAEMON_ROUTES, DF_REVISION_HEADER, formatRevisionHeader } from '@dforge/contracts';
import type { DesignDocument } from '@dforge/engine';
import { parseDocument } from '@dforge/engine';

import { daemonAuthHeaders } from '@/lib/daemon-endpoint';
import {
  DAEMON_REQUEST_TIMEOUT_MS,
  fetchWithinDeadline,
  RequestTimeoutError,
} from '@/lib/request-timeout';
import { type ClientResult, loadPageSet, planPageSetSave } from './page-set';

export type { CanvasPageBody, ClientResult } from './page-set';
// 正文信封与编解码随 mapping module 迁至 `./page-set`；此处保持既有导入路径向后兼容。
export {
  CANVAS_PAGE_FORMAT,
  CANVAS_PAGE_VERSION,
  decodePageBody,
  encodePageBody,
} from './page-set';

/** 客户端选项。 */
export interface DocumentsClientOptions {
  /** daemon 基址（由宿主经 `@/lib/daemon-endpoint` 单点解析后传入；ADR-0004 裁决 ①）。 */
  baseUrl: string;
  /** fetch 实现（测试注入）。 */
  fetchImpl?: typeof fetch;
  /** 单请求超时上限（毫秒；测试注入小值。缺省见 `DAEMON_REQUEST_TIMEOUT_MS`——audit-d04 · D-04）。 */
  timeoutMs?: number;
}

/** 文档客户端。 */
export interface DocumentsClient {
  readonly baseUrl: string;
  createDocument(name: string): Promise<ClientResult<{ id: string; name: string }>>;
  /** 按名查找（幂等保存：同名文档已存在时复用它，而不是报 doc_exists）。 */
  findDocumentByName(name: string): Promise<ClientResult<{ id: string; name: string } | null>>;
  /** 文档详情（摘要 + manifest 页清单——load 按页 id 读取的依据）。 */
  getDocument(documentId: string): Promise<ClientResult<DocumentDetail>>;
  readPage(documentId: string, pageId: string): Promise<ClientResult<unknown>>;
  /**
   * 保存页面正文（audit-d06 · D-05 支持条件保存）：`options.ifMatchRevision` 给定时以
   * `If-Match: <revision>` 发出（基线过期 → 409 `doc_revision_conflict`，结果的
   * `code` 带码）；成功返回写入后的文档 revision（旧 daemon 缺字段 → null）。
   */
  savePage(
    documentId: string,
    pageId: string,
    body: unknown,
    options?: { ifMatchRevision?: number },
  ): Promise<ClientResult<{ revision: number | null }>>;
  /**
   * 建页；`options.id` 给定时按该 id 建（保存映射靠它让页 id 成为稳定身份）。
   * `options.ifMatchRevision` 同 savePage 的条件保存语义。
   */
  createPage(
    documentId: string,
    name: string,
    options?: { id?: string; ifMatchRevision?: number },
  ): Promise<ClientResult<{ id: string; name: string; revision: number | null }>>;
}

/** 由路由模板与参数拼 URL。 */
export function routeUrl(
  baseUrl: string,
  template: string,
  params: Record<string, string> = {},
): string {
  let path = template;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`:${key}`, encodeURIComponent(value));
  }
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/**
 * daemon 响应信封（`apps/daemon/src/http.ts` 的 `sendOk/sendFail` 形状）。
 * 注意两点：
 * - 成功载荷字段名是 **result**（不是 data）——写错会静默拿到整个信封，随后在 `.id` 上炸；
 * - 失败是**嵌套**的 `error: { code, message, details }`（契约 `apiFailure`）——
 *   只看顶层 `code/message` 会把原因丢成「HTTP 404：请求失败」，用户看不到「文档不存在」这类真因。
 */
interface DaemonEnvelope {
  ok?: boolean;
  result?: unknown;
  data?: unknown;
  error?: { code?: string; message?: string };
  code?: string;
  message?: string;
}

/** 失败信封 → 「码：人话」文本（取不到码时退回 HTTP 状态，绝不硬编「请求失败」冒充原因）。 */
function failureText(envelope: DaemonEnvelope, status: number): string {
  const code = envelope.error?.code ?? envelope.code;
  const message = envelope.error?.message ?? envelope.message;
  if (code !== undefined && message !== undefined) return `${code}：${message}`;
  if (code !== undefined) return `${code}：请求失败`;
  if (message !== undefined) return `HTTP ${status}：${message}`;
  return `HTTP ${status}：请求失败`;
}

/** 创建客户端。 */
export function createDocumentsClient(options: DocumentsClientOptions): DocumentsClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? DAEMON_REQUEST_TIMEOUT_MS;

  const request = async (
    method: string,
    url: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<ClientResult<unknown>> => {
    try {
      // 本地令牌鉴权（audit-d02 · D-02）：鉴权头单点解析，无令牌 → 空对象。
      // 请求带超时上限（audit-d04 · D-04）：daemon「活着但不响应」时保存不得永久
      // pending——到点 abort 在飞请求并以 {@link RequestTimeoutError} 落为有界失败
      // （错误文案归网络族 → 保存态渲染统一人话 + 可重试，见 save-control）。
      const response = await fetchWithinDeadline(
        fetchImpl,
        url,
        {
          method,
          ...(body === undefined
            ? { headers: { ...daemonAuthHeaders(), ...extraHeaders } }
            : {
                headers: {
                  'content-type': 'application/json',
                  ...daemonAuthHeaders(),
                  ...extraHeaders,
                },
                body: JSON.stringify(body),
              }),
        },
        timeoutMs,
        (ms) => new RequestTimeoutError(ms),
      );
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text.length === 0 ? null : JSON.parse(text);
      } catch {
        return { ok: false, error: `响应不是合法 JSON（HTTP ${response.status}）` };
      }
      const envelope = (parsed ?? {}) as DaemonEnvelope;
      if (!response.ok || envelope.ok === false) {
        // code（audit-d06 · D-05）：daemon 统一错误码随结果透出——保存链据此把
        // doc_revision_conflict 走独立冲突文案（不与网络族/通用失败混同）
        const code = envelope.error?.code ?? envelope.code;
        return {
          ok: false,
          error: failureText(envelope, response.status),
          ...(code === undefined ? {} : { code }),
        };
      }
      return { ok: true, value: envelope.result ?? envelope.data ?? parsed };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  return {
    baseUrl: base,
    async createDocument(name) {
      const result = await request(
        DAEMON_ROUTES.documentCreate.method,
        routeUrl(base, DAEMON_ROUTES.documentCreate.path),
        { name },
      );
      if (!result.ok) return result;
      const value = result.value as { document: { id: string; name: string } };
      return { ok: true, value: { id: value.document.id, name: value.document.name } };
    },
    async findDocumentByName(name) {
      const result = await request(
        DAEMON_ROUTES.documents.method,
        routeUrl(base, DAEMON_ROUTES.documents.path),
      );
      if (!result.ok) return result;
      const value = result.value as { documents: Array<{ id: string; name: string }> };
      const hit = value.documents.find((item) => item.name === name);
      return { ok: true, value: hit === undefined ? null : { id: hit.id, name: hit.name } };
    },
    async getDocument(documentId) {
      const result = await request(
        DAEMON_ROUTES.documentGet.method,
        routeUrl(base, DAEMON_ROUTES.documentGet.path, { documentId }),
      );
      if (!result.ok) return result;
      const value = result.value as { document: DocumentDetail };
      return { ok: true, value: value.document };
    },
    async readPage(documentId, pageId) {
      const result = await request(
        DAEMON_ROUTES.documentPageGet.method,
        routeUrl(base, DAEMON_ROUTES.documentPageGet.path, { documentId, pageId }),
      );
      if (!result.ok) return result;
      const value = result.value as { body: unknown };
      return { ok: true, value: value.body };
    },
    async savePage(documentId, pageId, body, saveOptions) {
      // 条件保存（audit-d06 · D-05）：基线给定时发 If-Match（revision 头值单一判据在 contracts）
      const ifMatchRevision = saveOptions?.ifMatchRevision;
      const result = await request(
        DAEMON_ROUTES.documentPageSave.method,
        routeUrl(base, DAEMON_ROUTES.documentPageSave.path, { documentId, pageId }),
        { body },
        ifMatchRevision === undefined
          ? undefined
          : { [DF_REVISION_HEADER]: formatRevisionHeader(ifMatchRevision) },
      );
      if (!result.ok) return result;
      const value = result.value as { revision?: unknown };
      return {
        ok: true,
        // 旧 daemon 无 revision 字段 → null（冲突检测降级关闭，行为同旧客户端）
        value: { revision: typeof value.revision === 'number' ? value.revision : null },
      };
    },
    async createPage(documentId, name, options) {
      const ifMatchRevision = options?.ifMatchRevision;
      const result = await request(
        DAEMON_ROUTES.documentPageCreate.method,
        routeUrl(base, DAEMON_ROUTES.documentPageCreate.path, { documentId }),
        { name, ...(options?.id === undefined ? {} : { id: options.id }) },
        ifMatchRevision === undefined
          ? undefined
          : { [DF_REVISION_HEADER]: formatRevisionHeader(ifMatchRevision) },
      );
      if (!result.ok) return result;
      const value = result.value as { page: { id: string; name: string }; revision?: unknown };
      return {
        ok: true,
        value: {
          id: value.page.id,
          name: value.page.name,
          revision: typeof value.revision === 'number' ? value.revision : null,
        },
      };
    },
  };
}

/** 保存结果（`pageIds` 与文档页顺序对齐；`orphanPageIds` **只报告不删除**）。 */
export interface SaveDesignDocumentResult {
  documentId: string;
  pageIds: string[];
  orphanPageIds: string[];
  /**
   * 保存完成后的文档 revision（下次保存的基线；audit-d06 · D-05）。
   * 上游未提供 revision（旧 daemon）或本次零写入且无基线 → null：冲突检测降级关闭。
   */
  revision: number | null;
}

/** 保存选项（audit-d06 · D-05 条件保存）。 */
export interface SaveDesignDocumentOptions {
  /**
   * 保存基线 revision：载入时刻的文档 revision（会话「基于哪一版改的」）。
   * 给定数字 → 每个写请求带 `If-Match`（基线过期 → 409 `doc_revision_conflict`，整次
   * 保存中止，不覆盖他人更新）；`null` / 未给 → 旧行为（last-write-wins）——
   * 未落盘文档的首次落盘（会话从未载入过该文档）即走这一档。
   */
  baselineRevision?: number | null;
}

/**
 * 保存整个设计文档（按 `page.id` 定位页文件；未命中才建页）。
 *
 * 委托 `./page-set` 的计划：页面 id 命中现有页 → update；未命中且 id 合法 → 按该 id
 * create（身份可往返）；非法/重复 → 分配空闲 `page-N`。manifest 里多出来的页只进
 * `orphanPageIds`，**不删除**（数据安全优先）。
 *
 * 条件保存的基线推进（audit-d06 · D-05）：保存是多写串行（逐页 PUT/POST），每次成功写
 * 的响应 revision 成为下一写的 If-Match——同一次保存从第二写起不会误伤自己；任一写
 * 收到冲突即中止（后续页不再发出），先写者的内容原样保留（J8 静默覆盖不再发生）。
 *
 * 为什么不再「把第一页塞进新建文档的空白占位页」：那会把正文写进 `page-1` 而内存页 id
 * 仍是调用方的 id（如 `page-editor`），下一次保存/导出就会错位（重复建页或 404）。
 * 身份一致优先——编辑器侧默认页 id 已对齐 `page-1`（引擎缺省），新建文档的首存自然命中
 * 占位页；自定义页 id 的文档按自身 id 建页，`page-1` 只作为孤儿被报告。
 */
export async function saveDesignDocument(
  client: DocumentsClient,
  documentId: string,
  document: DesignDocument,
  options?: SaveDesignDocumentOptions,
): Promise<ClientResult<SaveDesignDocumentResult>> {
  const detail = await client.getDocument(documentId);
  if (!detail.ok) return detail;
  const existingPageIds = detail.value.pages.map((page) => page.id);
  const plan = planPageSetSave(document, existingPageIds);
  const orphanPageIds = plan.orphanPageIds;

  /** 当前 If-Match 基线：null = 旧行为（不带条件头）。每次成功写后推进到响应 revision。 */
  let expectedRevision: number | null = options?.baselineRevision ?? null;
  /** 是否已发生写入；最后一次成功写响应的 revision（旧上游缺字段 → null，不谎报基线）。 */
  let performedWrite = false;
  let lastWriteRevision: number | null = null;
  const advance = (revision: unknown): void => {
    performedWrite = true;
    if (typeof revision === 'number') {
      lastWriteRevision = revision;
      expectedRevision = revision;
    }
  };

  const pageIds: string[] = new Array<string>(document.pages.length).fill('');
  for (const entry of plan.update) {
    const saved = await client.savePage(
      documentId,
      entry.pageId,
      entry.body,
      expectedRevision === null ? undefined : { ifMatchRevision: expectedRevision },
    );
    if (!saved.ok) return saved;
    advance(saved.value.revision);
    pageIds[entry.index] = entry.pageId;
  }
  for (const entry of plan.create) {
    const created = await client.createPage(
      documentId,
      entry.name,
      expectedRevision === null
        ? { id: entry.pageId }
        : { id: entry.pageId, ifMatchRevision: expectedRevision },
    );
    if (!created.ok) return created;
    advance(created.value.revision);
    const saved = await client.savePage(
      documentId,
      created.value.id,
      entry.body,
      expectedRevision === null ? undefined : { ifMatchRevision: expectedRevision },
    );
    if (!saved.ok) return saved;
    advance(saved.value.revision);
    pageIds[entry.index] = created.value.id;
  }
  // 有写入：基线 = 最后一次成功写响应的 revision（旧上游缺字段 → null，诚实降级）；
  // 零写入（无可写页）：基线不变（原基线优先，否则退回读详情时刻的 revision）
  const finalRevision = performedWrite
    ? lastWriteRevision
    : (expectedRevision ??
      (typeof detail.value.revision === 'number' ? detail.value.revision : null));
  return { ok: true, value: { documentId, pageIds, orphanPageIds, revision: finalRevision } };
}

/**
 * 读取设计文档（按 manifest 的 `pages[]`；委托 `./page-set` 的 loadPageSet）。
 *
 * **空文档口径**（D-2 闭环的必要一环）保持：daemon 的「新建设计文件」只写 `{}` 作为页正文
 * （daemon 只做 opaque JSON 存储，不写设计语义）。因此「页正文是空对象」= 这份文档
 * 尚无设计内容 → 给一份含一页空画布的文档（页 id 沿用 daemon 的 manifest），
 * 用户从首页点开新文件就是**空画布可画**，而不是「结构非法」错误态。
 * 反过来：正文是非空但非本格式的 JSON（外来/损坏内容）仍按结构错误上报——不静默吞掉别人的数据。
 *
 * 返回值带载入时刻的 `revision`（保存冲突检测的基线，audit-d06 · D-05）——
 * 上游未提供（旧 daemon）→ null，条件保存降级关闭。
 */
export async function loadDesignDocument(
  client: DocumentsClient,
  documentId: string,
): Promise<ClientResult<{ document: DesignDocument; revision: number | null }>> {
  const loaded = await loadPageSet(client, documentId);
  if (!loaded.ok) return loaded;
  if (loaded.value.unresolvedPageIds.length > 0) {
    return {
      ok: false,
      error: `文档页文件缺失或不可读：${loaded.value.unresolvedPageIds.join('、')}`,
    };
  }
  try {
    const parsed = parseDocument({
      id: documentId,
      name: loaded.value.name,
      pages: loaded.value.pages.map((entry) => entry.page),
      tokens: loaded.value.tokens,
    });
    return { ok: true, value: { document: parsed.document, revision: loaded.value.revision } };
  } catch (error) {
    return {
      ok: false,
      error: `文档结构非法：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
