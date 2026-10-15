/**
 * 适配层与分类面测试（DWD 四表 → 评分输入；facet 推导）。
 *
 * 断言外部行为：字段一一映射（含 text 组与 trend）、不合约资产逐条排除、
 * 同 asset_id 多 commit 观测去重、facet 推导确定性。
 */

import { describe, expect, it } from 'vitest';
import { type DwdTables, joinTables, mapDwdToScoreInputs } from './dwd-map.ts';
import { deriveCategory, deriveFacets, deriveLane, deriveMode } from './facets.ts';

const REF = 'a'.repeat(40);
const SHA = `sha256:${'a'.repeat(64)}`;

/** 造一张最小 DWD 资产行（默认带 text，可覆写）。 */
function assetRow(over: Partial<DwdTables['asset'][number]> = {}): DwdTables['asset'][number] {
  const base: DwdTables['asset'][number] = {
    asset_id: 'gh:acme/kit#skills/pdf',
    repo_id: 1,
    repo_full_name: 'acme/kit',
    kind: 'skill',
    name: 'pdf',
    display_name_zh_cn: 'pdf',
    display_name_en: 'pdf',
    summary_zh_cn: '导出 PDF',
    summary_en: 'Export PDF',
    summary_lang: 'en',
    description: null,
    description_lang: null,
    root: 'skills/pdf',
    ref: REF,
    fetched_at: '2026-10-15T12:00:00.000Z',
    version: null,
    declared_license: null,
    compliance: 'ok',
    capabilities: [],
    probes: [{ piece: 'skill-doc', path: 'skills/pdf/SKILL.md' }],
    checks: [{ rule: 'x', ok: true, detail: 'x' }],
    parse_report: {},
    body_bytes: 10,
    body_links_ratio: 0,
    text_frontmatter: { name: 'pdf', description: '导出 PDF', tags: ['pdf', 'export'] },
    text_body: '# 用法',
    text_readme: '# 根 README',
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
    cluster_id: 'cl-1',
    cluster_size: 1,
    cluster_reason: 'singleton',
    review_queue: false,
    review_with: [],
    license_gate: 'loadable',
    brand_derived: false,
    is_list_repo: false,
    first_seen_run_id: 'r',
    last_seen_run_id: 'r',
    observation_count: 1,
  };
  return { ...base, ...over };
}

function repoRow(over: Partial<DwdTables['repo'][number]> = {}): DwdTables['repo'][number] {
  const base: DwdTables['repo'][number] = {
    repo_id: 1,
    full_name: 'acme/kit',
    owner: 'acme',
    name: 'kit',
    default_branch: 'main',
    stars: 42,
    forks: 3,
    size_kb: 10,
    pushed_at: '2026-10-01T00:00:00Z',
    archived: false,
    fork: false,
    homepage: null,
    description: 'kit',
    topics: ['design-tokens', 'ppt'],
    license_spdx: 'MIT',
    license_gate: 'loadable',
    is_list_repo: false,
    ref: REF,
    fetched_at: '2026-10-15T12:00:00.000Z',
    first_seen_run_id: 'r',
    last_seen_run_id: 'r',
    observation_count: 1,
    upstream: null,
    upstream_source: null,
    asset_count: 1,
    created_at: '2025-01-01T00:00:00Z',
    stars_90d_ago: 30,
    referenced_by: 0,
    tree_truncated: false,
    tree_entry_count: 3,
  };
  return { ...base, ...over };
}

function tables(over: Partial<DwdTables> = {}): DwdTables {
  return {
    repo: [repoRow()],
    asset: [assetRow()],
    asset_file: [
      {
        asset_id: 'gh:acme/kit#skills/pdf',
        repo_id: 1,
        path: 'SKILL.md',
        repo_path: 'skills/pdf/SKILL.md',
        git_sha: 'c'.repeat(40),
        size: 10,
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
        repo_id: 1,
        repo_full_name: 'acme/kit',
        asset_id: 'gh:acme/kit#skills/pdf',
        scope: 'asset',
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
        fetched_at: '2026-10-15T12:00:00.000Z',
        run_id: 'r',
      },
    ],
    ...over,
  };
}

