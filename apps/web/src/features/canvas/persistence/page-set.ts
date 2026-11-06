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

/**
 * 结果形状：调用方只需要「成功/失败 + 原因」（与 documents-client 的 ClientResult 同形）。
 *
 * `code`（audit-d06 · D-05）：daemon 统一错误码（信封 `error.code`）——条件保存的
 * `doc_revision_conflict` 靠它在界面层走独立冲突文案（不落网络族/通用失败形态）；
 * 传输层失败（fetch/超时）没有信封码 → 缺省该键。
 */
export type ClientResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code?: string };

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

/**
 * mapping module 需要的窄端口（DocumentsClient 结构性满足）。
 *
 * 条件保存（audit-d06 · D-05）：`ifMatchRevision` 给定时以 `If-Match: <revision>` 发出
 * （daemon 提交锁内比对，基线过期 → 409 `doc_revision_conflict`）；成功返回写入后的
 * 文档 revision——保存链据此把基线推进到最新（下一写不误伤自己）。
 */
export interface PageSetClient {
  getDocument(documentId: string): Promise<ClientResult<DocumentDetail>>;
  readPage(documentId: string, pageId: string): Promise<ClientResult<unknown>>;
  createPage(
    documentId: string,
    name: string,
    options?: { id?: string; ifMatchRevision?: number },
  ): Promise<ClientResult<{ id: string; name: string; revision: number | null }>>;
  savePage(
    documentId: string,
    pageId: string,
    body: unknown,
    options?: { ifMatchRevision?: number },
  ): Promise<ClientResult<{ revision: number | null }>>;
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
  /**
   * 载入时刻的文档 revision（保存冲突检测的基线；audit-d06 · D-05）。
   * 上游未提供（旧 daemon）→ null：条件保存降级关闭，行为同旧客户端。
   */
  revision: number | null;
}

