/**
 * @dforge/daemon · 文档存储（`.dfg` 目录态，可 Git diff）。
 *
 * 目录布局（架构 v1.1 §5.1 子集）：
 * ```
 * <workspaceDir>/<id>.dfg/
 *   manifest.json      # 强类型元数据（id/name/version/pages/时间戳）
 *   pages/<pageId>.json# 页面正文（opaque JSON——节点语义归 @dforge/engine）
 * ```
 * 纪律：
 * - **正文不解析节点语义**（只校验 JSON 可解析、形状与嵌套深度）；
 * - **所有**文件读写/删除路径都由 `resolveWithin`（path-safety.ts）产出：
 *   id 白名单 + `..`/绝对路径/`%00`/NFC/软链四类越界一律拒（Q1 路径穿越修复）；
 * - **按文档串行化**的 manifest 读改写（每文档一把异步锁）+ 原子写（临时文件 + rename）——
 *   并发下不丢已提交的页面（Q2 修复）；跨进程退化为写后重读比对 + 有界重试（`conflict`）；
 * - manifest 是提交点：页面正文先落盘、manifest 最后更新（读者只会看到一致的旧/新状态）。
 */

import { lstat, mkdir, readdir, rm, stat } from 'node:fs/promises';

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
import { createKeyedMutex } from '../mutex.ts';
import {
  exceedsJsonDepth,
  isRemovableDocDirectory,
  isValidDocumentId,
  isValidPageId,
  resolveWithin,
} from '../path-safety.ts';

/** 存储操作失败码（全部是 `@dforge/contracts` 里已登记的 DfErrorCode，路由层直接透传）。 */
export type StoreErrorCode =
  | 'doc_not_found'
  | 'doc_exists'
  | 'doc_invalid_name'
  | 'doc_invalid_id'
  | 'doc_invalid_body'
  | 'doc_invalid_manifest'
  | 'doc_last_page'
  | 'not_found'
  | 'conflict';

/** 存储操作结果（失败即统一错误码，路由层直接透传）。 */
export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: StoreErrorCode; message: string; details?: Record<string, unknown> };

/** 页面读取结果。 */
export interface PageReadResult {
  summary: DocumentSummary;
  page: DfgPageMeta;
  body: unknown;
}

/** 已解析（且已通过越界校验）的文档路径集合——**只由 resolveWithin 产出**。 */
interface DocPaths {
  /** 数据根（软链已解析；一切文档路径的前缀基准）。 */
  root: string;
  /** `<root>/<id>.dfg`。 */
  dir: string;
  /** `<root>/<id>.dfg/manifest.json`。 */
  manifestPath: string;
  /** `<root>/<id>.dfg/pages`。 */
  pagesDir: string;
}

