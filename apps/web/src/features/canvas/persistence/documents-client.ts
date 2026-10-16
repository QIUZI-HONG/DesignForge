/**
 * 文档持久化客户端（走 daemon 的 `.dfg` 目录态 API）。
 *
 * 映射口径（与 daemon 的 manifest 约定一致）：
 * - 一个 daemon 文档 ↔ 一个设界文档（Design IR）；设计页 N ↔ `page-{N}`（daemon 的分配规则）；
 * - 页面正文是 **opaque JSON**：本客户端在其中放 `{ $format, $version, page, tokens }`
 *   （daemon 只校验 JSON 可解析，不解析节点语义——归属裁决见 `_shared.md` §2）；
 * - 读回时用引擎的 `parseDocument` 做**结构校验**（悬空引用/多父/环都会在此被打回）。
 */

import { DAEMON_ROUTES } from '@dforge/contracts';
import type { DesignDocument, ScenePage } from '@dforge/engine';
import { createPage, emptyTokenSet, parseDocument, type TokenSet } from '@dforge/engine';

/** 页面正文信封。 */
export interface CanvasPageBody {
  $format: 'dforge.canvas.page';
  $version: 1;
  page: ScenePage;
  tokens: TokenSet;
}

/** 信封标识。 */
export const CANVAS_PAGE_FORMAT = 'dforge.canvas.page' as const;
export const CANVAS_PAGE_VERSION = 1;

/** 客户端选项。 */
export interface DocumentsClientOptions {
  /** daemon 基址（由宿主经 `@/lib/daemon-endpoint` 单点解析后传入；ADR-0004 裁决 ①）。 */
  baseUrl: string;
  /** fetch 实现（测试注入）。 */
  fetchImpl?: typeof fetch;
}

/** 结果形状：调用方只需要「成功/失败 + 原因」。 */
export type ClientResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** 文档客户端。 */
export interface DocumentsClient {
  readonly baseUrl: string;
  createDocument(name: string): Promise<ClientResult<{ id: string; name: string }>>;
  /** 按名查找（幂等保存：同名文档已存在时复用它，而不是报 doc_exists）。 */
  findDocumentByName(name: string): Promise<ClientResult<{ id: string; name: string } | null>>;
  getDocument(
    documentId: string,
  ): Promise<ClientResult<{ id: string; name: string; pageCount: number }>>;
  readPage(documentId: string, pageId: string): Promise<ClientResult<unknown>>;
  savePage(documentId: string, pageId: string, body: unknown): Promise<ClientResult<void>>;
  createPage(documentId: string, name: string): Promise<ClientResult<{ id: string; name: string }>>;
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
      const value = result.value as { document: { id: string; name: string; pageCount: number } };
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
    async createPage(documentId, name) {
      const result = await request(
        DAEMON_ROUTES.documentPageCreate.method,
        routeUrl(base, DAEMON_ROUTES.documentPageCreate.path, { documentId }),
        { name },
      );
      if (!result.ok) return result;
      const value = result.value as { page: { id: string; name: string } };
      return { ok: true, value: value.page };
    },
  };
}

/** 设计页正文编码。 */
export function encodePageBody(document: DesignDocument, page: ScenePage): CanvasPageBody {
  return {
    $format: CANVAS_PAGE_FORMAT,
    $version: CANVAS_PAGE_VERSION,
    page,
    tokens: document.tokens,
  };
}

/** 设计页正文解码（非本格式 → null）。 */
export function decodePageBody(body: unknown): CanvasPageBody | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Partial<CanvasPageBody>;
  if (record.$format !== CANVAS_PAGE_FORMAT) return null;
  if (record.page === undefined) return null;
  return {
    $format: CANVAS_PAGE_FORMAT,
    $version: typeof record.$version === 'number' ? record.$version : CANVAS_PAGE_VERSION,
    page: record.page,
    tokens: record.tokens ?? emptyTokenSet(),
  };
}

/** 设计页 id ↔ daemon 页面 id（daemon 的分配规则：`page-{N}`）。 */
export function daemonPageId(index: number): string {
  return `page-${index + 1}`;
}

/** 保存整个设计文档（逐页 PUT；页面不存在时先创建）。 */
export async function saveDesignDocument(
  client: DocumentsClient,
  documentId: string,
  document: DesignDocument,
): Promise<ClientResult<{ documentId: string; pageIds: string[] }>> {
  const pageIds: string[] = [];
  for (const [index, page] of document.pages.entries()) {
    let pageId = daemonPageId(index);
    const body = encodePageBody(document, page);
    let saved = await client.savePage(documentId, pageId, body);
    if (!saved.ok) {
      // 页面不存在（或首次保存）：按 daemon 的分配规则创建一页再写
      const created = await client.createPage(documentId, page.name);
      if (!created.ok) return created;
      pageId = created.value.id;
      saved = await client.savePage(documentId, pageId, body);
      if (!saved.ok) return saved;
    }
    pageIds.push(pageId);
  }
  return { ok: true, value: { documentId, pageIds } };
}

/**
 * 读取设计文档（顺序探测 `page-{N}` 直到缺失）。
 *
 * **空文档口径**（D-2 闭环的必要一环）：daemon 的「新建设计文件」只写 `{}` 作为页正文
 * （daemon 只做 opaque JSON 存储，不写设计语义）。因此「首屏正文是空对象」= 这份文档
 * 尚无设计内容 → 给一份含一个空页面的文档（页面 id 与 daemon 的 `page-1` 对齐），
 * 用户从首页点开新文件就是**空画布可画**，而不是「结构非法」错误态。
 * 反过来：正文是非空但非本格式的 JSON（外来/损坏内容）仍按结构错误上报——不静默吞掉别人的数据。
 */
export async function loadDesignDocument(
  client: DocumentsClient,
  documentId: string,
): Promise<ClientResult<DesignDocument>> {
  const summary = await client.getDocument(documentId);
  if (!summary.ok) return summary;
  const pages: ScenePage[] = [];
  let tokens: TokenSet | null = null;
  let firstBodyEmpty = false;
  for (let index = 0; index < 64; index += 1) {
    const body = await client.readPage(documentId, daemonPageId(index));
    if (!body.ok) break;
    const decoded = decodePageBody(body.value);
    if (decoded === null) {
      if (index === 0) firstBodyEmpty = isEmptyBody(body.value);
      break;
    }
    pages.push(decoded.page);
    tokens = tokens ?? decoded.tokens;
  }
  if (pages.length === 0 && firstBodyEmpty) {
    // 新建文档的空白首页：名字沿用 daemon 的默认页面名（数据默认值，不是界面文案）
    pages.push(createPage({ id: daemonPageId(0), name: '页面 1' }));
  }
  try {
    const parsed = parseDocument({
      id: documentId,
      name: summary.value.name,
      pages,
      tokens: tokens ?? emptyTokenSet(),
    });
    return { ok: true, value: parsed.document };
  } catch (error) {
    return {
      ok: false,
      error: `文档结构非法：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** 是否为「空正文」（daemon 新建文档的 `{}`；也容忍显式 null）。 */
function isEmptyBody(body: unknown): boolean {
  if (body === null) return true;
  if (typeof body !== 'object') return false;
  return Object.keys(body as Record<string, unknown>).length === 0;
}
