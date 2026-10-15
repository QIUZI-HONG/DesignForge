/**
 * ODS 读取（规格 §4.1 形态 = DWD 的唯一输入；MK-01 形状 = 规整输入）。
 *
 * 两个入口：
 *   - `readOdsSource(root)`：读 MK-01 产物（`ods/raw_*.jsonl[.gz]` + `replay/<runId>/responses.jsonl`
 *     录制正文），供 `materializeOds` 规整；
 *   - `readOds(root)`：读本票规整后的规格形态（gzip 事件 + 逐仓 `files.json` + `blobs/`），供 DWD 构建。
 *
 * 纪律：缺层目录 → `OdsMissingError`（阻塞语义）；坏行/坏 schema → 记入 `issues` 但仍返回可审计数据，
 * 由调用方决定退出码——**不静默丢弃、不空集假绿**（规格 §4.3、后端验收口径 §6.1）。
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import type {
  OdsRepoFilesSnapshot,
  OdsRepoRecord,
  OdsSourceFile,
  OdsValidationIssue,
  RawEvent,
} from '../types.ts';
import { validateFilesSnapshot, validateOdsRepoRecord, validateRawEvent } from './schema.ts';

/** ODS 层缺失（阻塞：不得当作「空数据通过」）。 */
export class OdsMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OdsMissingError';
  }
}

export interface OdsSourceBundle {
  records: OdsRepoRecord[];
  events: RawEvent[];
  sources: OdsSourceFile[];
  issues: OdsValidationIssue[];
  /** 录制响应（MK-01 replay）：URL → 响应体（正文与 Trees 清单的来源）。 */
  recordedBodies: Map<string, unknown>;
}

export interface OdsBundle {
  records: OdsRepoRecord[];
  snapshots: OdsRepoFilesSnapshot[];
  events: RawEvent[];
  sources: OdsSourceFile[];
  issues: OdsValidationIssue[];
  /** blob 引用（`sha256:<hex>`）→ 磁盘路径。 */
  blobs: Map<string, string>;
}

/** 目录是否存在（不区分文件/目录）。 */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 定位 ODS 层目录：`<root>/ods`（证据根）或 `<root>`（已是 ODS 层）。
 * 两种形态都合法：MK-01 产物在 `<evidence>/ods/`，四层仓数据面直接是 `data/ods/`。
 */
export async function resolveOdsRoot(root: string): Promise<string> {
  const nested = join(root, 'ods');
  if (await exists(join(nested, 'raw_events'))) return nested;
  if (await exists(join(root, 'raw_events'))) return root;
  throw new OdsMissingError(`未找到 ODS 层：${root}（缺 raw_events/，或 <root>/ods/raw_events/）`);
}

/** 列出一个层目录下的 JSONL 文件（`.jsonl` / `.jsonl.gz`），按路径排序保证确定性。 */
async function listJsonl(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return [];
  const dates = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const out: string[] = [];
  for (const date of dates) {
    const files = (await readdir(join(dir, date)))
      .filter((name) => name.endsWith('.jsonl') || name.endsWith('.jsonl.gz'))
      .sort();
    for (const name of files) out.push(join(dir, date, name));
  }
  return out;
}

/** 读 JSONL（自动识别 gzip），返回文本与逐行解析结果（坏行以 undefined 占位）。 */
async function readJsonl(path: string): Promise<{
  text: string;
  sha256: string;
  length: number;
  lineCount: number;
  rows: unknown[];
}> {
  const raw = await readFile(path);
  const bytes = path.endsWith('.gz') ? gunzipSync(raw) : raw;
  const text = bytes.toString('utf8');
  const lines = text.split('\n').filter((line) => line !== '');
  const rows: unknown[] = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line) as unknown);
    } catch {
      rows.push(undefined);
    }
  }
  return {
    text,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    length: bytes.byteLength,
    lineCount: lines.length,
    rows,
  };
}

