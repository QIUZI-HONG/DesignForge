/**
 * 文档持久化客户端（走 daemon 的 `.dfg` 目录态 API）。
 *
 * 映射口径（与 daemon 的 manifest 约定一致）：
 * - 一个 daemon 文档 ↔ 一个设界文档（Design IR）；**页 id 是身份**——load 按 manifest 的
 *   `pages[]` 读、`page.id` 即 daemon 页 id，save 按 `page.id` 定位（mapping 归 `./page-set`）；
 * - 页面正文是 **opaque JSON**：本客户端在其中放 `{ $format, $version, page, tokens }`
 *   （daemon 只校验 JSON 可解析，不解析节点语义——归属裁决见 `_shared.md` §2）；
 * - 读回时用引擎的 `parseDocument` 做**结构校验**（悬空引用/多父/环都会在此被打回）。
 */

import type { DocumentDetail } from '@dforge/contracts';
import { DAEMON_ROUTES } from '@dforge/contracts';
import type { DesignDocument } from '@dforge/engine';
import { parseDocument } from '@dforge/engine';

import { type ClientResult, isEmptyBody, loadPageSet, planPageSetSave } from './page-set';

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
  savePage(documentId: string, pageId: string, body: unknown): Promise<ClientResult<void>>;
  /** 建页；`options.id` 给定时按该 id 建（保存映射靠它让页 id 成为稳定身份）。 */
  createPage(
    documentId: string,
    name: string,
    options?: { id?: string },
  ): Promise<ClientResult<{ id: string; name: string }>>;
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

  const request = async (
    method: string,
    url: string,
    body?: unknown,
  ): Promise<ClientResult<unknown>> => {
    try {
      const response = await fetchImpl(url, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text.length === 0 ? null : JSON.parse(text);
      } catch {
        return { ok: false, error: `响应不是合法 JSON（HTTP ${response.status}）` };
      }
      const envelope = (parsed ?? {}) as DaemonEnvelope;
      if (!response.ok || envelope.ok === false) {
        return { ok: false, error: failureText(envelope, response.status) };
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
    async savePage(documentId, pageId, body) {
      const result = await request(
        DAEMON_ROUTES.documentPageSave.method,
        routeUrl(base, DAEMON_ROUTES.documentPageSave.path, { documentId, pageId }),
        { body },
      );
      return result.ok ? { ok: true, value: undefined } : result;
    },
    async createPage(documentId, name, options) {
      const result = await request(
        DAEMON_ROUTES.documentPageCreate.method,
        routeUrl(base, DAEMON_ROUTES.documentPageCreate.path, { documentId }),
        { name, ...(options?.id === undefined ? {} : { id: options.id }) },
      );
      if (!result.ok) return result;
      const value = result.value as { page: { id: string; name: string } };
      return { ok: true, value: value.page };
    },
  };
}

/** 保存结果（`pageIds` 与文档页顺序对齐；`orphanPageIds` **只报告不删除**）。 */
export interface SaveDesignDocumentResult {
  documentId: string;
  pageIds: string[];
  orphanPageIds: string[];
}

/**
 * 保存整个设计文档（按 `page.id` 定位页文件；未命中才建页）。
 *
 * 委托 `./page-set` 的计划：页面 id 命中现有页 → update；未命中且 id 合法 → 按该 id
 * create（身份可往返）；非法/重复 → 分配空闲 `page-N`。manifest 里多出来的页只进
 * `orphanPageIds`，**不删除**（数据安全优先）。
 *
 * 唯一例外（保持既有空文档口径）：新建文档只有一个空白占位页（正文 `{}`，用户内容为空的
 * `page-1`）且没有文档页认领它时，把第一页写进该占位页（等价于旧行为「保存进 page-1」），
 * 避免每次新建文档都多出一个空孤儿页。占位页正文非空（有用户数据）则不复用。
 */
export async function saveDesignDocument(
  client: DocumentsClient,
  documentId: string,
  document: DesignDocument,
): Promise<ClientResult<SaveDesignDocumentResult>> {
  const detail = await client.getDocument(documentId);
  if (!detail.ok) return detail;
  const existingPageIds = detail.value.pages.map((page) => page.id);
  const plan = planPageSetSave(document, existingPageIds);
  let orphanPageIds = plan.orphanPageIds;

  if (plan.update.length === 0 && existingPageIds.length === 1 && plan.create.length > 0) {
    const placeholderId = existingPageIds[0] as string;
    const placeholder = await client.readPage(documentId, placeholderId);
    if (placeholder.ok && isEmptyBody(placeholder.value)) {
      const first = plan.create.shift();
      if (first !== undefined) {
        plan.update.push({ pageId: placeholderId, body: first.body, index: first.index });
        orphanPageIds = orphanPageIds.filter((pageId) => pageId !== placeholderId);
      }
    }
  }

  const pageIds: string[] = new Array<string>(document.pages.length).fill('');
  for (const entry of plan.update) {
    const saved = await client.savePage(documentId, entry.pageId, entry.body);
    if (!saved.ok) return saved;
    pageIds[entry.index] = entry.pageId;
  }
  for (const entry of plan.create) {
    const created = await client.createPage(documentId, entry.name, { id: entry.pageId });
    if (!created.ok) return created;
    const saved = await client.savePage(documentId, created.value.id, entry.body);
    if (!saved.ok) return saved;
    pageIds[entry.index] = created.value.id;
  }
  return { ok: true, value: { documentId, pageIds, orphanPageIds } };
}

/**
 * 读取设计文档（按 manifest 的 `pages[]`；委托 `./page-set` 的 loadPageSet）。
 *
 * **空文档口径**（D-2 闭环的必要一环）保持：daemon 的「新建设计文件」只写 `{}` 作为页正文
 * （daemon 只做 opaque JSON 存储，不写设计语义）。因此「页正文是空对象」= 这份文档
 * 尚无设计内容 → 给一份含一页空画布的文档（页 id 沿用 daemon 的 manifest），
 * 用户从首页点开新文件就是**空画布可画**，而不是「结构非法」错误态。
 * 反过来：正文是非空但非本格式的 JSON（外来/损坏内容）仍按结构错误上报——不静默吞掉别人的数据。
 */
export async function loadDesignDocument(
  client: DocumentsClient,
  documentId: string,
): Promise<ClientResult<DesignDocument>> {
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
    return { ok: true, value: parsed.document };
  } catch (error) {
    return {
      ok: false,
      error: `文档结构非法：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
