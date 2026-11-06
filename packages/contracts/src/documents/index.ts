/**
 * @dforge/contracts · documents 命名空间。
 *
 * 文档 CRUD 载荷与 `.dfg` 目录态元数据（manifest.json）。
 * 归属纪律：**文档正文是 opaque JSON**（Design IR 节点类型归 `@dforge/engine`）——
 * 本命名空间只定义元数据（id/name/updatedAt/size）与传输信封，不定义节点语义。
 * 消费方：FE-02（首页/文件浏览器）、FE-03/06（编辑器读写往返）。
 */

/** `.dfg` manifest 契约标识（目录态根元数据文件 manifest.json）。 */
export const DFG_MANIFEST_SCHEMA = 'df.dfg.manifest/v1' as const;

/** `.dfg` 目录后缀。 */
export const DFG_DOCUMENT_SUFFIX = '.dfg' as const;

/** 页文件 id 长度上限（daemon 页 id 白名单口径）。 */
export const PAGE_FILE_ID_MAX_LENGTH = 64;

/** daemon 页文件 id 的字符白名单（与 `apps/daemon/src/path-safety.ts` 同源同判据）。 */
const PAGE_FILE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * 页面序号（0 起）→ 页文件 id：`page-{N}`。
 *
 * **单一真源**：daemon 的跳号分配器、web 的空文档占位页、引擎的缺省页 id 都按此约定；
 * 引擎不依赖 contracts（纯 TS 零运行时依赖），其常量注释里注明「与 contracts 同值」。
 * 页文件 id 是**身份**（不是位置）：manifest 的 `pages[].id` 即该值。
 */
export function pageFileId(index: number): string {
  return `page-${String(index + 1)}`;
}

/** 新建文档的默认页 id（`page-1`；daemon 落盘初始页与 web 空文档口径共用）。 */
export const DEFAULT_PAGE_ID = pageFileId(0);

/** 新建文档的默认页名（数据默认值，不是界面文案）。 */
export const DEFAULT_PAGE_NAME = '页面 1' as const;

/**
 * 是否为合法的页文件 id（`[A-Za-z0-9._-]{1,64}`，拒绝 `.` / `..`）。
 *
 * 这是**页 id 白名单的唯一真源**：daemon 的 `isValidPageId` 直接委托本函数，
 * web 的 mapping module 用它在保存时判断 `page.id` 能否原样作为页文件 id。
 */
export function isPageFileId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > PAGE_FILE_ID_MAX_LENGTH) return false;
  if (value === '.' || value === '..') return false;
  return PAGE_FILE_ID_PATTERN.test(value);
}

/** 页面元数据（正文不在 manifest 内，落 pages/<pageId>.json）。 */
export interface DfgPageMeta {
  id: string;
  name: string;
  updatedAt: string;
}

/** `.dfg/manifest.json` 形状（强类型元数据 + opaque 正文引用）。 */
export interface DfgManifest {
  schema: typeof DFG_MANIFEST_SCHEMA;
  /** 文档 id（= 目录名去 `.dfg` 后缀；重命名不改 id）。 */
  id: string;
  name: string;
  /** 文档结构版本（每次保存自增，供未来版本/回滚使用）。 */
  version: number;
  createdAt: string;
  updatedAt: string;
  pages: DfgPageMeta[];
}

/** 文档列表项（`GET /documents`）。 */
export interface DocumentSummary {
  id: string;
  name: string;
  /** 目录绝对路径（本地优先：前端可展示/在文件管理器打开）。 */
  directory: string;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
  /**
   * 文档 revision（= manifest.version，单调整数）——保存冲突检测的基线
   * （audit-d06 · D-05 · Q2=A）：客户端载入时记下它，条件保存经 {@link DF_REVISION_HEADER}
   * 回传；daemon 在提交锁内比对，不匹配即 409 `doc_revision_conflict`。
   */
  revision: number;
  /** 文档体积（manifest + 页面正文合计字节）。 */
  sizeBytes: number;
}

