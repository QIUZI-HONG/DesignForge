/**
 * @dforge/daemon · 文档存储（`.dfg` 目录态，可 Git diff）。
 *
 * 目录布局（架构 v1.1 §5.1 子集）：
 * ```
 * <workspaceDir>/<id>.dfg/
 *   manifest.json      # 强类型元数据（id/name/version/pages/时间戳）
 *   pages/<pageId>.json# 页面正文（opaque JSON——节点语义归 @dforge/engine）
 * ```
 * 纪律：**正文不解析节点语义**（只校验 JSON 可解析与元数据形状）；
 * 所有写入走原子写（临时文件 + rename，见 fs-atomic.ts）——崩溃安全；
 * manifest 是提交点：页面正文先落盘、manifest 最后更新（读者只会看到一致的旧/新状态）。
 */

import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  DfgManifest,
  DfgPageMeta,
  DocumentListResponse,
  DocumentListWarning,
  DocumentSummary,
} from '@dforge/contracts';
import {
  DFG_DOCUMENT_SUFFIX,
  DFG_MANIFEST_SCHEMA,
  documentIdFromName,
  isDfgManifest,
  isValidDocumentName,
} from '@dforge/contracts';

import type { ConfigStore } from '../config/store.ts';
import { ensureDir, readJsonFileOrNull, writeFileAtomic } from '../fs-atomic.ts';

/** 存储操作结果（失败即统一错误码，路由层直接透传）。 */
export type StoreResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code:
        | 'doc_not_found'
        | 'doc_exists'
        | 'doc_invalid_name'
        | 'doc_invalid_body'
        | 'doc_invalid_manifest'
        | 'doc_last_page'
        | 'not_found';
      message: string;
      details?: Record<string, unknown>;
    };

/** 页面读取结果。 */
export interface PageReadResult {
  summary: DocumentSummary;
  page: DfgPageMeta;
  body: unknown;
}

/** 文档存储接口。 */
export interface DocumentStore {
  directoryOf(documentId: string): string;
  list(): Promise<DocumentListResponse>;
  create(name: string): Promise<StoreResult<DocumentSummary>>;
  get(documentId: string): Promise<StoreResult<DocumentSummary>>;
  rename(documentId: string, name: string): Promise<StoreResult<DocumentSummary>>;
  remove(documentId: string): Promise<StoreResult<{ id: string }>>;
  readPage(documentId: string, pageId: string): Promise<StoreResult<PageReadResult>>;
  savePage(documentId: string, pageId: string, body: unknown): Promise<StoreResult<DfgPageMeta>>;
  createPage(documentId: string, name: string): Promise<StoreResult<DfgPageMeta>>;
  deletePage(
    documentId: string,
    pageId: string,
  ): Promise<StoreResult<{ documentId: string; pageId: string }>>;
}

/** 文档正文的落盘权限（目录态文档要能被用户与 Git 直接读，非敏感）。 */
const DOC_FILE_MODE = 0o644;

function notFound(documentId: string): StoreResult<never> {
  return { ok: false, code: 'doc_not_found', message: '文档不存在', details: { documentId } };
}

