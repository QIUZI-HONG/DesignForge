/**
 * DWS 联结行装配测试（票② 使用示例透传 + 既有字段映射抽样）。
 *
 * 断言外部行为：`buildDwsRecord` 把 DWD 行 + 评分行联结成 ADS 输入记录——
 * 本票关注 `usageExamples`（SKILL.md frontmatter `examples:` 的透传，存在才填、缺失省略、
 * 非字符串项如实丢弃不臆造）。
 */

import { score } from '@dforge/ingest';
import { describe, expect, it } from 'vitest';

import { buildDwsRecord } from './ads-join.ts';
import type { DwdTables } from './dwd-map.ts';

/** 评分记录类型（由评分批次产物推导，与 ads-join 内部同一推导式）。 */
type QualityRecord = ReturnType<typeof score.scoreBatch>['records'][number];

const DWS_QUALITY_SCHEMA = score.DWS_QUALITY_SCHEMA;

type AssetRow = DwdTables['asset'][number];
type RepoRow = DwdTables['repo'][number];

const REF = 'a'.repeat(40);
const SHA = `sha256:${'a'.repeat(64)}`;

/** 造一张最小 DWD 资产行（默认无 examples，可覆写）。 */
function assetRow(over: Partial<AssetRow> = {}): AssetRow {
  return {
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
    probes: [],
    checks: [],
    parse_report: {},
    body_bytes: 10,
    body_links_ratio: 0,
    text_frontmatter: { name: 'pdf', description: '导出 PDF' },
    text_body: '# 用法',
    text_readme: null,
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
    first_seen_run_id: 'r1',
    last_seen_run_id: 'r1',
    observation_count: 1,
    ...over,
  };
}

/** 造一张最小 repo 行（评分/溯源字段来源）。 */
function repoRow(over: Partial<RepoRow> = {}): RepoRow {
  return {
    repo_id: 1,
    full_name: 'acme/kit',
    stars: 12,
    pushed_at: '2026-10-01T09:00:00.000Z',
    archived: false,
    homepage: null,
    upstream: null,
    topics: [],
    tree_truncated: false,
    stars_90d_ago: null,
    referenced_by: 0,
    ...over,
  } as RepoRow;
}

/** 造一条最小评分记录（五维无信号 → score=null；联结层折 0 并入卡片）。 */
function qualityRow(assetId: string): QualityRecord {
  const emptyDim = { signals: [], deductions: [] };
  return {
    schema: DWS_QUALITY_SCHEMA,
    assetId,
    kind: 'skill',
    asOf: '2026-10-15T12:00:00.000Z',
    score: null,
    confidence: 'low',
    flags: { archived: false, coldStart: true, nonCompliant: false, filesTruncated: false },
    dims: { spec: null, maintenance: null, docs: null, security: null, ecosystem: null },
    explain: {
      spec: emptyDim,
      maintenance: emptyDim,
      docs: emptyDim,
      security: emptyDim,
      ecosystem: emptyDim,
    },
  };
}

describe('buildDwsRecord · usageExamples 透传（票②）', () => {
  it('frontmatter examples 为字符串数组 → usageExamples 原样带出', () => {
    const record = buildDwsRecord(
      {
        asset: assetRow({
          text_frontmatter: {
            name: 'pdf',
            description: '导出 PDF',
            examples: ['把当前画板导出为 A4 分页 PDF', '把这三页合并成一份交付文档'],
          },
        }),
        repo: repoRow(),
        license: null,
        files: [],
      },
      qualityRow('gh:acme/kit#skills/pdf'),
    );
    expect(record.usageExamples).toEqual([
      '把当前画板导出为 A4 分页 PDF',
      '把这三页合并成一份交付文档',
    ]);
  });

  it('frontmatter 无 examples → 键省略（存在才填，缺失省略）', () => {
    const record = buildDwsRecord(
      { asset: assetRow(), repo: repoRow(), license: null, files: [] },
      qualityRow('gh:acme/kit#skills/pdf'),
    );
    expect('usageExamples' in record).toBe(false);
  });

  it('examples 混入非字符串项 → 只丢坏项；text_frontmatter 缺失 → 键省略', () => {
    const mixed = buildDwsRecord(
      {
        asset: assetRow({
          text_frontmatter: { name: 'pdf', description: '导出 PDF', examples: ['合法话术', 42] },
        }),
        repo: repoRow(),
        license: null,
        files: [],
      },
      qualityRow('gh:acme/kit#skills/pdf'),
    );
    expect(mixed.usageExamples).toEqual(['合法话术']);

    const absent = buildDwsRecord(
      { asset: assetRow({ text_frontmatter: null }), repo: repoRow(), license: null, files: [] },
      qualityRow('gh:acme/kit#skills/pdf'),
    );
    expect('usageExamples' in absent).toBe(false);
  });
});