/** 文档存储接口。 */
export interface DocumentStore {
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

/** 正文嵌套深度上限：超过则 4xx 拒绝（`JSON.stringify` 递归序列化会栈溢出 → 500）。 */
const MAX_BODY_DEPTH = 1024;

/** manifest 提交的有界重试次数（跨进程并发写者的收敛上界；用尽 → `conflict`）。 */
const MAX_COMMIT_ATTEMPTS = 3;

const INVALID_NAME_MESSAGE = '文档名不合法（非空、不含路径分隔符/控制字符、不以 . 开头、≤64 字符）';

function notFound(documentId: string): StoreResult<never> {
  return { ok: false, code: 'doc_not_found', message: '文档不存在', details: { documentId } };
}

function invalidDocumentId(): StoreResult<never> {
  // 消息与 details 都不回显原始 id（既不反射注入串，也不泄漏服务端目录布局）
  return {
    ok: false,
    code: 'doc_invalid_id',
    message: '文档 id 不合法（越界路径/路径分隔符/控制字符/超长/非 NFC 一律拒绝）',
  };
}

function invalidPageId(): StoreResult<never> {
  return {
    ok: false,
    code: 'doc_invalid_id',
    message: '页面 id 不合法（仅允许 [A-Za-z0-9._-]{1,64}）',
  };
}

function pageNotFound(documentId: string, pageId: string): StoreResult<never> {
  return { ok: false, code: 'not_found', message: '页面不存在', details: { documentId, pageId } };
}

/** manifest 提交计划：成功给出「下一个 manifest + 返回值」，失败给出统一存储错误。 */
type ManifestPlan<T> =
  | { ok: true; next: DfgManifest; value: T }
  | { ok: false; result: StoreResult<never> };

/** 创建文档存储（workspaceDir 每次从 config 读取——支持运行时切换工作目录）。 */
export function createDocumentStore(options: { config: ConfigStore }): DocumentStore {
  const rootDir = (): string => options.config.get().workspaceDir;
  /** 每文档一把锁：manifest 读改写串行化（Q2）。 */
  const lock = createKeyedMutex();

  /** 解析数据根（存在性无关；软链已解析）。 */
  const resolveRoot = async (): Promise<string | null> => resolveWithin(rootDir());

  /**
   * 解析文档路径——**唯一**的取路径入口：
   * id 白名单 → `resolveWithin`（词法 + 前缀 + 软链三重校验）。
   */
  const resolveDocPaths = async (documentId: string): Promise<StoreResult<DocPaths>> => {
    if (!isValidDocumentId(documentId)) return invalidDocumentId();
    const root = await resolveRoot();
    if (root === null) return invalidDocumentId();
    const name = `${documentId}${DFG_DOCUMENT_SUFFIX}`;
    const dir = await resolveWithin(root, name);
    const manifestPath = await resolveWithin(root, name, 'manifest.json');
    const pagesDir = await resolveWithin(root, name, 'pages');
    if (dir === null || manifestPath === null || pagesDir === null) return invalidDocumentId();
    return { ok: true, value: { root, dir, manifestPath, pagesDir } };
  };

  /** 解析页面正文路径（同样双重闸门；页面 id 用更严的 ASCII 白名单）。 */
  const resolvePagePath = async (
    paths: DocPaths,
    documentId: string,
    pageId: string,
  ): Promise<string | null> => {
    if (!isValidPageId(pageId)) return null;
    return resolveWithin(
      paths.root,
      `${documentId}${DFG_DOCUMENT_SUFFIX}`,
      'pages',
      `${pageId}.json`,
    );
  };

  /** 读取并校验 manifest（含 `pages[].id` —— 克隆来的 `.dfg` 是不可信输入）。 */
  const readManifestAt = async (
    paths: DocPaths,
    documentId: string,
  ): Promise<StoreResult<DfgManifest>> => {
    const result = await readJsonFileOrNull(paths.manifestPath);
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
    for (const page of result.value.pages) {
      if (!isValidPageId(page.id)) {
        return {
          ok: false,
          code: 'doc_invalid_manifest',
          message: 'manifest.json 含非法页 id（已整体拒绝，未读写任何页面文件）',
          details: { documentId },
        };
      }
    }
    return { ok: true, value: result.value };
  };

  /** 文档摘要（体积/页数；目录字段取已解析的真实路径）。 */
  const summaryOf = async (
    documentId: string,
    paths: DocPaths,
    manifest: DfgManifest,
  ): Promise<DocumentSummary> => {
    let sizeBytes = 0;
    const manifestStat = await stat(paths.manifestPath).catch(() => null);
    if (manifestStat !== null) sizeBytes += manifestStat.size;
    for (const page of manifest.pages) {
      const pagePath = await resolvePagePath(paths, documentId, page.id);
      if (pagePath === null) continue;
      const pageStat = await stat(pagePath).catch(() => null);
      if (pageStat !== null) sizeBytes += pageStat.size;
    }
    return {
      id: documentId,
      name: manifest.name,
      directory: paths.dir,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      pageCount: manifest.pages.length,
      sizeBytes,
    };
  };

  /**
   * manifest 读改写提交（**必须在 `lock.run(documentId)` 内调用**）：
   * 1. 读当前 manifest → 交给 `plan` 计算下一版（plan 内先落正文，manifest 是提交点）；
   * 2. 原子写 manifest（临时文件 + rename）；
   * 3. **写后重读比对内容**：一致才算提交成功；被其他进程覆盖则重读状态重算（有界重试）。
   * 单进程下第 3 步恒真（零额外语义）；跨进程下收敛，重试用尽返回 `conflict`（409）。
   */
  const commitManifest = async <T>(
    documentId: string,
    paths: DocPaths,
    plan: (manifest: DfgManifest) => Promise<ManifestPlan<T>>,
  ): Promise<StoreResult<T>> => {
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const manifest = await readManifestAt(paths, documentId);
      if (!manifest.ok) return manifest;
      const planned = await plan(manifest.value);
      if (!planned.ok) return planned.result;
      const serialized = `${JSON.stringify(planned.next, null, 2)}\n`;
      await writeFileAtomic(paths.manifestPath, serialized, DOC_FILE_MODE);
      const confirm = await readJsonFileOrNull(paths.manifestPath);
      if (confirm.ok && JSON.stringify(confirm.value) === JSON.stringify(planned.next)) {
        return { ok: true, value: planned.value };
      }
    }
    return {
      ok: false,
      code: 'conflict',
      message: `文档并发写入冲突：重试 ${MAX_COMMIT_ATTEMPTS} 次仍未提交成功`,
      details: { documentId },
    };
  };