/** 创建文档存储（workspaceDir 每次从 config 读取——支持运行时切换工作目录）。 */
export function createDocumentStore(options: { config: ConfigStore }): DocumentStore {
  const workspaceDir = (): string => options.config.get().workspaceDir;
  const directoryOf = (documentId: string): string =>
    join(workspaceDir(), `${documentId}${DFG_DOCUMENT_SUFFIX}`);
  const manifestPathOf = (documentId: string): string =>
    join(directoryOf(documentId), 'manifest.json');
  const pagePathOf = (documentId: string, pageId: string): string =>
    join(directoryOf(documentId), 'pages', `${pageId}.json`);

  const readManifest = async (documentId: string): Promise<StoreResult<DfgManifest>> => {
    const result = await readJsonFileOrNull(manifestPathOf(documentId));
    if (!result.ok) {
      if (result.reason === 'missing') return notFound(documentId);
      return {
        ok: false,
        code: 'doc_invalid_manifest',
        message: `manifest.json 不可读：${result.message}`,
        details: { documentId },
      };
    }
    if (!isDfgManifest(result.value)) {
      return {
        ok: false,
        code: 'doc_invalid_manifest',
        message: 'manifest.json 形状不合法（非本版本 .dfg 文档）',
        details: { documentId },
      };
    }
    return { ok: true, value: result.value };
  };

  const writeManifest = async (documentId: string, manifest: DfgManifest): Promise<void> => {
    await writeFileAtomic(
      manifestPathOf(documentId),
      `${JSON.stringify(manifest, null, 2)}\n`,
      DOC_FILE_MODE,
    );
  };

  const summaryOf = async (manifest: DfgManifest): Promise<DocumentSummary> => {
    const directory = directoryOf(manifest.id);
    let sizeBytes = 0;
    const manifestStat = await stat(manifestPathOf(manifest.id)).catch(() => null);
    if (manifestStat !== null) sizeBytes += manifestStat.size;
    for (const page of manifest.pages) {
      const pageStat = await stat(pagePathOf(manifest.id, page.id)).catch(() => null);
      if (pageStat !== null) sizeBytes += pageStat.size;
    }
    return {
      id: manifest.id,
      name: manifest.name,
      directory,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      pageCount: manifest.pages.length,
      sizeBytes,
    };
  };

  return {
    directoryOf,

    async list(): Promise<DocumentListResponse> {
      const root = workspaceDir();
      const documents: DocumentSummary[] = [];
      const warnings: DocumentListWarning[] = [];
      let entries: string[];
      try {
        entries = await readdir(root);
      } catch {
        return { documents, warnings };
      }
      for (const entry of entries) {
        if (!entry.endsWith(DFG_DOCUMENT_SUFFIX)) continue;
        const id = entry.slice(0, -DFG_DOCUMENT_SUFFIX.length);
        const manifest = await readManifest(id);
        if (!manifest.ok) {
          warnings.push({
            id,
            code: manifest.code === 'doc_not_found' ? 'manifest_unreadable' : 'manifest_invalid',
            message: manifest.message,
          });
          continue;
        }
        documents.push(await summaryOf(manifest.value));
      }
      documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { documents, warnings };
    },

    async create(name: string): Promise<StoreResult<DocumentSummary>> {
      if (!isValidDocumentName(name)) {
        return {
          ok: false,
          code: 'doc_invalid_name',
          message: '文档名不合法（非空、不含路径分隔符/控制字符、不以 . 开头、≤64 字符）',
          details: { name },
        };
      }
      const id = documentIdFromName(name);
      const directory = directoryOf(id);
      const existing = await stat(directory).catch(() => null);
      if (existing !== null) {
        return { ok: false, code: 'doc_exists', message: '同名文档已存在', details: { id } };
      }
      const now = new Date().toISOString();
      const manifest: DfgManifest = {
        schema: DFG_MANIFEST_SCHEMA,
        id,
        name: name.trim(),
        version: 1,
        createdAt: now,
        updatedAt: now,
        pages: [{ id: 'page-1', name: '页面 1', updatedAt: now }],
      };
      await mkdir(join(directory, 'pages'), { recursive: true });
      await writeFileAtomic(pagePathOf(id, 'page-1'), '{}\n', DOC_FILE_MODE);
      await writeManifest(id, manifest);
      return { ok: true, value: await summaryOf(manifest) };
    },

    async get(documentId: string): Promise<StoreResult<DocumentSummary>> {
      const manifest = await readManifest(documentId);
      if (!manifest.ok) return manifest;
      return { ok: true, value: await summaryOf(manifest.value) };
    },

    async rename(documentId: string, name: string): Promise<StoreResult<DocumentSummary>> {
      if (!isValidDocumentName(name)) {
        return {
          ok: false,
          code: 'doc_invalid_name',
          message: '文档名不合法（非空、不含路径分隔符/控制字符、不以 . 开头、≤64 字符）',
          details: { name },
        };
      }
      const manifest = await readManifest(documentId);
      if (!manifest.ok) return manifest;
      // 重命名只改 manifest.name（id/目录不变，避免破坏引用与 Git 历史）
      const updated: DfgManifest = {
        ...manifest.value,
        name: name.trim(),
        version: manifest.value.version + 1,
        updatedAt: new Date().toISOString(),
      };
      await writeManifest(documentId, updated);
      return { ok: true, value: await summaryOf(updated) };
    },

    async remove(documentId: string): Promise<StoreResult<{ id: string }>> {
      const manifest = await readManifest(documentId);
      if (!manifest.ok) return manifest;
      await rm(directoryOf(documentId), { recursive: true, force: true });
      return { ok: true, value: { id: documentId } };
    },

    async readPage(documentId: string, pageId: string): Promise<StoreResult<PageReadResult>> {
      const manifest = await readManifest(documentId);
      if (!manifest.ok) return manifest;
      const page = manifest.value.pages.find((item) => item.id === pageId);
      if (page === undefined) {
        return {
          ok: false,
          code: 'not_found',
          message: '页面不存在',
          details: { documentId, pageId },
        };
      }
      const body = await readJsonFileOrNull(pagePathOf(documentId, pageId));
      if (!body.ok) {
        return {
          ok: false,
          code: 'doc_invalid_body',
          message: `页面正文不可用：${body.message}`,
          details: { documentId, pageId },
        };
      }
      return {
        ok: true,
        value: { summary: await summaryOf(manifest.value), page, body: body.value },
      };
    },

    async savePage(
      documentId: string,
      pageId: string,
      body: unknown,
    ): Promise<StoreResult<DfgPageMeta>> {
      const manifest = await readManifest(documentId);
      if (!manifest.ok) return manifest;
      const page = manifest.value.pages.find((item) => item.id === pageId);
      if (page === undefined) {
        return {
          ok: false,
          code: 'not_found',
          message: '页面不存在',
          details: { documentId, pageId },
        };
      }
      if (body === undefined || body === null) {
        return {
          ok: false,
          code: 'doc_invalid_body',
          message: '请求体必须包含非 null 的 body 字段（opaque JSON）',
          details: { documentId, pageId },
        };
      }
      const now = new Date().toISOString();
      const nextPage: DfgPageMeta = { ...page, updatedAt: now };
      // 提交顺序：正文先落盘、manifest 最后（崩溃时读者仍见一致状态）
      await writeFileAtomic(
        pagePathOf(documentId, pageId),
        `${JSON.stringify(body, null, 2)}\n`,
        DOC_FILE_MODE,
      );
      const updated: DfgManifest = {
        ...manifest.value,
        version: manifest.value.version + 1,
        updatedAt: now,
        pages: manifest.value.pages.map((item) => (item.id === pageId ? nextPage : item)),
      };
      await writeManifest(documentId, updated);
      return { ok: true, value: nextPage };
    },

    async createPage(documentId: string, name: string): Promise<StoreResult<DfgPageMeta>> {
      if (!isValidDocumentName(name)) {
        return {
          ok: false,
          code: 'doc_invalid_name',
          message: '页面名不合法（非空、不含路径分隔符/控制字符、不以 . 开头、≤64 字符）',
          details: { name },
        };
      }
      const manifest = await readManifest(documentId);
      if (!manifest.ok) return manifest;
      // 页面 id 递增分配（page-N），跳过已占用的编号
      const taken = new Set(manifest.value.pages.map((page) => page.id));
      let counter = manifest.value.pages.length + 1;
      while (taken.has(`page-${counter}`)) counter += 1;
      const pageId = `page-${counter}`;
      const now = new Date().toISOString();
      const page: DfgPageMeta = { id: pageId, name: name.trim(), updatedAt: now };
      await ensureDir(join(directoryOf(documentId), 'pages'));
      await writeFileAtomic(pagePathOf(documentId, pageId), '{}\n', DOC_FILE_MODE);
      const updated: DfgManifest = {
        ...manifest.value,
        version: manifest.value.version + 1,
        updatedAt: now,
        pages: [...manifest.value.pages, page],
      };
      await writeManifest(documentId, updated);
      return { ok: true, value: page };
    },

    async deletePage(
      documentId: string,
      pageId: string,
    ): Promise<StoreResult<{ documentId: string; pageId: string }>> {
      const manifest = await readManifest(documentId);
      if (!manifest.ok) return manifest;
      const page = manifest.value.pages.find((item) => item.id === pageId);
      if (page === undefined) {
        return {
          ok: false,
          code: 'not_found',
          message: '页面不存在',
          details: { documentId, pageId },
        };
      }
      if (manifest.value.pages.length <= 1) {
        return {
          ok: false,
          code: 'doc_last_page',
          message: '不允许删除最后一页（页面常驻 ≥1）',
          details: { documentId, pageId },
        };
      }
      const now = new Date().toISOString();
      const updated: DfgManifest = {
        ...manifest.value,
        version: manifest.value.version + 1,
        updatedAt: now,
        pages: manifest.value.pages.filter((item) => item.id !== pageId),
      };
      await writeManifest(documentId, updated);
      await rm(pagePathOf(documentId, pageId), { force: true });
      return { ok: true, value: { documentId, pageId } };
    },
  };
}
