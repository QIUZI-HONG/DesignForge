/**
 * ODS 层规整（规格 §4.1 目录布局 / §4.2 落盘格式 / §4.3 幂等）。
 *
 * 输入 = MK-01 采集器产物（`ods/raw_*.jsonl` + `replay/<runId>/responses.jsonl` 录制正文）；
 * 输出 = 规格形态的 ODS 层：
 * ```
 * <out>/raw_events/date=<YYYY-MM-DD>/<runId>.jsonl.gz      # gzip JSONL，逐字节保真
 * <out>/raw_snapshots/<owner>__<repo>/<commit>/files.json  # 文件级 sha256 + 一仓一记录
 * <out>/blobs/<sha256>                                     # 正文内容寻址（自动去重）
 * ```
 *
 * 三条纪律：
 *   1. **只追加**：同路径已有文件且内容不同 → 记 `conflict`，**不覆盖**（历史不可改写）；
 *   2. **无损**：事件 gzip 解压后与来源逐字节一致（来源 sha256 可比对）；
 *   3. **幂等**：同输入重复执行 → 内容不变（第二次 blobsWritten=0）。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

import type {
  OdsFileEntry,
  OdsRepoFilesSnapshot,
  OdsSourceFile,
  OdsValidationIssue,
  RawEvent,
  TreeEntry,
} from '../types.ts';
import { readOdsSource } from './read.ts';
import { computeSnapshotDigest, validateFilesSnapshot, validateSnapshotDigest } from './schema.ts';

export interface MaterializeInput {
  /** MK-01 形状的输入根（含 `ods/` 与可选 `replay/`）。 */
  source: string;
  /** 规格形态的输出根（即 `data/ods`）。 */
  out: string;
}

export interface MaterializeArtifact {
  path: string;
  sha256: string;
  length: number;
}

export interface MaterializeResult {
  odsRoot: string;
  eventFiles: string[];
  snapshotFiles: string[];
  blobFiles: string[];
  blobsWritten: number;
  blobsDeduped: number;
  filesWritten: number;
  filesSkipped: number;
  conflicts: OdsValidationIssue[];
  sources: OdsSourceFile[];
  issues: OdsValidationIssue[];
  artifacts: MaterializeArtifact[];
}

const CONTENT_TYPE_BY_EXT: Record<string, 'text' | 'binary'> = {
  md: 'text',
  markdown: 'text',
  txt: 'text',
  json: 'text',
  jsonc: 'text',
  css: 'text',
  scss: 'text',
  html: 'text',
  htm: 'text',
  svg: 'text',
  js: 'text',
  mjs: 'text',
  cjs: 'text',
  ts: 'text',
  tsx: 'text',
  jsx: 'text',
  yml: 'text',
  yaml: 'text',
  toml: 'text',
  sh: 'text',
  py: 'text',
  csv: 'text',
  xml: 'text',
  png: 'binary',
  jpg: 'binary',
  jpeg: 'binary',
  gif: 'binary',
  webp: 'binary',
  ico: 'binary',
  pdf: 'binary',
  zip: 'binary',
  gz: 'binary',
  wasm: 'binary',
  woff: 'binary',
  woff2: 'binary',
  ttf: 'binary',
  otf: 'binary',
  mp4: 'binary',
};

/** 媒体类型判定：按扩展名，许可文件按名识文（下载范围只含描述性文本，规格 §8.1）。 */
export function classifyMediaType(path: string): 'text' | 'binary' | 'unknown' {
  const base = path.split('/').pop() ?? path;
  if (/^(LICENSE|LICENCE|COPYING|NOTICE)(\.(md|txt|rst))?$/i.test(base)) return 'text';
  const dot = base.lastIndexOf('.');
  if (dot < 0) return 'unknown';
  return CONTENT_TYPE_BY_EXT[base.slice(dot + 1).toLowerCase()] ?? 'unknown';
}

/** 仓库快照目录名：`<owner>__<repo>`（分隔符避免与路径分隔冲突）。 */
export function repoDirName(fullName: string): string {
  return fullName.replace('/', '__');
}

/** 一仓文件清单摘要（`路径\0blobSha\0size\n` 字典序，与采集侧口径一致）。 */
export function listingDigest(
  files: { path: string; gitSha: string; size: number | null }[],
): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const lines = sorted.map((file) => `${file.path}\0${file.gitSha}\0${file.size ?? 0}\n`).join('');
  return `sha256:${createHash('sha256').update(lines, 'utf8').digest('hex')}`;
}

/** 写文件但遵守「只追加」：已存在且内容相同 → 跳过；内容不同 → 冲突。 */
async function writeAppendOnly(
  path: string,
  content: string,
): Promise<'written' | 'skipped' | 'conflict'> {
  try {
    const existing = await readFile(path, 'utf8');
    return existing === content ? 'skipped' : 'conflict';
  } catch {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
    return 'written';
  }
}

