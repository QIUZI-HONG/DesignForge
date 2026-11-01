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
 * - **正文不解析节点语义**（只校验 JSON 可解析、形状与嵌套深度）；唯一例外是
 *   `dforge.canvas.page` 信封的**引用完整性守门**（票 17：悬空组件引用拒绝落盘，
 *   见 `canvas-integrity.ts`——读侧 `parseDocument` 全校验，写侧必须同强度，
 *   否则一次静默写坏 = 文档永久打不开）；
 * - **所有**文件读写/删除路径都由 `resolveWithin`（path-safety.ts）产出：
 *   id 白名单 + `..`/绝对路径/`%00`/NFC/软链四类越界一律拒（Q1 路径穿越修复）；
 * - **按文档串行化**的 manifest 读改写（每文档一把异步锁）+ 原子写（临时文件 + rename）——
 *   并发下不丢已提交的页面（Q2 修复）；跨进程退化为写后重读比对 + 有界重试（`conflict`）；
 * - manifest 是提交点：页面正文先**暂存**（同目录临时文件）、manifest 提交并复读确认后才发布，
 *   失败则作废暂存——因此「保存失败」时盘上仍是提交前的内容（票 19）。读者只会看到一致的旧/新状态。
 */

import { lstat, mkdir, readdir, rm, stat } from 'node:fs/promises';

