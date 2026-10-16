/**
 * ODS 原始层落盘（规格 §4.1/§4.3）。
 *
 * 布局（MK-01 口径，gzip 与逐仓 files.json 目录形态留给 MK-02 四层仓）：
 * ```
 * <out>/ods/raw_events/date=<YYYY-MM-DD>/<runId>.jsonl      # 每行 = 一次 API 往返（§4.4）
 * <out>/ods/raw_snapshots/date=<YYYY-MM-DD>/<runId>.jsonl   # 每行 = 一仓一记录（含 fetchedAt/etag/digest）
 * ```
 * 纪律：只追加、行级可审计（LF、无 CR）、按幂等键稳定排序、同输入同输出（确定性）。
 * schema 校验器同时导出，供 `scripts/verify-mk-01.mjs` 复用（单一真源）。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sha256Hex } from './http.ts';
import type { OdsRepoRecord, RawEvent } from './types.ts';

export interface OdsArtifact {
  path: string;
  sha256: string;
  length: number;
}

export interface OdsWriteInput {
  runId: string;
  /** 日期分区（`YYYY-MM-DD`，通常取 asOf 的 UTC 日期；注入以复现）。 */
  date: string;
  records: OdsRepoRecord[];
  events: RawEvent[];
}

export interface OdsWriteResult {
  repoSnapshotsPath: string;
  rawEventsPath: string;
  artifacts: OdsArtifact[];
}

/** JSONL 行序列化：单行 + LF；对象键序由构造顺序保证稳定。 */
function toJsonl(values: unknown[]): string {
  return values.map((v) => `${JSON.stringify(v)}\n`).join('');
}

/** 写 ODS 两个产物文件（records 按 repo.id 升序稳定排序）。 */
export async function writeOds(outDir: string, input: OdsWriteInput): Promise<OdsWriteResult> {
  const eventsDir = join(outDir, 'ods', 'raw_events', `date=${input.date}`);
  const snapshotsDir = join(outDir, 'ods', 'raw_snapshots', `date=${input.date}`);
  await mkdir(eventsDir, { recursive: true });
  await mkdir(snapshotsDir, { recursive: true });

  const sorted = [...input.records].sort((a, b) => a.repo.id - b.repo.id);
  const repoSnapshotsPath = join(snapshotsDir, `${input.runId}.jsonl`);
  const rawEventsPath = join(eventsDir, `${input.runId}.jsonl`);

  const snapshotsContent = toJsonl(sorted);
  const eventsContent = toJsonl(input.events);
  await writeFile(repoSnapshotsPath, snapshotsContent, 'utf8');
  await writeFile(rawEventsPath, eventsContent, 'utf8');

  return {
    repoSnapshotsPath,
    rawEventsPath,
    artifacts: [
      {
        path: repoSnapshotsPath,
        sha256: `sha256:${sha256Hex(snapshotsContent)}`,
        length: Buffer.byteLength(snapshotsContent, 'utf8'),
      },
      {
        path: rawEventsPath,
        sha256: `sha256:${sha256Hex(eventsContent)}`,
        length: Buffer.byteLength(eventsContent, 'utf8'),
      },
    ],
  };
}

