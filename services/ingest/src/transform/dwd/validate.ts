/**
 * DWD schema 校验（字段/类型/必填/枚举/**引用完整性**）。
 *
 * 为什么把引用完整性放进校验：D6 看板的「一致性（重复率、孤儿引用率）」需要一个可机器
 * 判定的真值来源；孤儿引用（asset_file/license 指向不存在的资产）在表里是不变量破坏，
 * 必须在 DWD 层就报出来，而不是等前端展示时才发现。
 */

import type { OdsValidationIssue } from '../types.ts';
import type { DwdTables } from './tables.ts';

const ASSET_ID_RE = /^gh:[^#\s]+#[^#\s]*$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const GIT_SHA_RE = /^[0-9a-f]{7,40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

const ASSET_KINDS = ['skill', 'plugin', 'design-system', 'template'];
const LICENSE_GATES = ['loadable', 'view-only', 'blocked'];
const LICENSE_TIERS = [
  'permissive',
  'noassertion',
  'none',
  'strong-copyleft',
  'weak-copyleft',
  'custom',
];
const DIGEST_STATUS = ['ok', 'incomplete-content', 'empty'];
const CLUSTER_REASONS = [
  'exact-dup',
  'near-dup',
  'fingerprint',
  'upstream',
  'manual-review',
  'singleton',
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** 校验四表（返回全部问题，不做短路——一次跑完便于修数）。 */
export function validateDwd(tables: DwdTables): OdsValidationIssue[] {
  const issues: OdsValidationIssue[] = [];
  const push = (path: string, rule: string, detail: string) => issues.push({ path, rule, detail });

  const repoIds = new Set<number>();
  for (const [index, row] of tables.repo.entries()) {
    const at = `repo[${index}]`;
    if (typeof row.repo_id !== 'number') push(at, 'repo-id', 'repo_id 必须为数字');
    else repoIds.add(row.repo_id);
    if (!isNonEmptyString(row.full_name) || !row.full_name.includes('/')) {
      push(at, 'repo-full-name', 'full_name 必须为 owner/repo');
    }
    if (!COMMIT_RE.test(row.ref)) push(at, 'repo-ref-format', 'ref 必须为 40 位 commit hex');
    if (!LICENSE_GATES.includes(row.license_gate)) {
      push(at, 'license-gate', `license_gate 非法：${row.license_gate}`);
    }
    if (!isNonEmptyString(row.fetched_at)) push(at, 'repo-fetched-at', '缺 fetched_at');
  }

  const assetIds = new Set<string>();
  const assetsByRepo = new Map<number, number>();
  const clusterSizes = new Map<string, number>();
  for (const [index, row] of tables.asset.entries()) {
    const at = `asset[${index}]`;
    if (!isNonEmptyString(row.asset_id) || !ASSET_ID_RE.test(row.asset_id)) {
      push(at, 'asset-id-format', `asset_id 形态非法：${String(row.asset_id)}`);
    } else {
      assetIds.add(row.asset_id);
    }
    assetsByRepo.set(row.repo_id, (assetsByRepo.get(row.repo_id) ?? 0) + 1);
    if (!repoIds.has(row.repo_id)) {
      push(at, 'orphan-asset-repo', `repo_id=${row.repo_id} 不在 repo 表（孤儿引用）`);
    }
    if (!ASSET_KINDS.includes(row.kind)) push(at, 'asset-kind', `kind 非法：${row.kind}`);
    if (!isNonEmptyString(row.name)) push(at, 'asset-name', 'name 必须非空（slug）');
    if (!COMMIT_RE.test(row.ref)) push(at, 'asset-ref-format', 'ref 必须为 40 位 commit hex');
    if (row.digest !== null && !SHA256_RE.test(row.digest)) {
      push(at, 'asset-digest-format', 'digest 必须为 null 或 sha256:<64hex>');
    }
    if (!DIGEST_STATUS.includes(row.digest_status)) {
      push(at, 'asset-digest-status', `digest_status 非法：${row.digest_status}`);
    }
    if (!['ok', 'non-compliant', 'deferred'].includes(row.compliance)) {
      push(at, 'asset-compliance', `compliance 非法：${row.compliance}`);
    }
    if (!LICENSE_GATES.includes(row.license_gate)) {
      push(at, 'license-gate', `license_gate 非法：${row.license_gate}`);
    }
    if (!Number.isInteger(row.cluster_size) || row.cluster_size < 1) {
      push(at, 'cluster-size', 'cluster_size 必须 ≥ 1');
    }
    if (!CLUSTER_REASONS.includes(row.cluster_reason)) {
      push(at, 'cluster-reason', `cluster_reason 非法：${row.cluster_reason}`);
    }
    if (row.cluster_id !== null) {
      const known = clusterSizes.get(row.cluster_id);
      if (known === undefined) clusterSizes.set(row.cluster_id, row.cluster_size);
      else if (known !== row.cluster_size) {
        push(
          at,
          'cluster-size-mismatch',
          `cluster ${row.cluster_id} 的 size 不一致（${known} vs ${row.cluster_size}）`,
        );
      }
    }
    if (row.known_sha256_count > row.file_count) {
      push(at, 'asset-file-count', 'known_sha256_count 不得大于 file_count');
    }
  }

  for (const [index, row] of tables.repo.entries()) {
    const actual = assetsByRepo.get(row.repo_id) ?? 0;
    if (row.asset_count !== actual) {
      push(
        `repo[${index}]`,
        'asset-count-mismatch',
        `asset_count=${row.asset_count} 与实际资产数 ${actual} 不符`,
      );
    }
  }

  const assetRepo = new Map(tables.asset.map((row) => [row.asset_id, row.repo_id]));
  for (const [index, row] of tables.asset_file.entries()) {
    const at = `asset_file[${index}]`;
    if (!assetIds.has(row.asset_id)) {
      push(at, 'orphan-asset-file', `asset_id=${row.asset_id} 不在 asset 表（孤儿引用）`);
    } else if (assetRepo.get(row.asset_id) !== row.repo_id) {
      push(at, 'asset-file-repo-mismatch', `repo_id=${row.repo_id} 与资产的 repo_id 不符`);
    }
    if (!isNonEmptyString(row.path)) push(at, 'file-path', 'path 必须非空');
    if (!GIT_SHA_RE.test(row.git_sha)) push(at, 'file-git-sha', 'git_sha 必须为 7–40 位 hex');
    if (row.sha256 !== null && !SHA256_RE.test(row.sha256)) {
      push(at, 'file-sha256-format', 'sha256 必须为 null 或 sha256:<64hex>');
    }
    if (row.blob_ref !== null && !SHA256_RE.test(row.blob_ref)) {
      push(at, 'file-blob-ref-format', 'blob_ref 必须为 null 或 sha256:<64hex>');
    }
    if (row.blob_ref !== row.sha256) {
      push(at, 'file-blob-ref-mismatch', 'blob_ref 与 sha256 必须一致（内容寻址）');
    }
  }

  for (const [index, row] of tables.license.entries()) {
    const at = `license[${index}]`;
    if (row.scope !== 'repo' && row.scope !== 'asset') {
      push(at, 'license-scope', `scope 非法：${String(row.scope)}`);
    }
    if (!repoIds.has(row.repo_id)) {
      push(at, 'orphan-license-repo', `repo_id=${row.repo_id} 不在 repo 表`);
    }
    if (row.scope === 'repo' && row.asset_id !== null) {
      push(at, 'license-scope-mismatch', 'scope=repo 行不得带 asset_id');
    }
    if (row.scope === 'asset') {
      if (row.asset_id === null)
        push(at, 'license-scope-mismatch', 'scope=asset 行必须带 asset_id');
      else if (!assetIds.has(row.asset_id)) {
        push(at, 'orphan-license-asset', `asset_id=${row.asset_id} 不在 asset 表（孤儿引用）`);
      }
    }
    if (!LICENSE_GATES.includes(row.gate)) push(at, 'license-gate', `gate 非法：${row.gate}`);
    if (!LICENSE_TIERS.includes(row.tier)) push(at, 'license-tier', `tier 非法：${row.tier}`);
    if (row.evidence_sha256 !== null && !SHA256_RE.test(row.evidence_sha256)) {
      push(at, 'license-evidence-format', 'evidence_sha256 必须为 null 或 sha256:<64hex>');
    }
  }

  return issues;
}