/**
 * 文档详情（`GET /documents/:documentId`）：摘要 + manifest 的页清单。
 *
 * 为什么单列而不是把 `pages` 塞进 `DocumentSummary`（列表项）：列表不需要逐页元数据，
 * 而读写往返必须按 manifest 的**页 id 集合**（有序）寻址——页集有洞时不能靠下标猜 id。
 */
export interface DocumentDetail extends DocumentSummary {
  /** manifest 的页元数据（顺序 = daemon 页顺序；`id` 即页文件 id）。 */
  pages: DfgPageMeta[];
}

/** `GET /documents/:documentId` 响应。 */
export interface DocumentDetailResponse {
  document: DocumentDetail;
}

/** 列表里的跳过告警（目录损坏不阻塞列表：记录并继续）。 */
export interface DocumentListWarning {
  id: string;
  code: 'manifest_unreadable' | 'manifest_invalid';
  message: string;
}

/** `GET /documents` 响应。 */
export interface DocumentListResponse {
  documents: DocumentSummary[];
  warnings: DocumentListWarning[];
}

/** `POST /documents` 请求。 */
export interface DocumentCreateRequest {
  name: string;
}

/** `PATCH /documents/:documentId` 请求（重命名只改 manifest.name，不改 id/目录）。 */
export interface DocumentRenameRequest {
  name: string;
}

/** 文档单对象响应（创建 / 读取 / 重命名共用）。 */
export interface DocumentResponse {
  document: DocumentSummary;
}

/** `DELETE /documents/:documentId` 响应。 */
export interface DocumentDeleteResponse {
  id: string;
  deleted: boolean;
}

/**
 * `POST /documents/:documentId/pages` 请求。
 *
 * `id` 可选：缺省由 daemon 跳号分配（既有行为）；给定时按该 id 建页（页 id 是身份，
 * 保存映射据此把内存页 id 原样落成页文件，不再「位置即身份」）。非法/已占用即 4xx/409。
 */
export interface PageCreateRequest {
  name: string;
  id?: string;
}

/** 页面单对象响应。 */
export interface PageResponse {
  page: DfgPageMeta;
}

/** `GET /documents/:documentId/pages/:pageId` 响应（正文 opaque；revision 供条件保存做基线）。 */
export interface PageReadResponse {
  page: DfgPageMeta;
  body: unknown;
  /** 响应时刻的文档 revision（= manifest.version）。 */
  revision: number;
}

/**
 * 页面写入响应（PUT 保存 / POST 建页共用）：新页元数据 + 写入后的文档 revision。
 *
 * 为什么要回传 revision：保存链是**多写串行**（逐页 PUT/POST），客户端每次成功写后
 * 用响应里的 revision 推进下一写的 If-Match 基线——同一次保存内的第二页起就不会
 * 误伤自己（第一次写已让版本前进）。
 */
export interface PageWriteResponse {
  page: DfgPageMeta;
  /** 写入完成后的文档 revision（= manifest.version）。 */
  revision: number;
}

/** `PUT /documents/:documentId/pages/:pageId` 请求（原子写：临时文件 + rename）。
 *
 * 条件保存（audit-d06 · D-05）：`If-Match: <revision>` 头给定时，daemon 在提交锁内
 * 比对 manifest.version——不匹配即 409 `doc_revision_conflict`（正文与版本不变）；
 * **不给头走旧行为**（last-write-wins，向后兼容硬约束：旧客户端不破）。
 */
export interface PageSaveRequest {
  body: unknown;
}

/** `DELETE /documents/:documentId/pages/:pageId` 响应。 */
export interface PageDeleteResponse {
  documentId: string;
  pageId: string;
  deleted: boolean;
}

