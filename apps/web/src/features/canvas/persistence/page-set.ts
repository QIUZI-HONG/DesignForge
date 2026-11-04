/**
 * 页面集合 ⇄ 页文件集合的 mapping module（arch-01 · 候选 1）。
 *
 * 缺陷现场（修复前）：`documents-client.ts` 按**数组下标**拼 `page-{index+1}` 并顺序探测，
 * 首个 404 即 `break`；daemon 建页跳号分配、引擎缺省 id 又是 `page_1`（下划线）。
 * 结果：页集有洞（如 `[page-1, page-3]`）时 load 截断为 1 页，save 新建 `page-4`
 * 并把原 `page-3` 变孤儿。
 *
 * 本 module 的**唯一不变量**：**页 id 是身份，不是位置**。
 * - load 按 daemon manifest 的 `pages[]` 逐页读；返回的 `page.id` = daemon 页 id；
 * - save 按 `page.id` 定位页文件（命中即 update，未命中才 create，新页优先沿用自身 id）；
 * - 非法/缺失 `page.id` 的页两次落盘必须落到同一页文件（会话内稳定映射 + 孤儿优先复用），
 *   否则每次保存都会新建 `page-N` 并让上一份变孤儿，页集无上限增长；
 * - manifest 里存在而文档里没有的页**只报告**（`orphanPageIds`），绝不静默删除用户数据。
 *
 * 取向：本 module 只认识「页文件集合」这一窄端口（`PageSetClient`），
 * 不依赖完整 DocumentsClient，便于单独测试与复用。
 */

import type { DfgPageMeta, DocumentDetail } from '@dforge/contracts';
import { DEFAULT_PAGE_NAME, isPageFileId, pageFileId } from '@dforge/contracts';
import type { DesignDocument, ScenePage, TokenSet } from '@dforge/engine';
import { createPage, emptyTokenSet } from '@dforge/engine';

/** 结果形状：调用方只需要「成功/失败 + 原因」（与 documents-client 的 ClientResult 同形）。 */
export type ClientResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** 页面正文信封（daemon 侧是 opaque JSON）。 */
export interface CanvasPageBody {
  $format: 'dforge.canvas.page';
  $version: 1;
  page: ScenePage;
  tokens: TokenSet;
}

/** 信封标识。 */
export const CANVAS_PAGE_FORMAT = 'dforge.canvas.page' as const;
export const CANVAS_PAGE_VERSION = 1;