describe('mapDwdToScoreInputs（DWD → 评分输入契约）', () => {
  it('字段一一映射：text 组、files.truncated、trend、license 证据', () => {
    const mapped = mapDwdToScoreInputs(tables());
    expect(mapped.excluded).toEqual([]);
    expect(mapped.inputs).toHaveLength(1);
    const input = mapped.inputs[0];
    expect(input?.asset.id).toBe('gh:acme/kit#skills/pdf');
    expect(input?.repo.createdAt).toBe('2025-01-01T00:00:00Z');
    expect(input?.trend.stars90dAgo).toBe(30);
    expect(input?.trend.referencedBy).toBe(0);
    expect(input?.files.truncated).toBe(false);
    expect(input?.files.entries).toEqual([{ path: 'SKILL.md', size: 10, sha256: SHA }]);
    expect(input?.text.frontmatter).toEqual({
      name: 'pdf',
      description: '导出 PDF',
      tags: ['pdf', 'export'],
    });
    expect(input?.text.body).toBe('# 用法');
    expect(input?.text.readme).toBe('# 根 README');
    expect(input?.license.gate).toBe('loadable');
  });

  it('text 空壳资产 → 排除并逐条留痕（不静默丢）', () => {
    const mapped = mapDwdToScoreInputs(
      tables({
        asset: [
          assetRow({
            asset_id: 'gh:acme/kit#skills/quiet',
            text_body: null,
            text_readme: null,
            text_frontmatter: null,
            text_manifest: null,
          }),
        ],
      }),
    );
    expect(mapped.inputs).toEqual([]);
    expect(mapped.excluded).toHaveLength(1);
    expect(mapped.excluded[0]?.assetId).toBe('gh:acme/kit#skills/quiet');
    expect(mapped.excluded[0]?.reasons.join('；')).toContain('空壳');
  });

  it('同 asset_id 多 commit 观测 → 取 fetched_at 最新一行并计数', () => {
    const old = assetRow({
      ref: 'b'.repeat(40),
      fetched_at: '2026-10-14T00:00:00.000Z',
      name: 'old',
    });
    const fresh = assetRow({
      ref: 'c'.repeat(40),
      fetched_at: '2026-10-15T00:00:00.000Z',
      name: 'fresh',
    });
    const mapped = mapDwdToScoreInputs(tables({ asset: [old, fresh] }));
    expect(mapped.dedupedRows).toBe(1);
    expect(mapped.inputs).toHaveLength(1);
    expect(mapped.inputs[0]?.asset.name).toBe('fresh');
  });
});

describe('facets（分类面推导，规格 §1.4）', () => {
  it('category：kind 与关键词双路推导', () => {
    expect(deriveCategory('design-system', 'anything')).toBe('设计系统');
    expect(deriveCategory('template', 'html slide deck starter')).toBe('PPT设计');
    expect(deriveCategory('skill', 'mobile app kit')).toBe('移动端App');
    expect(deriveCategory('skill', 'color palette generator')).toBe('其他');
    expect(deriveCategory('plugin', 'figma icon set')).toBe('图标&插画');
  });

  it('lane：deliver > refine > create', () => {
    expect(deriveLane('skill', 'export to pdf')).toBe('deliver');
    expect(deriveLane('design-system', 'tokens')).toBe('refine');
    expect(deriveLane('template', 'deck')).toBe('create');
  });

  it('mode：由 kind 与探针证据推导', () => {
    const joined = joinTables(tables())[0];
    expect(joined).toBeDefined();
    expect(deriveMode(joined!)).toBe('utility');
    expect(
      deriveMode(
        joinTables(
          tables({
            asset: [
              assetRow({
                kind: 'design-system',
                probes: [{ piece: 'tokens-file', path: 'tokens.json' }],
              }),
            ],
          }),
        )[0]!,
      ),
    ).toBe('tokens');
  });

  it('tags：声明 tags 优先 + topics 校准，去重截 10；scenes 留空（未决项 §9.10）', () => {
    const joined = joinTables(tables())[0];
    if (joined === undefined) throw new Error('联结果为空');
    const facets = deriveFacets(joined);
    expect(facets.tags.slice(0, 2)).toEqual(['pdf', 'export']);
    expect(facets.tags).toContain('ppt');
    expect(facets.scenes).toEqual([]);
    // 确定性：两次推导逐字段一致
    expect(deriveFacets(joined)).toEqual(facets);
  });
});