/** 从事件 URL 反查一仓请求窗口内的配额余量下限。 */
function quotaLeftForRecord(record: { requestUrls: string[] }, events: RawEvent[]): number | null {
  const urls = new Set(record.requestUrls);
  let min: number | null = null;
  for (const event of events) {
    if (!urls.has(event.request.url)) continue;
    const remaining = event.response.quota?.remaining ?? null;
    if (remaining === null) continue;
    min = min === null ? remaining : Math.min(min, remaining);
  }
  return min;
}

/** 解析 contents 录制正文（base64 → UTF-8 文本；非文本如实返回 null）。 */
function decodeContentsBody(body: unknown): string | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (record.encoding !== 'base64') return null;
  const content = record.content;
  if (typeof content !== 'string' || content.trim() === '') return null;
  return Buffer.from(content.replace(/\n/g, ''), 'base64').toString('utf8');
}

/** 解析 Trees 录制正文 → blob 条目。 */
function parseTreeBody(body: unknown): TreeEntry[] | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const raw = (body as Record<string, unknown>).tree;
  if (!Array.isArray(raw)) return null;
  const entries: TreeEntry[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const type = entry.type;
    if (type !== 'blob' && type !== 'tree' && type !== 'commit') continue;
    if (typeof entry.path !== 'string' || typeof entry.sha !== 'string') continue;
    const size = typeof entry.size === 'number' ? entry.size : undefined;
    entries.push(
      size === undefined
        ? { path: entry.path, type, sha: entry.sha }
        : { path: entry.path, type, sha: entry.sha, size },
    );
  }
  return entries;
}

interface RecordedIndex {
  treeByRepo: Map<string, TreeEntry[]>;
  textByRepoPath: Map<string, string>;
}