  return {
    async list(): Promise<DocumentListResponse> {
      const documents: DocumentSummary[] = [];
      const warnings: DocumentListWarning[] = [];
      const root = await resolveRoot();
      if (root === null) return { documents, warnings };
      let entries: string[];
      try {
        entries = await readdir(root);
      } catch {
        return { documents, warnings };
      }
      for (const entry of entries) {
        if (!entry.endsWith(DFG_DOCUMENT_SUFFIX)) continue;
        const id = entry.slice(0, -DFG_DOCUMENT_SUFFIX.length);
        // 目录名是不可信输入：非法 id 既不读也不告警回显（静默跳过）
        const paths = await resolveDocPaths(id);
        if (!paths.ok) continue;
        const manifest = await readManifestAt(paths.value, id);
        if (!manifest.ok) {
          warnings.push({
            id,
            code: manifest.code === 'doc_not_found' ? 'manifest_unreadable' : 'manifest_invalid',
            message: manifest.message,
          });
          continue;
        }
        documents.push(await summaryOf(id, paths.value, manifest.value));
      }
      documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { documents, warnings };
    },

    async create(name: string): Promise<StoreResult<DocumentSummary>> {
      if (!isValidDocumentName(name)) {
        return {
          ok: false,
          code: 'doc_invalid_name',
          message: INVALID_NAME_MESSAGE,
          details: { name },
        };
      }
      // 名 → id 后统一 NFC（NFD/NFC 同名不生成两个目录）
      const id = documentIdFromName(name).normalize('NFC');
      const paths = await resolveDocPaths(id);
      if (!paths.ok) return paths;
      return lock.run(id, async () => {
        await ensureDir(paths.value.root);
        try {
          // 非递归 mkdir：目录已存在即原子冲突（并发/跨进程同名建文档恰一个 201）
          await mkdir(paths.value.dir);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            return { ok: false, code: 'doc_exists', message: '同名文档已存在', details: { id } };
          }
          throw error;
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
        const pagePath = await resolvePagePath(paths.value, id, 'page-1');
        if (pagePath === null) return invalidPageId();
        await writeFileAtomic(pagePath, '{}\n', DOC_FILE_MODE);
        await writeFileAtomic(
          paths.value.manifestPath,
          `${JSON.stringify(manifest, null, 2)}\n`,
          DOC_FILE_MODE,
        );
        return { ok: true, value: await summaryOf(id, paths.value, manifest) };
      });
    },

    async get(documentId: string): Promise<StoreResult<DocumentSummary>> {
      const paths = await resolveDocPaths(documentId);
      if (!paths.ok) return paths;
      const manifest = await readManifestAt(paths.value, documentId);
      if (!manifest.ok) return manifest;
      return { ok: true, value: await summaryOf(documentId, paths.value, manifest.value) };
    },

    async rename(documentId: string, name: string): Promise<StoreResult<DocumentSummary>> {
      if (!isValidDocumentName(name)) {
        return {
          ok: false,
          code: 'doc_invalid_name',
          message: INVALID_NAME_MESSAGE,
          details: { name },
        };
      }
      const paths = await resolveDocPaths(documentId);
      if (!paths.ok) return paths;
      return lock.run(documentId, async () => {
        // 重命名只改 manifest.name（id/目录不变，避免破坏引用与 Git 历史）
        return commitManifest(documentId, paths.value, async (current) => {
          const next: DfgManifest = {
            ...current,
            name: name.trim(),
            version: current.version + 1,
            updatedAt: new Date().toISOString(),
          };
          return { ok: true, next, value: await summaryOf(documentId, paths.value, next) };
        });
      });
    },

    async remove(documentId: string): Promise<StoreResult<{ id: string }>> {
      const paths = await resolveDocPaths(documentId);
      if (!paths.ok) return paths;
      return lock.run(documentId, async () => {
        const manifest = await readManifestAt(paths.value, documentId);
        if (!manifest.ok) return manifest;
        // 对象级删除守卫（Q1-3）：只允许删「数据根内的一个 .dfg 目录」——
        // 数据根本身 / 根的祖先 / 根内普通文件 / 软链一律拒绝（绝不做递归删）
        if (
          !isRemovableDocDirectory({
            root: paths.value.root,
            target: paths.value.dir,
            suffix: DFG_DOCUMENT_SUFFIX,
          })
        ) {
          return {
            ok: false,
            code: 'doc_invalid_id',
            message: '删除目标不是数据根内的 .dfg 文档目录（已拒绝递归删除）',
            details: { documentId },
          };
        }
        const info = await lstat(paths.value.dir).catch(() => null);
        if (info === null || !info.isDirectory() || info.isSymbolicLink()) {
          return {
            ok: false,
            code: 'doc_invalid_id',
            message: '删除目标不是真实目录（软链/文件一律拒绝）',
            details: { documentId },
          };
        }
        // TOCTOU 兜底：真实落点复查仍在数据根内（软链不得指向根外）
        const recheck = await resolveDocPaths(documentId);
        if (!recheck.ok || recheck.value.dir !== paths.value.dir) {
          return invalidDocumentId();
        }
        await rm(paths.value.dir, { recursive: true, force: true });
        return { ok: true, value: { id: documentId } };
      });
    },

    async readPage(documentId: string, pageId: string): Promise<StoreResult<PageReadResult>> {
      const paths = await resolveDocPaths(documentId);
      if (!paths.ok) return paths;
      if (!isValidPageId(pageId)) return invalidPageId();
      const manifest = await readManifestAt(paths.value, documentId);
      if (!manifest.ok) return manifest;
      const page = manifest.value.pages.find((item) => item.id === pageId);
      if (page === undefined) return pageNotFound(documentId, pageId);
      const pagePath = await resolvePagePath(paths.value, documentId, pageId);
      if (pagePath === null) return invalidPageId();
      const body = await readJsonFileOrNull(pagePath);
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
        value: {
          summary: await summaryOf(documentId, paths.value, manifest.value),
          page,
          body: body.value,
        },
      };
    },