import type {
  DfgManifest,
  DfgPageMeta,
  DocumentDetailResponse,
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
import type { StagedFile } from '../fs-atomic.ts';
import {
  ensureDir,
  readJsonFileOrNull,
  removeTree,
  stageFileAtomic,
  writeFileAtomic,
} from '../fs-atomic.ts';
import { createKeyedMutex } from '../mutex.ts';
import {
  exceedsJsonDepth,
  isRemovableDocDirectory,
  isValidDocumentId,
  isValidPageId,
  MAX_JSON_DEPTH,
  resolveWithin,
} from '../path-safety.ts';
import { canvasPageReferenceIssues } from './canvas-integrity.ts';

/** 存储操作失败码（全部是 `@dforge/contracts` 里已登记的 DfErrorCode，路由层直接透传）。 */
export type StoreErrorCode =
  | 'doc_not_found'
  | 'doc_exists'
  | 'doc_invalid_name'
  | 'doc_invalid_id'
  | 'doc_invalid_body'
  | 'doc_invalid_structure'
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
  /** 单对象 + manifest 页列表（保存/读取按页 id 列表寻址，见 `DocumentDetailResponse`）。 */
  getDetail(documentId: string): Promise<StoreResult<DocumentDetailResponse>>;
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

/**
 * 正文发布目标可替换性检查（F3）：`publish()` 是 `rename(temp -> 正文路径)`，
 * 若正文路径已存在且是目录，rename 必 EISDIR —— 而那时 manifest 已是提交点、已前移，
 * 结果「文档比调用之前更糟」（正文从未发布、readPage 打不开）。因此必须在提交点**之前**
 * 证明目标可替换：目录（非可 rename 覆盖的普通条目）即拒，落 doc_invalid_body，盘上零变化。
 * 说明：**不**在冲突时回滚正文文件——那会盖掉并发胜者已提交的正文（票 19 的设计）。
 */
async function bodyTargetIsDirectory(pagePath: string): Promise<boolean> {
  const existing = await lstat(pagePath).catch(() => null);
  return existing !== null && existing.isDirectory();
}

/**
 * create 阶段目录变形（F4 · 票 19 评审）：ENOENT/ENOTDIR 与评审实测 create/delete 竞态同族
 * （`rename …tmp -> manifest.json` ENOENT，message 内嵌绝对路径）。类型化 conflict（409）——
 * 消息与 details 只带 documentId/phase，不回显任何宿主路径。
 */
function createRaceLost(documentId: string, phase: 'mkdir' | 'commit'): StoreResult<never> {
  return {
    ok: false,
    code: 'conflict',
    message:
      '文档创建期间目录缺失或变形（数据根被文件占据/文档目录被并发删除），本次创建未生效，请重试',
    details: { documentId, phase },
  };
}

/** manifest 提交计划：成功给出「下一个 manifest + 返回值（+ 提交点之后才发布的正文）」，失败给出统一存储错误。 */
type ManifestPlan<T> =
  | { ok: true; next: DfgManifest; value: T; staged?: StagedFile }
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
   * 1. 读当前 manifest → 交给 `plan` 计算下一版（plan 把正文**暂存**，不发到目标名）；
   * 2. 原子写 manifest（临时文件 + rename）；
   * 3. **写后重读比对内容**：一致才算提交成功，此时才发布正文；
   *    被其他进程覆盖则作废暂存正文、重读状态重算（有界重试）。
   * 单进程下第 3 步恒真（零额外语义）；跨进程下收敛，重试用尽返回 `conflict`（409），
   * 并在 `details` 里如实交代盘上实况（**失败即盘上没变**，票 19）。
   */
  const commitManifest = async <T>(
    documentId: string,
    paths: DocPaths,
    plan: (manifest: DfgManifest) => Promise<ManifestPlan<T>>,
  ): Promise<StoreResult<T>> => {
    let attemptedVersion: number | null = null;
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const manifest = await readManifestAt(paths, documentId);
      if (!manifest.ok) return manifest;
      const planned = await plan(manifest.value);
      if (!planned.ok) return planned.result;
      attemptedVersion = planned.next.version;
      const serialized = `${JSON.stringify(planned.next, null, 2)}\n`;
      // 提交点确认（含发布正文）之前任何一步抛错——manifest 写、复读、publish、discard——
      // 都必须作废本次已暂存的正文，否则「失败的保存」把半截正文以 .tmp 永久留在 pages/，
      // 直接违背票 19 标题承诺「保存失败 = 盘上没变」。committed 只在发布成功后置真。
      let committed = false;
      try {
        await writeFileAtomic(paths.manifestPath, serialized, DOC_FILE_MODE);
        const confirm = await readJsonFileOrNull(paths.manifestPath);
        if (confirm.ok && JSON.stringify(confirm.value) === JSON.stringify(planned.next)) {
          // 提交点已过：现在才把正文发布到目标名
          if (planned.staged !== undefined) await planned.staged.publish();
          committed = true;
          return { ok: true, value: planned.value };
        }
        // 本次提交没落上：作废暂存正文，绝不让失败方的内容留在页文件里（也不盖掉别人的正文）
      } finally {
        if (!committed && planned.staged !== undefined) {
          await planned.staged.discard().catch(() => undefined);
        }
      }
    }
    const current = await readJsonFileOrNull(paths.manifestPath);
    return {
      ok: false,
      code: 'conflict',
      message: `文档并发写入冲突：重试 ${MAX_COMMIT_ATTEMPTS} 次仍未提交成功，本次保存未生效，盘上仍是提交前的内容`,
      details: {
        documentId,
        attemptedVersion,
        manifestVersionOnDisk:
          current.ok && isDfgManifest(current.value) ? current.value.version : null,
        published: false,
      },
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
        // 非递归 mkdir：目录已存在即原子冲突（并发/跨进程同名建文档恰一个 201）。
        // F4（票 19 评审）：ENOENT/ENOTDIR 一类的目录变形（数据根被文件占据/根被并发删除）
        // 此前直接上抛 → 500 逐字回显含绝对路径的 message。现在统一映射为类型化 conflict（409）。
        // 注意「ENOENT 第一次」只是数据根还不存在（首用/外部清理）：补建根后重试一次，此后再失败才算变形/竞态。
        for (let attempt = 0; ; attempt += 1) {
          try {
            await mkdir(paths.value.dir);
            break;
          } catch (mkdirError) {
            const code = (mkdirError as NodeJS.ErrnoException).code;
            if (code === 'EEXIST') {
              return { ok: false, code: 'doc_exists', message: '同名文档已存在', details: { id } };
            }
            if (code === 'ENOENT' && attempt === 0) {
              await ensureDir(paths.value.root);
              continue;
            }
            if (code === 'ENOENT' || code === 'ENOTDIR') {
              return createRaceLost(id, 'mkdir');
            }
            throw mkdirError;
          }
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
        // mkdir 之后任何一步失败都必须撤掉刚建的目录：留下的无 manifest 空壳在读侧只会
        // doc_not_found，而名字被 EEXIST 永久占住（票 19 的可观测后果）。
        try {
          const pagePath = await resolvePagePath(paths.value, id, 'page-1');
          if (pagePath === null) {
            await removeTree(paths.value.dir);
            return invalidPageId();
          }
          await writeFileAtomic(pagePath, '{}\n', DOC_FILE_MODE);
          await writeFileAtomic(
            paths.value.manifestPath,
            `${JSON.stringify(manifest, null, 2)}\n`,
            DOC_FILE_MODE,
          );
          return { ok: true, value: await summaryOf(id, paths.value, manifest) };
        } catch (error) {
          // 只撤自己刚建的目录；回滚本身失败也要抛出，不掩盖「名字可能被残骸占住」
          await removeTree(paths.value.dir);
          // F4：评审实测 create/delete 竞态在提交段 rename 抛 ENOENT（message 带绝对路径直落 500）。
          // 目录已清理，对调用方返回类型化 conflict——竞态/外部删除是「同名目录此刻不归你写」，不是内部错误。
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT' || code === 'ENOTDIR') return createRaceLost(id, 'commit');
          throw error;
        }
      });
    },

    async get(documentId: string): Promise<StoreResult<DocumentSummary>> {
      const paths = await resolveDocPaths(documentId);
      if (!paths.ok) return paths;
      const manifest = await readManifestAt(paths.value, documentId);
      if (!manifest.ok) return manifest;
      return { ok: true, value: await summaryOf(documentId, paths.value, manifest.value) };
    },

    async getDetail(documentId: string): Promise<StoreResult<DocumentDetailResponse>> {
      const paths = await resolveDocPaths(documentId);
      if (!paths.ok) return paths;
      const manifest = await readManifestAt(paths.value, documentId);
      if (!manifest.ok) return manifest;
      return {
        ok: true,
        value: {
          document: await summaryOf(documentId, paths.value, manifest.value),
          // manifest 页列表原样给出（顺序 = 页面顺序；页 id 由 daemon 跳号分配，不与位置同名）
          pages: manifest.value.pages.map((page) => ({ ...page })),
        },
      };
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
        if (!manifest.ok) {
          // 空壳目录（`create()` 在 mkdir 之后失败留下的无 manifest 目录）必须可删——
          // 否则该名字被 EEXIST 永久占用，而读侧又只会回 doc_not_found，没有任何恢复路径。
          // 只放通「manifest 文件不存在」这一种失败：存在但损坏仍回 doc_invalid_manifest，
          // 免得把可能还有救的正文连同不可解析的元数据一起递归删掉。
          if (manifest.code !== 'doc_not_found') return manifest;
          const shell = await lstat(paths.value.dir).catch(() => null);
          if (shell === null || !shell.isDirectory() || shell.isSymbolicLink()) return manifest;
          // 对象级收口（F6）：无 manifest 的目录只可能是 create() 中途失败留下的空壳，
          // 递归删只对「条目全属守护进程自有名（manifest.json / pages/ / *.tmp）」成立；
          // 混入外来内容即拒绝——绝不能把用户自己塞进 .dfg/ 的文件一并递归删掉。
          const shellEntries = await readdir(paths.value.dir).catch(() => null);
          if (shellEntries === null) return manifest;
          const foreign = shellEntries.filter(
            (entry) => entry !== 'manifest.json' && entry !== 'pages' && !entry.endsWith('.tmp'),
          );
          if (foreign.length > 0) {
            return {
              ok: false,
              code: 'doc_invalid_id',
              message:
                '无 manifest 的 .dfg 目录含非守护进程自有的条目，已拒绝递归删除（请先手动清理外来文件）',
              details: {
                documentId,
                foreignEntries: foreign.slice(0, 8),
                foreignCount: foreign.length,
              },
            };
          }
        }
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
        await removeTree(paths.value.dir);
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
      if (exceedsJsonDepth(body, MAX_JSON_DEPTH)) {
        return {
          ok: false,
          code: 'doc_invalid_body',
          message: `正文嵌套深度超过上限 ${MAX_JSON_DEPTH} 层（拒绝序列化以避免栈溢出）`,
          details: { documentId, pageId, maxDepth: MAX_JSON_DEPTH },
        };
      }
      // 引用完整性守门（票 17）：画布页信封的悬空组件引用拒绝落盘（盘上零变化——
      // 在取锁/写正文之前拒绝；读回侧 parseDocument 全校验，写读同强度）。
      // F4（票 19 评审）：守门对不可转字符串的节点标识（如 {toString:1}）会抛 TypeError——
      // 评审实测异常逃出 store、500 逐字回显 "Cannot convert object to primitive value"。
      // 那是客户端正文问题，一律收敛为类型化 422（拒绝落盘，盘上零变化），不许逃成 500。
      let integrity: string[] | null;
      try {
        integrity = canvasPageReferenceIssues(body);
      } catch {
        return {
          ok: false,
          code: 'doc_invalid_structure',
          message: '画布页正文结构无法解析（节点标识字段必须是可转字符串的值），已拒绝落盘',
          details: { documentId, pageId, reason: 'integrity-check-aborted' },
        };
      }
      if (integrity !== null) {
        // 引用清单必须截断（F5）：全量拼接 1MB 请求可炸出 2MB 响应。与 web 侧
        // documents-client.ts:281-282 同口径——最多 8 条 + 总数，消息与 details.issues 都截。
        const shown = integrity.slice(0, 8);
        const suffix = integrity.length > 8 ? `…共 ${String(integrity.length)} 条` : '';
        return {
          ok: false,
          code: 'doc_invalid_structure',
          message: `画布页正文引用不完整，已拒绝落盘：${shown.join('；')}${suffix}`,
          details: { documentId, pageId, issues: shown, issueCount: integrity.length },
        };
      }
      const pagePath = await resolvePagePath(paths.value, documentId, pageId);
      if (pagePath === null) return invalidPageId();
      return lock.run(documentId, async () => {
        return commitManifest(documentId, paths.value, async (current) => {
          const page = current.pages.find((item) => item.id === pageId);
          if (page === undefined) return { ok: false, result: pageNotFound(documentId, pageId) };
          // 提交点之前证明发布目标可替换（F3）：正文路径是目录则 publish 必 EISDIR、
          // 而那时 manifest 已前移——此路只会让文档比调用之前更糟，故在写 manifest 之前拒。
          if (await bodyTargetIsDirectory(pagePath)) {
            return {
              ok: false,
              result: {
                ok: false,
                code: 'doc_invalid_body',
                message: '页面正文发布目标不可替换（同名条目是目录），已在提交点之前拒绝',
                details: { documentId, pageId, reason: 'target-not-replaceable' },
              },
            };
          }
          const now = new Date().toISOString();
          const nextPage: DfgPageMeta = { ...page, updatedAt: now };
          // 正文只暂存不发布：manifest 才是提交点，提交成功（且复读确认）之后才 rename 到目标名。
          // 早于提交点落盘会让「失败的保存」把正文留在盘上（409 却数据已变），
          // 还可能盖掉别的进程已提交的正文（票 19）。
          const staged = await stageFileAtomic(
            pagePath,
            `${JSON.stringify(body, null, 2)}\n`,
            DOC_FILE_MODE,
          );
          const next: DfgManifest = {
            ...current,
            version: current.version + 1,
            updatedAt: now,
            pages: current.pages.map((item) => (item.id === pageId ? nextPage : item)),
          };
          return { ok: true, next, value: nextPage, staged };
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
          // 同 savePage：提交点之前证明新页正文目标可替换（F3），目录残骸即拒，manifest 不前移。
          if (await bodyTargetIsDirectory(pagePath)) {
            return {
              ok: false,
              result: {
                ok: false,
                code: 'doc_invalid_body',
                message: '页面正文发布目标不可替换（同名条目是目录），已在提交点之前拒绝',
                details: { documentId, pageId, reason: 'target-not-replaceable' },
              },
            };
          }
          const now = new Date().toISOString();
          const page: DfgPageMeta = { id: pageId, name: name.trim(), updatedAt: now };
          // 同 savePage：空正文也只暂存，提交点确认后才发布，失败不留下孤儿页文件。
          const staged = await stageFileAtomic(pagePath, '{}\n', DOC_FILE_MODE);
          const next: DfgManifest = {
            ...current,
            version: current.version + 1,
            updatedAt: now,
            pages: [...current.pages, page],
          };
          return { ok: true, next, value: page, staged };
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
