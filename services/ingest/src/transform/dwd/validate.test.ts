/**
 * DWD schema 校验测试（字段/类型/必填/枚举/引用完整性）。
 *
 * 断言外部行为：合法四表零问题；逐条破坏后必须报出对应的稳定规则码（含孤儿引用）。
 */

import { describe, expect, it } from 'vitest';

import type { DwdTables } from './tables.ts';
import { validateDwd } from './validate.ts';

const REPO_ID = 1001;
const REF = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SHA = `sha256:${'a'.repeat(64)}`;

/** 一份最小自洽的四表（与夹具无关，便于逐条破坏）。 */
function tables(): DwdTables {
  return {
    repo: [
      {
        repo_id: REPO_ID,
        full_name: 'acme/design-kit',
        owner: 'acme',
        name: 'design-kit',
        default_branch: 'main',
        stars: 42,
        forks: 3,
        size_kb: 512,
        pushed_at: '2026-10-01T09:00:00Z',
        archived: false,
        fork: false,
        homepage: null,
        description: 'desc',
        topics: ['tokens'],
        license_spdx: 'MIT',
        license_gate: 'loadable',
        is_list_repo: false,
        ref: REF,
        fetched_at: '2026-10-15T12:00:03.000Z',
        first_seen_run_id: '20261015-120000',
        last_seen_run_id: '20261015-120000',
        observation_count: 1,
        upstream: null,
        upstream_source: null,
        asset_count: 1,
        created_at: '2025-01-02T03:04:05Z',
        stars_90d_ago: 40,
        referenced_by: 0,
        tree_truncated: false,
        tree_entry_count: 3,
      },
    ],
    asset: [
      {
        asset_id: 'gh:acme/design-kit#skills/palette',
        repo_id: REPO_ID,
        repo_full_name: 'acme/design-kit',
        kind: 'skill',
        name: 'palette-kit',
        display_name_zh_cn: 'palette-kit',
        display_name_en: 'palette-kit',
        summary_zh_cn: '摘要',
        summary_en: 'summary',
        summary_lang: 'en',
        description: null,
        description_lang: null,
        root: 'skills/palette',
        ref: REF,
        fetched_at: '2026-10-15T12:00:03.000Z',
        version: '1.2.0',
        declared_license: null,
        compliance: 'ok',
        capabilities: [],
        probes: [{ piece: 'skill-doc', path: 'skills/palette/SKILL.md' }],
        checks: [{ rule: 'frontmatter-name-description', ok: true, detail: 'ok' }],
        parse_report: { frontmatter: { hasBlock: true, ok: true } },
        body_bytes: 307,
        body_links_ratio: 0,
        text_frontmatter: { name: 'palette-kit', description: '配色工具' },
        text_body: '# palette-kit\n\n正文',
        text_readme: '# design-kit',
        text_manifest: null,
        text_package_json: null,
        text_mcp_json: null,
        text_changelog: null,
        file_count: 1,
        known_sha256_count: 1,
        digest: SHA,
        digest_status: 'ok',
        digest_coverage: 1,
        tree_digest: SHA,
        cluster_id: 'cl-0123456789abcdef',
        cluster_size: 1,
        cluster_reason: 'singleton',
        review_queue: false,
        review_with: [],
        license_gate: 'loadable',
        brand_derived: false,
        is_list_repo: false,
        first_seen_run_id: '20261015-120000',
        last_seen_run_id: '20261015-120000',
        observation_count: 1,
      },
    ],
    asset_file: [
      {
        asset_id: 'gh:acme/design-kit#skills/palette',
        repo_id: REPO_ID,
        path: 'SKILL.md',
        repo_path: 'skills/palette/SKILL.md',
        git_sha: 'c0ffee1234567890abcdef1234567890abcdef12',
        size: 307,
        sha256: SHA,
        blob_ref: SHA,
        media_type: 'text',
        is_license: false,
        is_descriptive_text: true,
        parsed: true,
      },
    ],
    license: [
      {
        repo_id: REPO_ID,
        repo_full_name: 'acme/design-kit',
        asset_id: null,
        scope: 'repo',
        spdx: 'MIT',
        tier: 'permissive',
        gate: 'loadable',
        reasons: ['宽松许可'],
        evidence_path: 'LICENSE',
        evidence_sha256: SHA,
        evidence_blob_ref: SHA,
        brand_derived: false,
        archived: false,
        declared_license: null,
        ref: REF,
        fetched_at: '2026-10-15T12:00:03.000Z',
        run_id: '20261015-120000',
      },
      {
        repo_id: REPO_ID,
        repo_full_name: 'acme/design-kit',
        asset_id: 'gh:acme/design-kit#skills/palette',
        scope: 'asset',
        spdx: 'MIT',
        tier: 'permissive',
        gate: 'loadable',
        reasons: [],
        evidence_path: 'LICENSE',
        evidence_sha256: SHA,
        evidence_blob_ref: SHA,
        brand_derived: false,
        archived: false,
        declared_license: null,
        ref: REF,
        fetched_at: '2026-10-15T12:00:03.000Z',
        run_id: '20261015-120000',
      },
    ],
  };
}