export interface OdsValidationIssue {
  path: string;
  rule: string;
  detail: string;
}

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const ASSET_ID_RE = /^gh:[^#\s]+#[^#\s]*$/;

/** ODS 一仓一记录 schema 校验（规格 §4.4 + MK-01 补充字段）。 */
export function validateOdsRepoRecord(value: unknown): OdsValidationIssue[] {
  const issues: OdsValidationIssue[] = [];
  const push = (rule: string, detail: string) => issues.push({ path: 'record', rule, detail });
  if (value === null || typeof value !== 'object') {
    push('record-object', '记录不是对象');
    return issues;
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== 'df.market.ods.repo/v1')
    push('schema', 'schema 必须为 df.market.ods.repo/v1');
  if (typeof record.runId !== 'string' || record.runId === '') push('runId-present', '缺 runId');
  if (typeof record.fetchedAt !== 'string' || record.fetchedAt === '') {
    push('fetchedAt-present', '缺 fetchedAt（ISO8601）');
  }
  if (!('etag' in record)) push('etag-present', '缺 etag 字段（可为 null）');
  if (typeof record.digest !== 'string' || !SHA256_RE.test(record.digest)) {
    push('digest-format', 'digest 必须形如 sha256:<64hex>');
  }
  if (typeof record.ref !== 'string' || !/^[0-9a-f]{40}$/.test(record.ref)) {
    push('ref-format', 'ref 必须为 40 位 commit hex');
  }

  const repo = record.repo;
  if (repo === null || typeof repo !== 'object') {
    push('repo-object', '缺 repo 对象');
  } else {
    const repoRecord = repo as Record<string, unknown>;
    if (typeof repoRecord.id !== 'number') push('repo-id', 'repo.id 必须为数字（去重主键）');
    if (typeof repoRecord.fullName !== 'string')
      push('repo-fullname', 'repo.fullName 必须为字符串');
    // 对接面修复（MK-05 阶段 A）：冷启动判定与生态维的输入必须随仓落盘。
    if (typeof repoRecord.createdAt !== 'string') {
      push('repo-created-at', 'repo.createdAt 必须为字符串（空串 = 上游未给，如实缺省）');
    }
    const stars90d = repoRecord.stars90dAgo;
    if (stars90d !== null && !(typeof stars90d === 'number' && stars90d >= 0)) {
      push('repo-stars-90d', 'repo.stars90dAgo 必须为 null 或 ≥0 数字（未取到如实留 null）');
    }
  }

  const tree = record.tree;
  if (
    tree === null ||
    typeof tree !== 'object' ||
    typeof (tree as Record<string, unknown>).truncated !== 'boolean'
  ) {
    push('tree-shape', 'tree.{sha,truncated,entryCount} 必填');
  }

  const license = record.license;
  if (license === null || typeof license !== 'object') {
    push('license-object', '缺 license 判定对象');
  } else {
    const gate = (license as Record<string, unknown>).gate;
    if (gate !== 'loadable' && gate !== 'view-only' && gate !== 'blocked') {
      push('license-gate', 'license.gate 必须为 loadable|view-only|blocked');
    }
  }

  const assets = record.assets;
  if (!Array.isArray(assets)) {
    push('assets-array', 'assets 必须为数组');
  } else {
    for (const asset of assets) {
      if (asset === null || typeof asset !== 'object') {
        push('asset-object', '资产项不是对象');
        continue;
      }
      const a = asset as Record<string, unknown>;
      if (typeof a.id !== 'string' || !ASSET_ID_RE.test(a.id)) {
        push(
          'asset-id-format',
          `资产 id 必须形如 gh:<owner>/<repo>#<path>（实际：${String(a.id)}）`,
        );
      }
      if (!['skill', 'plugin', 'design-system', 'template'].includes(String(a.kind))) {
        push('asset-kind', `资产 kind 非法：${String(a.kind)}`);
      }
      if (typeof a.treeDigest !== 'string' || !SHA256_RE.test(a.treeDigest)) {
        push('asset-tree-digest', 'asset.treeDigest 必须形如 sha256:<64hex>');
      }
      if (!['ok', 'non-compliant', 'deferred'].includes(String(a.compliance))) {
        push('asset-compliance', `资产 compliance 非法：${String(a.compliance)}`);
      }
      if (!Array.isArray(a.checks) || (a.checks as unknown[]).length === 0) {
        push('asset-checks', '资产必须带 checks（内容校验结论）');
      }
    }
  }

  if (typeof record.isListRepo !== 'boolean') push('is-list-repo', 'isListRepo 必须为布尔');
  return issues;
}

/** raw_events 一行 schema 校验（规格 §4.4：每次请求记证据）。 */
export function validateRawEvent(value: unknown): OdsValidationIssue[] {
  const issues: OdsValidationIssue[] = [];
  const push = (rule: string, detail: string) => issues.push({ path: 'event', rule, detail });
  if (value === null || typeof value !== 'object') {
    push('event-object', '事件不是对象');
    return issues;
  }
  const event = value as Record<string, unknown>;
  const request = event.request;
  if (request === null || typeof request !== 'object') {
    push('request-object', '缺 request');
    return issues;
  }
  const requestRecord = request as Record<string, unknown>;
  if (requestRecord.method !== 'GET') {
    push('method-get-only', `请求方法必须为 GET（实际 ${String(requestRecord.method)}）`);
  }
  if (typeof requestRecord.url !== 'string') push('request-url', '缺 request.url');
  if (requestRecord.kind !== 'core' && requestRecord.kind !== 'search') {
    push('request-kind', 'request.kind 必须为 core|search');
  }
  const response = event.response;
  if (response === null || typeof response !== 'object') {
    push('response-object', '缺 response');
    return issues;
  }
  const responseRecord = response as Record<string, unknown>;
  if (typeof responseRecord.status !== 'number')
    push('response-status', 'response.status 必须为数字');
  if (typeof responseRecord.countedAgainstBudget !== 'boolean') {
    push('response-counted', 'response.countedAgainstBudget 必须为布尔');
  }
  if (typeof event.durationMs !== 'number') push('duration-ms', '缺 durationMs');
  return issues;
}