/** mapping module 需要的窄端口（DocumentsClient 结构性满足）。 */
export interface PageSetClient {
  getDocument(documentId: string): Promise<ClientResult<DocumentDetail>>;
  readPage(documentId: string, pageId: string): Promise<ClientResult<unknown>>;
  createPage(
    documentId: string,
    name: string,
    options?: { id?: string },
  ): Promise<ClientResult<{ id: string; name: string }>>;
  savePage(documentId: string, pageId: string, body: unknown): Promise<ClientResult<void>>;
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

/** 是否为「空正文」（daemon 新建文档的 `{}`；也容忍显式 null）。 */
export function isEmptyBody(body: unknown): boolean {
  if (body === null) return true;
  if (typeof body !== 'object') return false;
  return Object.keys(body as Record<string, unknown>).length === 0;
}

/** load 结果里的一页：`page.id` 已对齐为 daemon 页 id。 */
export interface LoadedPage {
  page: ScenePage;
  pageId: string;
}

/** loadPageSet 结果。 */
export interface PageSetLoad {
  name: string;
  pages: LoadedPage[];
  /** manifest 列出但正文读不出/不可用的页（不静默丢，交由上层决策）。 */
  unresolvedPageIds: string[];
  /** 文档级令牌（取首个可解码页正文里的 tokens；全空文档 → 空令牌集）。 */
  tokens: TokenSet;
}

/**
 * 读取页面集合（**按 manifest 的 `pages[]`**，不按下标探测）。
 *
 * 空文档口径不变：新建文档的页正文是 `{}`（daemon 只做 opaque JSON 存储）→ 给一页空画布，
 * 页 id 沿用 manifest 的页 id。非空但非本格式的正文 → 结构错误（不吞别人的数据）。
 * manifest 列出但正文读不出 → 记入 `unresolvedPageIds`，其余页照常返回。
 */
export async function loadPageSet(
  client: PageSetClient,
  documentId: string,
): Promise<ClientResult<PageSetLoad>> {
  const summary = await client.getDocument(documentId);
  if (!summary.ok) return summary;
  const manifestPages: DfgPageMeta[] | undefined = summary.value.pages;
  if (!Array.isArray(manifestPages)) {
    return {
      ok: false,
      error: 'daemon 文档详情缺少 pages（版本不匹配：需要含 manifest 页清单的 GET /documents/:id）',
    };
  }

  const pages: LoadedPage[] = [];
  const unresolvedPageIds: string[] = [];
  let tokens: TokenSet | null = null;

  for (const meta of manifestPages) {
    const body = await client.readPage(documentId, meta.id);
    if (!body.ok) {
      unresolvedPageIds.push(meta.id);
      continue;
    }
    const decoded = decodePageBody(body.value);
    if (decoded === null) {
      if (!isEmptyBody(body.value)) {
        return {
          ok: false,
          error: `页面正文不是本画布格式（${meta.id}）：期望 $format=${CANVAS_PAGE_FORMAT}`,
        };
      }
      // 新建设计文件的空白页：页 id 用 manifest 的 id，名字沿用 daemon 的页名（数据默认值）
      pages.push({
        pageId: meta.id,
        page: createPage({
          id: meta.id,
          name: meta.name.length > 0 ? meta.name : DEFAULT_PAGE_NAME,
        }),
      });
      continue;
    }
    tokens = tokens ?? decoded.tokens;
    // 不变量：页 id 来自页文件集合（正文里的旧 id 不冒充身份）
    pages.push({ pageId: meta.id, page: { ...decoded.page, id: meta.id } });
  }

  return {
    ok: true,
    value: {
      name: summary.value.name,
      pages,
      unresolvedPageIds,
      tokens: tokens ?? emptyTokenSet(),
    },
  };
}

/** save 计划里的新建页。 */
export interface PageSetCreate {
  pageId: string;
  name: string;
  body: CanvasPageBody;
  /** 对应文档里的页序号（执行完成后据此还原 `pageIds` 顺序）。 */
  index: number;
}

/** save 计划里的更新页。 */
export interface PageSetUpdate {
  pageId: string;
  body: CanvasPageBody;
  /** 对应文档里的页序号。 */
  index: number;
}

/** save 计划。 */
export interface PageSetSavePlan {
  create: PageSetCreate[];
  update: PageSetUpdate[];
  /** manifest 里存在、但当前文档已没有的页——**只报告，不删除**。 */
  orphanPageIds: string[];
}

/** 取首个未被占用的 `page-{N}`。 */
function nextFreePageId(taken: ReadonlySet<string>): string {
  for (let index = 0; ; index += 1) {
    const candidate = pageFileId(index);
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * 会话内稳定映射：同一页面对象再次保存时必须复用上次分配的页 id。
 *
 * 键是**页面对象**而不是 `page.id`——非法 id 页面的 `page.id` 在会话内原样不动，
 * 拿它当键会把「同一页的多次保存」与「两个都带同一个非法 id 的不同页」混为一谈。
 * WeakMap 不延长页面对象寿命（文档关闭/导出后映射随对象回收）。
 */
const assignedPageIds = new WeakMap<ScenePage, string>();

/** 页 id 升序：`page-{N}` 按数字序，其余按字典序（孤儿复用顺序稳定、可预测）。 */
function comparePageIds(left: string, right: string): number {
  const rank = (pageId: string): number => {
    const match = /^page-(\d+)$/.exec(pageId);
    return match === null ? Number.POSITIVE_INFINITY : Number(match[1]);
  };
  const delta = rank(left) - rank(right);
  if (delta !== 0 && !Number.isNaN(delta)) return delta;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * 计算保存计划（不读写页文件；只读会话内的稳定映射）。
 *
 * - `page.id` 命中 `existingPageIds` → update 该 id（**按身份定位**，位置无关）；
 * - 未命中且自身 id 是合法页文件 id → create 并沿用该 id（身份可往返）；
 * - 非法/重复 id → 优先复用 manifest 中未被合法页 id 认领的孤儿页 id（升序），
 *   用尽才 create 首个空闲 `page-N`；
 * - 同一页面对象上次分配过 id → 本轮继续用它（不再重新分配）；
 * - `existingPageIds` 中未被任何文档页认领的 → `orphanPageIds`（不删）。
 */
export function planPageSetSave(
  document: DesignDocument,
  existingPageIds: readonly string[],
): PageSetSavePlan {
  const existing = new Set(existingPageIds);
  const taken = new Set(existingPageIds);
  const claimed = new Set<string>();
  const reserved = new Set<string>();
  const preferred: Array<string | null> = document.pages.map(() => null);

  // 第一轮：合法自身 id 全局优先（身份可往返；重复 id 只有首个认领）。
  document.pages.forEach((page, index) => {
    if (isPageFileId(page.id) && !reserved.has(page.id)) {
      reserved.add(page.id);
      preferred[index] = page.id;
    }
  });
  // 第二轮：没有可用自身 id 的页，复用会话内上次分配的 id。
  document.pages.forEach((page, index) => {
    if (preferred[index] !== null) return;
    const stableId = assignedPageIds.get(page);
    if (stableId !== undefined && isPageFileId(stableId) && !reserved.has(stableId)) {
      reserved.add(stableId);
      preferred[index] = stableId;
    }
  });

  // 孤儿池：manifest 中未被文档页（自身合法 id / 会话稳定 id）认领的既有页 id。
  const orphanPool = existingPageIds.filter((pageId) => !reserved.has(pageId)).sort(comparePageIds);
  let orphanCursor = 0;

  const create: PageSetCreate[] = [];
  const update: PageSetUpdate[] = [];

  document.pages.forEach((page, index) => {
    const body = encodePageBody(document, page);
    const preferredId = preferred[index] ?? null;
    let pageId: string;
    if (preferredId !== null) {
      pageId = preferredId;
    } else {
      const orphanId = orphanPool[orphanCursor];
      if (orphanId === undefined) {
        pageId = nextFreePageId(taken);
      } else {
        orphanCursor += 1;
        pageId = orphanId;
      }
    }
    taken.add(pageId);
    claimed.add(pageId);
    assignedPageIds.set(page, pageId);
    // 命中既有页（含复用孤儿）走 update；否则 create 并沿用分配到的 id。
    if (existing.has(pageId)) update.push({ pageId, body, index });
    else create.push({ pageId, name: page.name, body, index });
  });

  return {
    create,
    update,
    orphanPageIds: existingPageIds.filter((pageId) => !claimed.has(pageId)),
  };
}