const rules = (value: DwdTables) => validateDwd(value).map((issue) => issue.rule);

/** 取定值；缺失即测试自身写错（替代非空断言，保持 lint 干净）。 */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('夹具缺元素');
  return value;
}

describe('validateDwd', () => {
  it('自洽四表零问题', () => {
    expect(validateDwd(tables())).toEqual([]);
  });

  it('asset_id 形态非法 → asset-id-format', () => {
    const value = tables();
    must(value.asset[0]).asset_id = 'skills/palette';
    expect(rules(value)).toContain('asset-id-format');
  });

  it('kind 枚举非法 → asset-kind', () => {
    const value = tables();
    (value.asset[0] as { kind: string }).kind = 'connector';
    expect(rules(value)).toContain('asset-kind');
  });

  it('digest 形态非法 → asset-digest-format；digest_status 非法 → asset-digest-status', () => {
    const value = tables();
    must(value.asset[0]).digest = 'sha256:nope';
    must(value.asset[0]).digest_status = 'unknown-state' as 'ok';
    const found = rules(value);
    expect(found).toContain('asset-digest-format');
    expect(found).toContain('asset-digest-status');
  });

  it('asset_file 指向不存在的资产 → orphan-asset-file（孤儿引用率可度量）', () => {
    const value = tables();
    must(value.asset_file[0]).asset_id = 'gh:acme/design-kit#nope';
    expect(rules(value)).toContain('orphan-asset-file');
  });

  it('asset.repo_id 不在 repo 表 → orphan-asset-repo', () => {
    const value = tables();
    must(value.asset[0]).repo_id = 9999;
    expect(rules(value)).toContain('orphan-asset-repo');
  });

  it('asset_file.sha256 与 blob_ref 不一致 → file-blob-ref-mismatch', () => {
    const value = tables();
    must(value.asset_file[0]).blob_ref = `sha256:${'b'.repeat(64)}`;
    expect(rules(value)).toContain('file-blob-ref-mismatch');
  });

  it('repo.asset_count 与实际资产数不符 → asset-count-mismatch', () => {
    const value = tables();
    must(value.repo[0]).asset_count = 5;
    expect(rules(value)).toContain('asset-count-mismatch');
  });

  it('license.scope=repo 却带 asset_id → license-scope-mismatch', () => {
    const value = tables();
    must(value.license[0]).asset_id = 'gh:acme/design-kit#skills/palette';
    expect(rules(value)).toContain('license-scope-mismatch');
  });

  it('license.asset_id 不存在 → orphan-license-asset', () => {
    const value = tables();
    must(value.license[1]).asset_id = 'gh:acme/design-kit#ghost';
    expect(rules(value)).toContain('orphan-license-asset');
  });

  it('同 cluster_id 但 cluster_size 不一致 → cluster-size-mismatch', () => {
    const value = tables();
    const clone = {
      ...must(value.asset[0]),
      asset_id: 'gh:acme/design-kit#skills/other',
      cluster_id: must(value.asset[0]).cluster_id,
    };
    clone.cluster_size = 7;
    value.asset.push(clone);
    must(value.repo[0]).asset_count = 2;
    expect(rules(value)).toContain('cluster-size-mismatch');
  });

  it('license_gate 枚举非法 → license-gate', () => {
    const value = tables();
    (value.asset[0] as { license_gate: string }).license_gate = 'maybe';
    (value.repo[0] as { license_gate: string }).license_gate = 'maybe';
    const found = rules(value);
    expect(found.filter((rule) => rule === 'license-gate').length).toBeGreaterThanOrEqual(2);
  });
});