/** 读取 MK-01 形状的 ODS 产物 + replay 录制。 */
export async function readOdsSource(root: string): Promise<OdsSourceBundle> {
  const odsRoot = await resolveOdsRoot(root);
  const records: OdsRepoRecord[] = [];
  const events: RawEvent[] = [];
  const sources: OdsSourceFile[] = [];
  const issues: OdsValidationIssue[] = [];

  for (const path of await listJsonl(join(odsRoot, 'raw_snapshots'))) {
    const content = await readJsonl(path);
    sources.push({
      path,
      kind: 'raw_snapshots',
      sha256: content.sha256,
      length: content.length,
      lineCount: content.lineCount,
    });
    content.rows.forEach((row, index) => {
      const found = validateOdsRepoRecord(row);
      if (found.length > 0) {
        for (const issue of found) {
          issues.push({ ...issue, path: `${path}:${index + 1}:${issue.path}` });
        }
        return;
      }
      records.push(row as OdsRepoRecord);
    });
  }

  for (const path of await listJsonl(join(odsRoot, 'raw_events'))) {
    const content = await readJsonl(path);
    sources.push({
      path,
      kind: 'raw_events',
      sha256: content.sha256,
      length: content.length,
      lineCount: content.lineCount,
    });
    content.rows.forEach((row, index) => {
      const found = validateRawEvent(row);
      if (found.length > 0) {
        for (const issue of found) {
          issues.push({ ...issue, path: `${path}:${index + 1}:${issue.path}` });
        }
        return;
      }
      events.push(row as RawEvent);
    });
  }

  if (records.length === 0 && issues.length === 0) {
    throw new OdsMissingError(`ODS 层无任何一仓一记录：${odsRoot}`);
  }

  // 录制响应（可选）：`<root>/replay/<runId>/responses.jsonl` 或 `<odsRoot>/bodies/responses.jsonl`
  //
  // 口径：**同一 URL 取「最近一次真正带回正文」的那份**。理由：增量采集里后续 run 常命中
  // ETag（304，正文为空），若按 run 顺序无条件覆盖，早先取回的正文会被空串冲掉，
  // 文件级 sha256 与 blob 会整片丢失（实测发生过）。
  const recordedBodies = new Map<string, unknown>();
  const usableBody = (body: unknown): boolean =>
    (body !== null && typeof body === 'object') || (typeof body === 'string' && body.trim() !== '');
  for (const candidate of [join(root, 'replay'), join(odsRoot, 'bodies'), join(root, 'bodies')]) {
    if (!(await exists(candidate))) continue;
    const runDirs = (await readdir(candidate, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const runDir of runDirs) {
      const path = join(candidate, runDir, 'responses.jsonl');
      if (!(await exists(path))) continue;
      const content = await readJsonl(path);
      sources.push({
        path,
        kind: 'replay',
        sha256: content.sha256,
        length: content.length,
        lineCount: content.lineCount,
      });
      for (const row of content.rows) {
        if (row === null || typeof row !== 'object') continue;
        const record = row as Record<string, unknown>;
        if (typeof record.url !== 'string') continue;
        if (recordedBodies.get(record.url) === undefined || usableBody(record.body)) {
          recordedBodies.set(record.url, record.body);
        }
      }
    }
  }

  return { records, events, sources, issues, recordedBodies };
}

/** 读取本票规整后的规格形态 ODS（DWD 的唯一输入）。 */
export async function readOds(root: string): Promise<OdsBundle> {
  const odsRoot = await resolveOdsRoot(root);
  const records: OdsRepoRecord[] = [];
  const snapshots: OdsRepoFilesSnapshot[] = [];
  const events: RawEvent[] = [];
  const sources: OdsSourceFile[] = [];
  const issues: OdsValidationIssue[] = [];

  const snapshotRoot = join(odsRoot, 'raw_snapshots');
  if (!(await exists(snapshotRoot))) {
    throw new OdsMissingError(`缺 ODS 快照层：${snapshotRoot}（规格 §4.1 raw_snapshots/）`);
  }

  const repos = (await readdir(snapshotRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const repoDir of repos) {
    const commits = (await readdir(join(snapshotRoot, repoDir), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const commit of commits) {
      const path = join(snapshotRoot, repoDir, commit, 'files.json');
      if (!(await exists(path))) continue;
      const text = await readFile(path, 'utf8');
      sources.push({
        path,
        kind: 'raw_snapshots',
        sha256: `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`,
        length: Buffer.byteLength(text, 'utf8'),
        lineCount: null,
      });
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch (error) {
        issues.push({
          path,
          rule: 'snapshot-parse',
          detail: `JSON 解析失败：${(error as Error).message}`,
        });
        continue;
      }
      const found = validateFilesSnapshot(parsed);
      if (found.length > 0) {
        for (const issue of found) issues.push({ ...issue, path: `${path}:${issue.rule}` });
        continue;
      }
      const snapshot = parsed as OdsRepoFilesSnapshot;
      snapshots.push(snapshot);
      records.push(snapshot.record);
    }
  }

  for (const path of await listJsonl(join(odsRoot, 'raw_events'))) {
    const content = await readJsonl(path);
    sources.push({
      path,
      kind: 'raw_events',
      sha256: content.sha256,
      length: content.length,
      lineCount: content.lineCount,
    });
    content.rows.forEach((row, index) => {
      const found = validateRawEvent(row);
      if (found.length > 0) {
        for (const issue of found) {
          issues.push({ ...issue, path: `${path}:${index + 1}:${issue.path}` });
        }
        return;
      }
      events.push(row as RawEvent);
    });
  }

  if (snapshots.length === 0) {
    throw new OdsMissingError(`ODS 快照层为空：${snapshotRoot}`);
  }

  // blob 索引（内容寻址：文件名即 sha256 hex）
  const blobs = new Map<string, string>();
  const blobRoot = join(odsRoot, 'blobs');
  if (await exists(blobRoot)) {
    for (const name of (await readdir(blobRoot)).sort()) {
      if (/^[0-9a-f]{64}$/.test(name)) blobs.set(`sha256:${name}`, join(blobRoot, name));
    }
  }

  return { records, snapshots, events, sources, issues, blobs };
}

/** 按 blob 引用取正文（未采集 → null，调用方必须如实降级，不得臆造）。 */
export async function readBlobText(
  bundle: Pick<OdsBundle, 'blobs'>,
  blobRef: string | null,
): Promise<string | null> {
  if (blobRef === null) return null;
  const path = bundle.blobs.get(blobRef);
  if (path === undefined) return null;
  return readFile(path, 'utf8');
}
