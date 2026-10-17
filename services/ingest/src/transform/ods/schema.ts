/**
 * ODS 层 schema 校验（规格 §4.1 布局 / §4.4 字段 / §4.3 幂等）。
 *
 * 三类对象各自有稳定规则码：
 *   1. `validateOdsRepoRecord` —— 一仓一记录（MK-01 口径镜像，见 types.ts 归属说明）；
 *   2. `validateRawEvent`      —— 每次 API 往返事件（含 GET 纪律与预算记账）；
 *   3. `validateFilesSnapshot` —— 规格 §4.1 `raw_snapshots/.../files.json`（本票新增层）。
 *
 * 纪律：校验器只报问题、不做修复；调用方（CLI/门禁）据 issues 决定退出码，禁止假绿。
 * 词表同源：kind/gate/compliance 词表真源在 `@dforge/contracts`（ADR-0004 ③ 收敛），
 * 本层只消费守卫，不写字面量。
 */

import { createHash } from 'node:crypto';

import { isLicenseGate, isMarketAssetKind, isMarketCompliance } from '@dforge/contracts';

import { type OdsValidationIssue, SHA256_RE } from '../types.ts';
import { stableStringify } from './canonical.ts';

const ASSET_ID_RE = /^gh:[^#\s]+#[^#\s]*$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const GIT_SHA_RE = /^[0-9a-f]{7,40}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 一仓一记录 schema 校验（与 MK-01 规则码一致，便于两票门禁互换）。 */
export function validateOdsRepoRecord(value: unknown): OdsValidationIssue[] {
  const issues: OdsValidationIssue[] = [];
  const push = (rule: string, detail: string) => issues.push({ path: 'record', rule, detail });
  if (!isObject(value)) {
    push('record-object', '记录不是对象');
    return issues;
  }
  if (value.schema !== 'df.market.ods.repo/v1')
    push('schema', 'schema 必须为 df.market.ods.repo/v1');
  if (typeof value.runId !== 'string' || value.runId === '') push('runId-present', '缺 runId');
  if (typeof value.fetchedAt !== 'string' || value.fetchedAt === '') {
    push('fetchedAt-present', '缺 fetchedAt（ISO8601）');
  }
  if (!('etag' in value)) push('etag-present', '缺 etag 字段（可为 null）');
  if (typeof value.digest !== 'string' || !SHA256_RE.test(value.digest)) {
    push('digest-format', 'digest 必须形如 sha256:<64hex>');
  }
  if (typeof value.ref !== 'string' || !COMMIT_RE.test(value.ref)) {
    push('ref-format', 'ref 必须为 40 位 commit hex');
  }

  const repo = value.repo;
  if (!isObject(repo)) {
    push('repo-object', '缺 repo 对象');
  } else {
    if (typeof repo.id !== 'number') push('repo-id', 'repo.id 必须为数字（去重主键）');
    if (typeof repo.fullName !== 'string') push('repo-fullname', 'repo.fullName 必须为字符串');
  }

  const tree = value.tree;
  if (!isObject(tree) || typeof tree.truncated !== 'boolean') {
    push('tree-shape', 'tree.{sha,truncated,entryCount} 必填');
  }

  const license = value.license;
  if (!isObject(license)) {
    push('license-object', '缺 license 判定对象');
  } else if (!isLicenseGate(license.gate)) {
    push('license-gate', 'license.gate 必须为 loadable|view-only|blocked');
  }

  const assets = value.assets;
  if (!Array.isArray(assets)) {
    push('assets-array', 'assets 必须为数组');
  } else {
    for (const asset of assets) {
      if (!isObject(asset)) {
        push('asset-object', '资产项不是对象');
        continue;
      }
      if (typeof asset.id !== 'string' || !ASSET_ID_RE.test(asset.id)) {
        push(
          'asset-id-format',
          `资产 id 必须形如 gh:<owner>/<repo>#<path>（实际：${String(asset.id)}）`,
        );
      }
      if (!isMarketAssetKind(asset.kind))
        push('asset-kind', `资产 kind 非法：${String(asset.kind)}`);
      if (typeof asset.treeDigest !== 'string' || !SHA256_RE.test(asset.treeDigest)) {
        push('asset-tree-digest', 'asset.treeDigest 必须形如 sha256:<64hex>');
      }
      if (!isMarketCompliance(asset.compliance)) {
        push('asset-compliance', `资产 compliance 非法：${String(asset.compliance)}`);
      }
      if (!Array.isArray(asset.checks) || asset.checks.length === 0) {
        push('asset-checks', '资产必须带 checks（内容校验结论）');
      }
    }
  }

  if (typeof value.isListRepo !== 'boolean') push('is-list-repo', 'isListRepo 必须为布尔');
  return issues;
}

/** raw_events 一行 schema 校验（规格 §4.4：每次请求记证据）。 */
export function validateRawEvent(value: unknown): OdsValidationIssue[] {
  const issues: OdsValidationIssue[] = [];
  const push = (rule: string, detail: string) => issues.push({ path: 'event', rule, detail });
  if (!isObject(value)) {
    push('event-object', '事件不是对象');
    return issues;
  }
  const request = value.request;
  if (!isObject(request)) {
    push('request-object', '缺 request');
    return issues;
  }
  if (request.method !== 'GET')
    push('method-get-only', `请求方法必须为 GET（实际 ${String(request.method)}）`);
  if (typeof request.url !== 'string') push('request-url', '缺 request.url');
  if (request.kind !== 'core' && request.kind !== 'search') {
    push('request-kind', 'request.kind 必须为 core|search');
  }
  const response = value.response;
  if (!isObject(response)) {
    push('response-object', '缺 response');
    return issues;
  }
  if (typeof response.status !== 'number') push('response-status', 'response.status 必须为数字');
  if (typeof response.countedAgainstBudget !== 'boolean') {
    push('response-counted', 'response.countedAgainstBudget 必须为布尔');
  }
  if (typeof value.durationMs !== 'number') push('duration-ms', '缺 durationMs');
  return issues;
}

/** 快照自身摘要：去掉 `snapshotDigest` 后规范序列化（键序稳定）再 sha256。 */
export function computeSnapshotDigest(snapshot: Record<string, unknown>): string {
  const { snapshotDigest: _ignored, ...rest } = snapshot;
  return `sha256:${createHash('sha256').update(stableStringify(rest), 'utf8').digest('hex')}`;
}

/**
 * 规格 §4.1 快照 schema 校验：布局字段、文件条目、内嵌记录（**级联**校验，
 * 不允许只校验文件清单而放过识别记录）。
 */
export function validateFilesSnapshot(value: unknown): OdsValidationIssue[] {
  const issues: OdsValidationIssue[] = [];
  const push = (rule: string, detail: string) => issues.push({ path: 'files.json', rule, detail });
  if (!isObject(value)) {
    push('snapshot-object', '快照不是对象');
    return issues;
  }
  if (value.schema !== 'df.market.ods.files/v1') {
    push('schema', 'schema 必须为 df.market.ods.files/v1');
  }
  if (typeof value.runId !== 'string' || value.runId === '') push('runId-present', '缺 runId');
  if (typeof value.fetchedAt !== 'string' || value.fetchedAt === '') {
    push('fetchedAt-present', '缺 fetchedAt');
  }
  if (typeof value.repoId !== 'number') push('repo-id', 'repoId 必须为数字（幂等键之一）');
  if (typeof value.fullName !== 'string' || !value.fullName.includes('/')) {
    push('full-name', 'fullName 必须为 owner/repo');
  }
  if (typeof value.ref !== 'string' || !COMMIT_RE.test(value.ref)) {
    push('ref-format', 'ref 必须为 40 位 commit hex（幂等键之一）');
  }
  if (!('etag' in value)) push('etag-present', '缺 etag 字段（可为 null）');
  if (!('apiQuotaLeft' in value)) push('api-quota-left', '缺 apiQuotaLeft 字段（可为 null）');

  const tree = value.tree;
  if (!isObject(tree)) {
    push('tree-object', '缺 tree 摘要');
  } else if (typeof tree.listingDigest !== 'string' || !SHA256_RE.test(tree.listingDigest)) {
    push('tree-listing-digest', 'tree.listingDigest 必须形如 sha256:<64hex>');
  }

  const files = value.files;
  if (!Array.isArray(files)) {
    push('files-array', 'files 必须为数组');
  } else {
    for (const file of files) {
      if (!isObject(file)) {
        push('file-object', '文件条目不是对象');
        continue;
      }
      if (typeof file.path !== 'string' || file.path === '') push('file-path', '文件条目缺 path');
      if (typeof file.gitSha !== 'string' || !GIT_SHA_RE.test(file.gitSha)) {
        push('file-git-sha', '文件条目缺 gitSha（Trees API 的 git blob sha）');
      }
      if (
        file.sha256 !== null &&
        (typeof file.sha256 !== 'string' || !SHA256_RE.test(file.sha256))
      ) {
        push('file-sha256', 'file.sha256 必须为 null 或 sha256:<64hex>');
      }
      if (
        file.blobRef !== null &&
        (typeof file.blobRef !== 'string' || !SHA256_RE.test(file.blobRef))
      ) {
        push('file-blob-ref', 'file.blobRef 必须为 null 或 sha256:<64hex>');
      }
      if (file.blobRef !== null && file.sha256 !== file.blobRef) {
        push('file-blob-ref', 'file.blobRef 与 file.sha256 必须一致（内容寻址）');
      }
    }
  }

  for (const issue of validateOdsRepoRecord(value.record)) {
    push(`record.${issue.rule}`, issue.detail);
  }
  return issues;
}

/** 快照自证完整性：`snapshotDigest` 存在且与重算一致。 */
export function validateSnapshotDigest(value: unknown): OdsValidationIssue[] {
  const issues: OdsValidationIssue[] = [];
  const push = (rule: string, detail: string) => issues.push({ path: 'files.json', rule, detail });
  if (!isObject(value)) {
    push('snapshot-object', '快照不是对象');
    return issues;
  }
  const declared = value.snapshotDigest;
  if (typeof declared !== 'string' || declared === '') {
    push('snapshot-digest-present', '缺 snapshotDigest');
    return issues;
  }
  if (!SHA256_RE.test(declared)) {
    push('snapshot-digest-format', 'snapshotDigest 必须形如 sha256:<64hex>');
    return issues;
  }
  if (computeSnapshotDigest(value) !== declared) {
    push('snapshot-digest-mismatch', 'snapshotDigest 与重算不一致（快照被改动）');
  }
  return issues;
}