/** 汇总录制正文：按仓库索引 Trees 清单与 contents 文本。 */
function indexRecordedBodies(recordedBodies: Map<string, unknown>): RecordedIndex {
  const treeByRepo = new Map<string, TreeEntry[]>();
  const textByRepoPath = new Map<string, string>();
  for (const [url, body] of recordedBodies) {
    const treeMatch = url.match(/\/repos\/([^/]+\/[^/]+)\/git\/trees\//);
    if (treeMatch?.[1] !== undefined) {
      const entries = parseTreeBody(body);
      if (entries !== null) treeByRepo.set(treeMatch[1], entries);
      continue;
    }
    const contentsMatch = url.match(/\/repos\/([^/]+\/[^/]+)\/contents\/(.+?)(?:\?|$)/);
    if (contentsMatch?.[1] !== undefined && contentsMatch[2] !== undefined) {
      const text = decodeContentsBody(body);
      if (text !== null) {
        textByRepoPath.set(`${contentsMatch[1]}#${decodeURIComponent(contentsMatch[2])}`, text);
      }
    }
  }
  return { treeByRepo, textByRepoPath };
}

/** 由事件文件路径取出分区日期（`date=YYYY-MM-DD`），取不到时退回事件时间戳。 */
function datePartitionOf(path: string, events: RawEvent[]): string {
  const match = path.match(/date=(\d{4}-\d{2}-\d{2})/);
  if (match?.[1] !== undefined) return match[1];
  const ts = events[0]?.ts;
  if (ts !== undefined && ts.length >= 10) return ts.slice(0, 10);
  throw new Error(`无法确定事件分区日期：${path}`);
}

/** 规整 ODS（重入安全：只追加、幂等）。 */
export async function materializeOds(input: MaterializeInput): Promise<MaterializeResult> {
  const bundle = await readOdsSource(input.source);
  const { treeByRepo, textByRepoPath } = indexRecordedBodies(bundle.recordedBodies);

  const issues: OdsValidationIssue[] = [...bundle.issues];
  const conflicts: OdsValidationIssue[] = [];
  const artifacts: MaterializeArtifact[] = [];
  const blobFiles: string[] = [];
  const snapshotFiles: string[] = [];
  const eventFiles: string[] = [];
  let blobsWritten = 0;
  let blobsDeduped = 0;
  let filesWritten = 0;
  let filesSkipped = 0;

  const recordArtifact = async (path: string): Promise<void> => {
    const content = await readFile(path);
    artifacts.push({
      path,
      sha256: `sha256:${createHash('sha256').update(content).digest('hex')}`,
      length: content.byteLength,
    });
  };

  const writeBlob = async (text: string): Promise<string> => {
    const hex = createHash('sha256').update(text, 'utf8').digest('hex');
    const path = join(input.out, 'blobs', hex);
    const outcome = await writeAppendOnly(path, text);
    if (outcome === 'written') blobsWritten += 1;
    else if (outcome === 'skipped') blobsDeduped += 1;
    else {
      conflicts.push({
        path,
        rule: 'blob-corrupt',
        detail: 'blob 路径已存在但内容不一致（内容寻址被破坏）',
      });
    }
    blobFiles.push(path);
    return `sha256:${hex}`;
  };

  // 1) 逐仓快照：文件清单（Trees 录制）+ 正文哈希（contents 录制）
  for (const record of bundle.records) {
    const fullName = record.repo.fullName;
    const entries = treeByRepo.get(fullName);
    const files: OdsFileEntry[] = [];
    if (entries === undefined) {
      issues.push({
        path: `${fullName}@${record.ref}`,
        rule: 'files-listing-missing',
        detail: '未找到该仓 Trees 录制正文，文件清单为空（如实记录，不臆造 sha256）',
      });
    } else {
      for (const entry of entries) {
        if (entry.type !== 'blob') continue;
        const text = textByRepoPath.get(`${fullName}#${entry.path}`);
        const blobRef = text === undefined ? null : await writeBlob(text);
        files.push({
          path: entry.path,
          gitSha: entry.sha,
          size: entry.size ?? null,
          sha256: blobRef,
          blobRef,
          mediaType: classifyMediaType(entry.path),
        });
      }
      const computed = listingDigest(files);
      if (computed !== record.digest) {
        issues.push({
          path: `${fullName}@${record.ref}`,
          rule: 'listing-digest-mismatch',
          detail: `Trees 清单重算 ${computed} 与采集侧记录 ${record.digest} 不一致`,
        });
      }
    }

    const snapshot: OdsRepoFilesSnapshot = {
      schema: 'df.market.ods.files/v1',
      runId: record.runId,
      fetchedAt: record.fetchedAt,
      repoId: record.repo.id,
      fullName,
      ref: record.ref,
      etag: record.etag,
      apiQuotaLeft: quotaLeftForRecord(record, bundle.events),
      isListRepo: record.isListRepo,
      tree: {
        sha: record.tree.sha,
        truncated: record.tree.truncated,
        entryCount: record.tree.entryCount,
        listingDigest: record.digest,
      },
      files,
      record,
      snapshotDigest: '',
    };
    snapshot.snapshotDigest = computeSnapshotDigest(snapshot as unknown as Record<string, unknown>);

    const path = join(input.out, 'raw_snapshots', repoDirName(fullName), record.ref, 'files.json');
    const outcome = await writeAppendOnly(path, `${JSON.stringify(snapshot, null, 2)}\n`);
    if (outcome === 'written') filesWritten += 1;
    else if (outcome === 'skipped') filesSkipped += 1;
    else {
      conflicts.push({
        path,
        rule: 'snapshot-conflict',
        detail: '同 (repoId, commit) 快照已存在且内容不同（只追加：不覆盖历史）',
      });
    }
    snapshotFiles.push(path);
    await recordArtifact(path);
  }

  // 2) 事件：按来源分区与 runId 原样 gzip（解压后逐字节等于来源）
  for (const source of bundle.sources) {
    if (source.kind !== 'raw_events') continue;
    const text = await readFile(source.path, 'utf8');
    const runId =
      source.path
        .split('/')
        .pop()
        ?.replace(/\.jsonl(\.gz)?$/, '') ?? 'unknown';
    const date = datePartitionOf(
      source.path,
      bundle.events.filter((event) => event.runId === runId),
    );
    const path = join(input.out, 'raw_events', `date=${date}`, `${runId}.jsonl.gz`);
    const gz = gzipSync(Buffer.from(text, 'utf8'), { level: 9 });
    const exists = await stat(path).catch(() => null);
    if (exists === null) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, gz);
      filesWritten += 1;
    } else {
      const existing = await readFile(path);
      if (existing.equals(gz)) filesSkipped += 1;
      else {
        conflicts.push({
          path,
          rule: 'event-conflict',
          detail: '同 runId 事件文件已存在且内容不同（只追加：不覆盖历史）',
        });
      }
    }
    eventFiles.push(path);
    await recordArtifact(path);
  }

  issues.push(...conflicts);

  // 3) 自证：写出的快照必须通过 schema 与快照哈希校验（失败即报，不静默）
  for (const path of snapshotFiles) {
    const snapshot = JSON.parse(await readFile(path, 'utf8')) as unknown;
    const found = [...validateFilesSnapshot(snapshot), ...validateSnapshotDigest(snapshot)];
    for (const issue of found)
      issues.push({ path: `${path}:${issue.rule}`, rule: issue.rule, detail: issue.detail });
  }

  return {
    odsRoot: input.out,
    eventFiles,
    snapshotFiles,
    blobFiles: [...new Set(blobFiles)].sort(),
    blobsWritten,
    blobsDeduped,
    filesWritten,
    filesSkipped,
    conflicts,
    sources: bundle.sources,
    issues,
    artifacts,
  };
}