    async savePage(
      documentId: string,
      pageId: string,
      body: unknown,
    ): Promise<StoreResult<DfgPageMeta>> {
      const paths = await resolveDocPaths(documentId);
      if (!paths.ok) return paths;
      if (!isValidPageId(pageId)) return invalidPageId();
      if (body === undefined || body === null) {
        return {
          ok: false,
          code: 'doc_invalid_body',
          message: '请求体必须包含非 null 的 body 字段（opaque JSON）',
          details: { documentId, pageId },
        };
      }
      // 深嵌套正文在 JSON.stringify（递归）处会栈溢出 → 500：先按深度拒为 4xx
      if (exceedsJsonDepth(body, MAX_BODY_DEPTH)) {
        return {
          ok: false,
          code: 'doc_invalid_body',
          message: `正文嵌套深度超过上限 ${MAX_BODY_DEPTH} 层（拒绝序列化以避免栈溢出）`,
          details: { documentId, pageId, maxDepth: MAX_BODY_DEPTH },
        };
      }
      const pagePath = await resolvePagePath(paths.value, documentId, pageId);
      if (pagePath === null) return invalidPageId();
      return lock.run(documentId, async () => {
        return commitManifest(documentId, paths.value, async (current) => {
          const page = current.pages.find((item) => item.id === pageId);
          if (page === undefined) return { ok: false, result: pageNotFound(documentId, pageId) };
          const now = new Date().toISOString();
          const nextPage: DfgPageMeta = { ...page, updatedAt: now };
          // 提交顺序：正文先落盘、manifest 最后（崩溃时读者仍见一致状态）
          await writeFileAtomic(pagePath, `${JSON.stringify(body, null, 2)}\n`, DOC_FILE_MODE);
          const next: DfgManifest = {
            ...current,
            version: current.version + 1,
            updatedAt: now,
            pages: current.pages.map((item) => (item.id === pageId ? nextPage : item)),
          };
          return { ok: true, next, value: nextPage };
        });
      });
    },

