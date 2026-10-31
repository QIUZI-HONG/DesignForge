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

/** daemon 汇报的页面元数据（manifest 页列表项；顺序 = 页面顺序）。 */
export interface DaemonPageMeta {
  id: string;
  name: string;
}

/** 文档客户端。 */
export interface DocumentsClient {
  readonly baseUrl: string;
  createDocument(name: string): Promise<ClientResult<{ id: string; name: string }>>;
  /** 按名查找（幂等保存：同名文档已存在时复用它，而不是报 doc_exists）。 */
  findDocumentByName(name: string): Promise<ClientResult<{ id: string; name: string } | null>>;
  /** 单文档详情（含 manifest 页列表——保存/读取按此列表逐页寻址，禁止按位置猜 `page-{N}`）。 */
  getDocument(
    documentId: string,
  ): Promise<
    ClientResult<{ id: string; name: string; pageCount: number; pages: DaemonPageMeta[] }>
  >;
  readPage(documentId: string, pageId: string): Promise<ClientResult<unknown>>;
  savePage(documentId: string, pageId: string, body: unknown): Promise<ClientResult<void>>;
  createPage(documentId: string, name: string): Promise<ClientResult<{ id: string; name: string }>>;
  deletePage(documentId: string, pageId: string): Promise<ClientResult<void>>;
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
      const value = result.value as {
        document: { id: string; name: string; pageCount: number };
        pages?: DaemonPageMeta[];
      };
      return {
        ok: true,
        value: {
          ...value.document,
          // manifest 页列表（旧 daemon 无此字段时退回空列表：调用方按「无已知页」处理）
          pages: Array.isArray(value.pages) ? value.pages : [],
        },
      };
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
    async deletePage(documentId, pageId) {
      const result = await request(
        DAEMON_ROUTES.documentPageDelete.method,
        routeUrl(base, DAEMON_ROUTES.documentPageDelete.path, { documentId, pageId }),
      );
      return result.ok ? { ok: true, value: undefined } : result;
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

/**
 * 保存整个设计文档（以 daemon 的 manifest 页列表为寻址真值）。
 *
 * 口径（修复 test-remediation #04 · A4 孤儿页复活/页数无界增长）：
 * - **按位置复用**：设计页 i ↔ daemon 页列表第 i 项的页 id（删页后页 id 跳号，不再与位置同名，
 *   旧实现按位置猜 `page-{N}` 会把内容写错位、旧页留成孤儿）；
 * - **超出即新建**：设计页数多于 daemon 现有页时逐个 createPage（daemon 追加到列表尾部，
 *   位置恰与设计页序对齐）再写正文；
 * - **孤儿页清理**：全部页面写成功后，daemon 页列表中不在保留集里的页（位置超出当前页数的
 *   旧页）逐个删除——页数缩减的保存不留下会复活/无界增长的孤儿页；
 * - 全部以 daemon 汇报的页 id 为准，本函数不做任何 `page-{N}` 猜测。
 */
export async function saveDesignDocument(
  client: DocumentsClient,
  documentId: string,
  document: DesignDocument,
): Promise<ClientResult<{ documentId: string; pageIds: string[] }>> {
  const detail = await client.getDocument(documentId);
  if (!detail.ok) return detail;
  const daemonPages = detail.value.pages;

  const pageIds: string[] = [];
  for (const [index, page] of document.pages.entries()) {
    const existing = daemonPages[index];
    let pageId: string;
    if (existing !== undefined) {
      pageId = existing.id;
    } else {
      // daemon 页不够：新建（追加到列表尾部，位置与设计页序对齐）
      const created = await client.createPage(documentId, page.name);
      if (!created.ok) return created;
      pageId = created.value.id;
    }
    const saved = await client.savePage(documentId, pageId, encodePageBody(document, page));
    if (!saved.ok) return saved;
    pageIds.push(pageId);
  }

  // 孤儿页清理放在全部页面写成功之后：中途失败不动 daemon 既有页，重试幂等
  const kept = new Set(pageIds);
  for (const daemonPage of daemonPages) {
    if (kept.has(daemonPage.id)) continue;
    const removed = await client.deletePage(documentId, daemonPage.id);
    if (!removed.ok) return removed;
  }
  return { ok: true, value: { documentId, pageIds } };
}

/**
 * 读取设计文档（逐页读回 → 引擎 `parseDocument` 结构校验）。
 *
 * 口径（修复 test-remediation #04 · 页 id 位置映射 vs 跳号、64 页硬上限）：
 * - **由 daemon 汇报的 manifest 页列表驱动**：逐项 readPage，页数与顺序以 daemon 为准，
 *   不做任何 `page-{N}` 位置猜测、不设页数上限（旧实现顺序探测到首个缺失即停——
 *   跳号页读不全，且硬编码 64 页截断更大的文档）；
 * - **空文档口径**（D-2 闭环的必要一环）：daemon 的「新建设计文件」只写 `{}` 作为唯一页正文
 *   （daemon 只做 opaque JSON 存储，不写设计语义）。因此「唯一页正文是空对象」= 这份文档
 *   尚无设计内容 → 给一份含一个空页面的文档（页 id/页名以 daemon manifest 汇报为准），
 *   用户从首页点开新文件就是**空画布可画**，而不是「结构非法」错误态；
 * - **不静默吞数据**：manifest 列出的页读不到正文、或正文是非本格式的 JSON（外来/损坏内容）
 *   → 整文档按错误上报（旧实现在首个读不到/解不开的页处静默截断并谎报成功）。
 */
export async function loadDesignDocument(
  client: DocumentsClient,
  documentId: string,
): Promise<ClientResult<DesignDocument>> {
  const summary = await client.getDocument(documentId);
  if (!summary.ok) return summary;
  const daemonPages = summary.value.pages;
  const pages: ScenePage[] = [];
  let tokens: TokenSet | null = null;
  for (const [index, daemonPage] of daemonPages.entries()) {
    const body = await client.readPage(documentId, daemonPage.id);
    if (!body.ok) {
      // manifest 列了这页但正文读不到（克隆/损坏的 .dfg）：整文档报错，不静默截断
      return { ok: false, error: `页面正文不可读（${daemonPage.id}）：${body.error}` };
    }
    const decoded = decodePageBody(body.value);
    if (decoded === null) {
      if (index === 0 && daemonPages.length === 1 && isEmptyBody(body.value)) {
        // 新建文档的空白首页：页 id/页名沿用 daemon manifest 汇报（数据真值，不是界面文案）
        pages.push(createPage({ id: daemonPage.id, name: daemonPage.name }));
        continue;
      }
      return {
        ok: false,
        error: `文档结构非法：页面 ${daemonPage.id}（${daemonPage.name}）的正文不是设界画布格式（外来/损坏内容）`,
      };
    }
    pages.push(decoded.page);
    tokens = tokens ?? decoded.tokens;
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