/**
 * 读取页面集合（**按 manifest 的 `pages[]`**，不按下标探测）。
 *
 * 空文档口径不变：新建文档的页正文是 `{}`（daemon 只做 opaque JSON 存储）→ 给一页空画布，
 * 页 id 沿用 manifest 的页 id。非空但非本格式的正文 → 结构错误（不吞别人的数据）。
 * manifest 列出但正文读不出 → 记入 `unresolvedPageIds`，其余页照常返回。
 *
 * 旧文档兼容（audit-d01 · D-01）：历史构建把夹具页落成 `page_1`，daemon 占位页 `page-1`
 * 成了空占位页且排在 manifest 前列——当前页（会话初始页 = `pages[0]`）会落到空页上，
 * 用户看到「内容丢失」。这里把**空占位页沉到页集末尾**（有内容页在前，组内保持 manifest
 * 顺序）：占位页没有数据可丢，不违反「不静默删数据」；页 id 校验逻辑不动。
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

  /** 有内容的页（正文可解码）——排在页集前部，当前页从这里选。 */
  const contentPages: LoadedPage[] = [];
  /** 空占位页（daemon 新建档的 `{}` 正文；无数据，沉到页集末尾）。 */
  const placeholderPages: LoadedPage[] = [];
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
      placeholderPages.push({
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
    contentPages.push({ pageId: meta.id, page: { ...decoded.page, id: meta.id } });
  }

  return {
    ok: true,
    value: {
      name: summary.value.name,
      // 空占位页不排前（旧文档兼容）：当前页 = 有内容的页；全占位/全内容时顺序不变
      pages: [...contentPages, ...placeholderPages],
      unresolvedPageIds,
      tokens: tokens ?? emptyTokenSet(),
      // 载入基线（audit-d06 · D-05）：上游缺 revision 字段（旧 daemon）→ null 降级
      revision:
        typeof summary.value.revision === 'number' ? summary.value.revision : null,
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

/**
 * 页 id 的大小写归一键——与 daemon `documents/store.ts` 的占用判定同口径
 * （macOS/Windows 大小写不敏感文件系统上 `PAGE-1` 与 `page-1` 是同一页文件）。
 */
function foldPageId(pageId: string): string {
  return pageId.toLowerCase();
}

/** 取首个未被占用的 `page-{N}`（`taken` 为**归一后**的 id 集合）。 */
function nextFreePageId(taken: ReadonlySet<string>): string {
  for (let index = 0; ; index += 1) {
    const candidate = pageFileId(index);
    if (!taken.has(foldPageId(candidate))) return candidate;
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

/**
 * 文档页在 daemon 侧的页文件 id（保存计划实际采用的那个 id）。
 *
 * 只读会话内映射（`planPageSetSave` 写入），**不回写文档真值、不产生历史条目**：
 * - 载入的页 `page.id` 已是 daemon 页 id、且未参与过保存 → null（调用方退回 `page.id`）；
 * - 导入/外部文档的非法页 id 在保存时被改派为 `page-N` → 返回落盘 id
 *   （导出等按 daemon 寻址的调用点必须经它解析，不能用仍是旧值的 `page.id`）。
 */
export function pageIdOf(page: ScenePage): string | null {
  return assignedPageIds.get(page) ?? null;
}

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
 * - `page.id` 命中 `existingPageIds` → update 该 id（**按身份定位**，位置无关；
 *   大小写按 daemon 的归一口径视为同一页）；
 * - 未命中且自身 id 是合法页文件 id → create 并沿用该 id（身份可往返）；
 * - 非法/重复 id → 优先复用 manifest 中未被合法页 id 认领的孤儿页 id（升序），
 *   用尽才 create 首个空闲 `page-N`；
 * - 同一页面对象上次分配过 id → 本轮继续用它（不再重新分配）；
 * - **本计划内页 id 唯一**（归一后）：改派页不得抢占其他页的合法自身 id；
 *   冲突的 preferred（同 id 的第二个页 / 大小写变体）按孤儿池 → 空闲号改派；
 * - `existingPageIds` 中未被任何文档页认领的 → `orphanPageIds`（不删）。
 */
export function planPageSetSave(
  document: DesignDocument,
  existingPageIds: readonly string[],
): PageSetSavePlan {
  // 既有页按 daemon 的归一口径索引：`PAGE-1` 与 `page-1` 是同一页文件。
  const existingByFold = new Map<string, string>();
  for (const pageId of existingPageIds) {
    const fold = foldPageId(pageId);
    if (!existingByFold.has(fold)) existingByFold.set(fold, pageId);
  }

  const reserved = new Set<string>();
  const reservedFolded = new Set<string>();
  const preferred: Array<string | null> = document.pages.map(() => null);

  // 第一轮：合法自身 id 全局优先（身份可往返；重复 id 只有首个认领）。
  document.pages.forEach((page, index) => {
    if (isPageFileId(page.id) && !reserved.has(page.id)) {
      reserved.add(page.id);
      reservedFolded.add(foldPageId(page.id));
      preferred[index] = page.id;
    }
  });
  // 第二轮：没有可用自身 id 的页，复用会话内上次分配的 id。
  document.pages.forEach((page, index) => {
    if (preferred[index] !== null) return;
    const stableId = assignedPageIds.get(page);
    if (
      stableId !== undefined &&
      isPageFileId(stableId) &&
      !reservedFolded.has(foldPageId(stableId))
    ) {
      reserved.add(stableId);
      reservedFolded.add(foldPageId(stableId));
      preferred[index] = stableId;
    }
  });

  // 孤儿池：manifest 中未被文档页（自身合法 id / 会话稳定 id）认领的既有页 id。
  // 归一口径过滤，避免大小写变体把同一页文件同时放进「待复用」与「已预留」。
  const orphanPool = existingPageIds
    .filter((pageId) => !reservedFolded.has(foldPageId(pageId)))
    .sort(comparePageIds);
  let orphanCursor = 0;

  /**
   * 本计划已占用的页 id（归一后）。
   * **键的用途**：改派页（孤儿复用 / nextFree）必须避开它——否则会抢走另一页的
   * preferred（如非法 id 页先分配了 `page-3`，后面合法 `page-3` 页再建一次 → 409），
   * 也会让同一 preferred 的第二个页拿到重复 id。
   */
  const claimedFolded = new Set<string>();

  const create: PageSetCreate[] = [];
  const update: PageSetUpdate[] = [];

  /** 取下一个未被本计划占用的孤儿 id（用尽 → null）。 */
  const takeOrphan = (): string | null => {
    while (orphanCursor < orphanPool.length) {
      const candidate = orphanPool[orphanCursor];
      orphanCursor += 1;
      if (candidate === undefined) continue;
      if (!claimedFolded.has(foldPageId(candidate))) return candidate;
    }
    return null;
  };

  document.pages.forEach((page, index) => {
    const body = encodePageBody(document, page);
    const preferredId = preferred[index] ?? null;
    let pageId: string;
    if (preferredId !== null && !claimedFolded.has(foldPageId(preferredId))) {
      pageId = preferredId;
    } else {
      // 没有可用自身 id，或 preferred 已被本计划中的另一页占用（重复 id / 大小写变体）：
      // 孤儿池优先 → 首个空闲号；两者都避开既有页、已预留的 preferred 与本计划已占用 id。
      const orphanId = takeOrphan();
      if (orphanId !== null) {
        pageId = orphanId;
      } else {
        pageId = nextFreePageId(
          new Set([...existingByFold.keys(), ...reservedFolded, ...claimedFolded]),
        );
      }
    }
    // 归一口径命中既有页 → 按既有页的真实 id 写回（大小写变体不另建页文件）。
    const existingId = existingByFold.get(foldPageId(pageId));
    const assignedId = existingId ?? pageId;
    claimedFolded.add(foldPageId(assignedId));
    assignedPageIds.set(page, assignedId);
    // 命中既有页（含复用孤儿）走 update；否则 create 并沿用分配到的 id。
    if (existingId !== undefined) update.push({ pageId: assignedId, body, index });
    else create.push({ pageId: assignedId, name: page.name, body, index });
  });

  // 计划后置断言（内部不变量）：create 内、create ∪ update 内页 id 必须唯一——
  // 重复 id 会让 daemon 第二次 create 以 409 拒绝，整次保存失败。
  const plannedFolded = new Set<string>();
  for (const entry of [...create, ...update]) {
    const fold = foldPageId(entry.pageId);
    if (plannedFolded.has(fold)) {
      throw new Error(`保存计划出现重复页 id：${entry.pageId}`);
    }
    plannedFolded.add(fold);
  }

  return {
    create,
    update,
    orphanPageIds: existingPageIds.filter((pageId) => !plannedFolded.has(foldPageId(pageId))),
  };
}