    async createPage(documentId: string, name: string): Promise<StoreResult<DfgPageMeta>> {
      if (!isValidDocumentName(name)) {
        return {
          ok: false,
          code: 'doc_invalid_name',
          message: INVALID_NAME_MESSAGE,
          details: { name },
        };
      }
      const paths = await resolveDocPaths(documentId);
      if (!paths.ok) return paths;
      return lock.run(documentId, async () => {
        return commitManifest(documentId, paths.value, async (current) => {
          // 页面 id 递增分配（page-N），跳过已占用的编号；重试路径上按最新状态重算
          const taken = new Set(current.pages.map((page) => page.id));
          let counter = current.pages.length + 1;
          while (taken.has(`page-${counter}`)) counter += 1;
          const pageId = `page-${counter}`;
          const pagePath = await resolvePagePath(paths.value, documentId, pageId);
          if (pagePath === null) return { ok: false, result: invalidPageId() };
          const now = new Date().toISOString();
          const page: DfgPageMeta = { id: pageId, name: name.trim(), updatedAt: now };
          await writeFileAtomic(pagePath, '{}\n', DOC_FILE_MODE);
          const next: DfgManifest = {
            ...current,
            version: current.version + 1,
            updatedAt: now,
            pages: [...current.pages, page],
          };
          return { ok: true, next, value: page };
        });
      });
    },

    async deletePage(
      documentId: string,
      pageId: string,
    ): Promise<StoreResult<{ documentId: string; pageId: string }>> {
      const paths = await resolveDocPaths(documentId);
      if (!paths.ok) return paths;
      if (!isValidPageId(pageId)) return invalidPageId();
      const pagePath = await resolvePagePath(paths.value, documentId, pageId);
      if (pagePath === null) return invalidPageId();
      return lock.run(documentId, async () => {
        const committed = await commitManifest(documentId, paths.value, async (current) => {
          const page = current.pages.find((item) => item.id === pageId);
          if (page === undefined) return { ok: false, result: pageNotFound(documentId, pageId) };
          if (current.pages.length <= 1) {
            return {
              ok: false,
              result: {
                ok: false,
                code: 'doc_last_page',
                message: '不允许删除最后一页（页面常驻 ≥1）',
                details: { documentId, pageId },
              },
            };
          }
          const now = new Date().toISOString();
          const next: DfgManifest = {
            ...current,
            version: current.version + 1,
            updatedAt: now,
            pages: current.pages.filter((item) => item.id !== pageId),
          };
          return { ok: true, next, value: { documentId, pageId } };
        });
        if (!committed.ok) return committed;
        // manifest 是提交点：提交成功后再删正文文件
        await rm(pagePath, { force: true });
        return { ok: true, value: committed.value };
      });
    },
  };
}
