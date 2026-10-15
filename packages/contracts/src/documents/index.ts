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
  /** 文档体积（manifest + 页面正文合计字节）。 */
  sizeBytes: number;
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

/** `POST /documents/:documentId/pages` 请求。 */
export interface PageCreateRequest {
  name: string;
}

/** 页面单对象响应。 */
export interface PageResponse {
  page: DfgPageMeta;
}

/** `GET /documents/:documentId/pages/:pageId` 响应（正文 opaque）。 */
export interface PageReadResponse {
  page: DfgPageMeta;
  body: unknown;
}

/** `PUT /documents/:documentId/pages/:pageId` 请求（原子写：临时文件 + rename）。 */
export interface PageSaveRequest {
  body: unknown;
}

/** `DELETE /documents/:documentId/pages/:pageId` 响应。 */
export interface PageDeleteResponse {
  documentId: string;
  pageId: string;
  deleted: boolean;
}

/** 文档名长度上限（避免超长目录名与 UI 溢出）。 */
export const DOCUMENT_NAME_MAX_LENGTH = 64;

/** 校验文档/页面名：非空、含可见字符、不含路径分隔符/控制字符、不以 `.` 开头。 */
export function isValidDocumentName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  if (name.length === 0 || name.length > DOCUMENT_NAME_MAX_LENGTH) return false;
  if (name.startsWith('.')) return false;
  // 路径分隔符与 Windows 保留字符一并拒绝（跨平台目录名安全）
  if (/[\\/:*?"<>|]/.test(name)) return false;
  // 控制字符（含 DEL）逐一判码点（用正则会被 lint 判为可疑控制字符）
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
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