/**
 * 保存冲突检测的条件请求头（audit-d06 · D-05 · Q2=A）。
 *
 * 取标准 `If-Match`，头值是文档 revision（manifest.version）的十进制整数——接受裸数字
 * 与带引号实体标签（`"7"`）两种形态；`*` 通配与一切非 revision 整数一律非法（400）。
 * 客户端以 {@link formatRevisionHeader} 发出、daemon 以 {@link parseRevisionHeader} 接——
 * **单一判据只在这里写一份**，两端都不得各抄一份正则。
 */
export const DF_REVISION_HEADER = 'if-match' as const;

/** 把 revision 格式化为条件头取值（裸十进制整数）。 */
export function formatRevisionHeader(revision: number): string {
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error(`revision 必须是非负整数：${String(revision)}`);
  }
  return String(revision);
}

/**
 * 解析条件头取值：数字 / 带引号实体标签 → revision；`*` 通配与一切非 revision 整数
 * （含空串、小数、负数、超安全整数）→ null（调用方按 400 拒绝）。
 */
export function parseRevisionHeader(value: string): number | null {
  const text = value.trim();
  const unquoted =
    text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
  if (!/^\d+$/.test(unquoted)) return null;
  const parsed = Number(unquoted);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** 文档名长度上限（避免超长目录名与 UI 溢出）。 */
export const DOCUMENT_NAME_MAX_LENGTH = 64;

/**
 * 文档名不合规的原因（UX-11 分因文案的唯一真源）。
 *
 * 为什么要分因而不是只给布尔：界面要按因由给不同文案（空 / 超长 / 非法字符），
 * 由消费方各自复刻判定必然漂移——规则只在这里写一份。
 */
export type DocumentNameIssue = 'empty' | 'too_long' | 'invalid';

/**
 * 取文档名的不合规原因；合规返回 `null`。
 *
 * 口径与 {@link isValidDocumentName} 同一份规则：先 trim 再判，
 * 空的（含纯空白）→ `empty`；超长 → `too_long`；其余（`.` 开头、路径分隔符、
 * Windows 保留字符、控制字符、非字符串）→ `invalid`。
 */
export function describeDocumentNameIssue(value: unknown): DocumentNameIssue | null {
  if (typeof value !== 'string') return 'invalid';
  const name = value.trim();
  if (name.length === 0) return 'empty';
  if (name.length > DOCUMENT_NAME_MAX_LENGTH) return 'too_long';
  if (name.startsWith('.')) return 'invalid';
  // 路径分隔符与 Windows 保留字符一并拒绝（跨平台目录名安全）
  if (/[\\/:*?"<>|]/.test(name)) return 'invalid';
  // 控制字符（含 DEL）逐一判码点（用正则会被 lint 判为可疑控制字符）
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return 'invalid';
  }
  return null;
}

/** 校验文档/页面名：非空、含可见字符、不含路径分隔符/控制字符、不以 `.` 开头。 */
export function isValidDocumentName(value: unknown): value is string {
  return typeof value === 'string' && describeDocumentNameIssue(value) === null;
}

/** 文档名 → 目录 id（去首尾空白、空白压成 `-`；中文保留——本地优先、中文优先）。 */
export function documentIdFromName(name: string): string {
  return name.trim().replace(/\s+/g, '-');
}

/** 校验值是否为合法 `.dfg` manifest。 */
export function isDfgManifest(value: unknown): value is DfgManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.schema !== DFG_MANIFEST_SCHEMA) return false;
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return false;
  if (typeof record.version !== 'number' || !Number.isInteger(record.version)) return false;
  if (typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string') return false;
  if (!Array.isArray(record.pages)) return false;
  return record.pages.every((page) => {
    if (typeof page !== 'object' || page === null) return false;
    const meta = page as Record<string, unknown>;
    return (
      typeof meta.id === 'string' &&
      typeof meta.name === 'string' &&
      typeof meta.updatedAt === 'string'
    );
  });
}
