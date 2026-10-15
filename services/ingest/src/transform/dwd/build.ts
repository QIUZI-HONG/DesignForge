/**
 * DWD 构建：DWD = f(ODS)（规格 §4.3.2「纯函数重建：去网络、去时钟依赖」）。
 *
 * 输入只有规整后的 ODS 层（gzip 事件 + 逐仓 files.json + blobs）；输出四表 Parquet + `_dwd_manifest.json`。
 * 三类解析（SKILL.md frontmatter / 清单 JSON / DTCG token）由 `../parse` 提供，只对**已采集正文**做，
 * 未采集的资产如实标 `compliance=deferred` 且 digest 留 null（不臆造）。
 */

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assignClusters, type ClusterAssetInput } from '../lineage/cluster.ts';
import { computeAssetDigest } from '../lineage/digest.ts';
import { type OdsBundle, readBlobText, readOds } from '../ods/read.ts';
import { parseFrontmatter } from '../parse/frontmatter.ts';
import { parseManifest } from '../parse/manifest.ts';
import { parseTokensDocument } from '../parse/tokens.ts';
import type { AssetKind, IdentifiedAsset, OdsRepoRecord, OdsValidationIssue } from '../types.ts';
import { type TableArtifact, writeDwd } from './store.ts';
import {
  type AssetFileRow,
  type AssetRow,
  type DwdTables,
  type LicenseRow,
  type RepoRow,
  TABLE_NAMES,
  type TableName,
} from './tables.ts';
import { validateDwd } from './validate.ts';

export interface DwdBuildInput {
  /** 规格形态 ODS 层目录（`data/ods`）。 */
  odsRoot: string;
  /** DWD 输出目录（`data/dwd`）。 */
  out: string;
  /** 批次时点（可注入以复现）；缺省取 ODS 记录中的最大 fetchedAt（去时钟依赖）。 */
  asOf?: string;
}

export interface DwdManifest {
  schema: 'df.market.dwd.manifest/v1';
  asOf: string;
  source: {
    odsRoot: string;
    runs: string[];
    repoCount: number;
    /** 来源 ODS 文件与哈希（溯源链：MK-01 产物 → 本层）。 */
    files: { path: string; sha256: string; length: number; lineCount: number | null }[];
  };
  tables: TableArtifact[];
  /** 同源聚合留痕（簇数、近重复对数、人工队列对数）。 */
  clusters: { count: number; nearDupPairs: number; reviewPairs: number };
}

export interface DwdBuildResult {
  tables: DwdTables;
  artifacts: TableArtifact[];
  manifest: DwdManifest;
  issues: OdsValidationIssue[];
  manifestPath: string;
}

/** 需要解析的描述性文本文件名（规格 §2 的结构件）。 */
const DESCRIPTIVE_FILE_RE =
  /^(SKILL\.md|DESIGN\.md|README\.md|plugin\.json|marketplace\.json|manifest\.json|template\.json|package\.json|components\.manifest\.json|design-tokens\.json|tokens\.json|tokens\.css|tailwind-v4\.css|\.mcp\.json)$/;

const LICENSE_FILE_RE = /^(LICEN[CS]E|COPYING|NOTICE)(\.(md|txt|rst))?$/i;

/** 目录名 → slug（规格 §1.2：目录名规范化）。 */
function slugify(value: string): string {
  const base =
    value
      .split('/')
      .filter((part) => part !== '')
      .pop() ?? value;
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'asset'
  );
}

/** 语言判定（供双语字段标注与 ADS 翻译声明；CJK 占比 ≥ 0.2 视为中文）。 */
export function detectLanguage(text: string | null): 'zh' | 'en' | null {
  if (text === null || text.trim() === '') return null;
  const compact = text.replace(/\s+/g, '');
  if (compact === '') return null;
  const cjk = (compact.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  return cjk / compact.length >= 0.2 ? 'zh' : 'en';
}

/** 资产根内相对路径（root='' 时为仓内路径）。 */
function relativeToRoot(root: string, repoPath: string): string {
  if (root === '') return repoPath;
  const prefix = `${root}/`;
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : repoPath;
}

/** 各资产类的「身份结构件」白名单（相对资产根的位置需精确匹配，规格 §2.2–§2.5）。 */
const STRUCTURAL_FILES: Record<AssetKind, string[]> = {
  skill: ['SKILL.md', 'README.md', 'manifest.json'],
  plugin: [
    'plugin.json',
    '.claude-plugin/plugin.json',
    'marketplace.json',
    '.claude-plugin/marketplace.json',
    'manifest.json',
    'package.json',
  ],
  'design-system': [
    'DESIGN.md',
    'manifest.json',
    'design-tokens.json',
    'tokens.json',
    'tokens.css',
    'tailwind-v4.css',
    'components.manifest.json',
    'package.json',
  ],
  template: ['template.json', 'manifest.json', 'package.json'],
};

/** 是否为本资产类的身份结构件（位置敏感：必须落在资产根，`.claude-plugin/` 例外）。 */
export function isStructuralFile(kind: AssetKind, relative: string): boolean {
  return STRUCTURAL_FILES[kind].includes(relative);
}

/**
 * 从仓库正文推断同源上游（规格 §1.3 `upstream` / §2.6.3 结构同源依据）。
 *
 * 保守口径：只算「指向另一个 GitHub 仓」的链接，并要求**至少两个不同文件**都指向它，
 * 才算强同源（`strong=true`，可作同簇依据）。单个文件里的一次外链不足以下结论——
 * 实测里 `anthropics/skills` 的某个技能正文提到 SDK 仓，这不是同源。
 */
export function inferUpstream(
  fullName: string,
  bodies: { path: string; text: string }[],
): { upstream: string | null; source: string | null; fileCount: number; strong: boolean } {
  const self = fullName.toLowerCase();
  const filesByCandidate = new Map<string, Set<string>>();
  for (const body of bodies) {
    for (const match of body.text.matchAll(/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/g)) {
      const owner = match[1];
      const repo = match[2];
      if (owner === undefined || repo === undefined) continue;
      const candidate = `${owner}/${repo}`.replace(/\.git$/, '');
      if (candidate.toLowerCase() === self) continue;
      const files = filesByCandidate.get(candidate) ?? new Set<string>();
      files.add(body.path);
      filesByCandidate.set(candidate, files);
    }
  }
  let best: { name: string; fileCount: number } | null = null;
  for (const [name, files] of filesByCandidate) {
    const fileCount = files.size;
    if (
      best === null ||
      fileCount > best.fileCount ||
      (fileCount === best.fileCount && name.toLowerCase() < best.name.toLowerCase())
    ) {
      best = { name, fileCount };
    }
  }
  if (best === null) return { upstream: null, source: null, fileCount: 0, strong: false };
  return {
    upstream: best.name,
    source: 'body-link',
    fileCount: best.fileCount,
    strong: best.fileCount >= 2,
  };
}

/** 资产解析报告（进 asset.parse_report，供 MK-03 打分与 MK-04 卡片复用）。 */
interface AssetParseReport {
  sources: { path: string; blob_ref: string | null; parser: string }[];
  frontmatter: Record<string, unknown> | null;
  manifest: Record<string, unknown> | null;
  tokens: Record<string, unknown> | null;
  required: { name: boolean; description: boolean };
  primaryTextPath: string | null;
  tokensDiscarded: { path: string; reason: string }[];
}

/** 对资产根内的已采集正文做解析（frontmatter / 清单 / token 三类）。 */
function parseAssetContent(
  asset: IdentifiedAsset,
  files: { path: string; blobRef: string | null }[],
  texts: Map<string, string>,
): {
  report: AssetParseReport;
  primary: {
    path: string;
    text: string;
    body: string;
    bodyBytes: number;
    linksRatio: number;
  } | null;
  parsedPaths: Set<string>;
} {
  const report: AssetParseReport = {
    sources: [],
    frontmatter: null,
    manifest: null,
    tokens: null,
    required: { name: false, description: false },
    primaryTextPath: null,
    tokensDiscarded: [],
  };
  const parsedPaths = new Set<string>();
  let primary: {
    path: string;
    text: string;
    body: string;
    bodyBytes: number;
    linksRatio: number;
  } | null = null;

  // 结构件优先级：技能正文 > 清单 > 设计系统件 > token 文件
  const preference: Record<AssetKind, string[]> = {
    skill: ['SKILL.md', 'manifest.json', 'plugin.json'],
    plugin: ['plugin.json', 'marketplace.json', 'manifest.json', 'package.json'],
    'design-system': [
      'DESIGN.md',
      'manifest.json',
      'design-tokens.json',
      'tokens.json',
      'tokens.css',
      'package.json',
    ],
    template: ['template.json', 'manifest.json', 'package.json'],
  };
  const wanted = preference[asset.kind];
  // 只把「资产根处的结构件」当候选：嵌套 `template/SKILL.md` 之类的深层文件不参与本资产
  // 的身份解析（否则仓根 Plugin 会被某个子目录的 SKILL.md 顶掉名字，实测发生过）。
  const structural = files.filter((file) =>
    isStructuralFile(asset.kind, relativeToRoot(asset.root, file.path)),
  );
  const ordered = [...structural].sort((a, b) => {
    const rankA = wanted.findIndex((name) => a.path === name || a.path.endsWith(`/${name}`));
    const rankB = wanted.findIndex((name) => b.path === name || b.path.endsWith(`/${name}`));
    return (rankA < 0 ? 99 : rankA) - (rankB < 0 ? 99 : rankB) || (a.path < b.path ? -1 : 1);
  });

  for (const file of ordered) {
    const text = texts.get(file.path);
    if (text === undefined) continue;
    const base = file.path.split('/').pop() ?? file.path;
    const relative = relativeToRoot(asset.root, file.path);

    if (base === 'SKILL.md' || base === 'DESIGN.md') {
      const parsed = parseFrontmatter(text);
      parsedPaths.add(file.path);
      report.frontmatter = {
        hasBlock: parsed.hasBlock,
        ok: parsed.ok,
        name: parsed.data.name,
        description: parsed.data.description,
        version: parsed.data.version,
        license: parsed.data.license,
        tags: parsed.data.tags,
        triggers: parsed.data.triggers,
        allowedTools: parsed.data.allowedTools,
        extraKeys: parsed.data.extraKeys,
        issueCodes: parsed.issues.map((issue) => issue.code),
      };
      report.sources.push({ path: relative, blob_ref: file.blobRef, parser: 'frontmatter' });
      report.required = {
        name: parsed.data.name !== null,
        description: parsed.data.description !== null,
      };
      if (primary === null) {
        primary = {
          path: file.path,
          text,
          body: parsed.body,
          bodyBytes: parsed.bodyStats.bytes,
          linksRatio: parsed.bodyStats.linkRatio,
        };
      }
      continue;
    }

    if (/\.(json|jsonc)$/i.test(base)) {
      const hint = { path: relative };
      const manifest = parseManifest(text, hint);
      parsedPaths.add(file.path);
      if (manifest.kind !== 'unknown' && report.manifest === null) {
        report.manifest = {
          kind: manifest.kind,
          name: manifest.name,
          slug: manifest.slug,
          description: manifest.description,
          version: manifest.version,
          license: manifest.license,
          entries: manifest.entries,
        };
        report.sources.push({ path: relative, blob_ref: file.blobRef, parser: 'manifest' });
      }
      if (/tokens\.json$/i.test(base)) {
        const tokens = parseTokensDocument(relative, text);
        if (tokens.isDtcg) {
          if (report.tokens === null) {
            report.tokens = {
              isDtcg: tokens.isDtcg,
              isCssTheme: tokens.isCssTheme,
              tokenCount: tokens.tokenCount,
              types: tokens.types,
            };
            report.sources.push({ path: relative, blob_ref: file.blobRef, parser: 'tokens' });
          }
        } else {
          report.tokensDiscarded.push({
            path: relative,
            reason: tokens.issues.map((issue) => issue.code).join(',') || 'unknown-shape',
          });
        }
      }
      if (primary === null) {
        primary = {
          path: file.path,
          text,
          body: text,
          bodyBytes: Buffer.byteLength(text, 'utf8'),
          linksRatio: 0,
        };
      }
      continue;
    }

    if (/\.css$/i.test(base)) {
      const tokens = parseTokensDocument(relative, text);
      parsedPaths.add(file.path);
      if (tokens.isCssTheme && report.tokens === null) {
        report.tokens = {
          isDtcg: false,
          isCssTheme: true,
          tokenCount: tokens.tokenCount,
          types: [],
        };
        report.sources.push({ path: relative, blob_ref: file.blobRef, parser: 'tokens' });
      } else if (!tokens.isCssTheme) {
        report.tokensDiscarded.push({
          path: relative,
          reason: tokens.issues.map((issue) => issue.code).join(',') || 'unknown-shape',
        });
      }
    }
  }

  report.primaryTextPath = primary?.path ?? null;
  return { report, primary, parsedPaths };
}

/** 组装四表（确定性：全部按稳定键排序）。 */
export async function buildDwd(input: DwdBuildInput): Promise<DwdBuildResult> {
  const bundle: OdsBundle = await readOds(input.odsRoot);
  const issues: OdsValidationIssue[] = [...bundle.issues];

  const snapshots = [...bundle.snapshots].sort((a, b) => a.repoId - b.repoId);
  const asOf =
    input.asOf ??
    snapshots
      .map((snapshot) => snapshot.fetchedAt)
      .sort()
      .at(-1) ??
    '';

  // 一仓一观测统计（多快照/多轮次时的 observation_count / first_seen / last_seen）
  const repoObservations = new Map<number, string[]>();
  for (const snapshot of bundle.snapshots) {
    const runs = repoObservations.get(snapshot.repoId) ?? [];
    runs.push(snapshot.runId);
    repoObservations.set(snapshot.repoId, runs);
  }
  const assetObservations = new Map<string, string[]>();
  for (const record of bundle.records) {
    for (const asset of record.assets) {
      const runs = assetObservations.get(asset.id) ?? [];
      runs.push(record.runId);
      assetObservations.set(asset.id, runs);
    }
  }

  const repoRows: RepoRow[] = [];
  const assetRows: AssetRow[] = [];
  const assetFileRows: AssetFileRow[] = [];
  const licenseRows: LicenseRow[] = [];
  const clusterInputs: ClusterAssetInput[] = [];

  for (const snapshot of snapshots) {
    const record: OdsRepoRecord = snapshot.record;
    const repo = record.repo;
    const runs = (repoObservations.get(repo.id) ?? [record.runId]).slice().sort();

    // 已采集正文索引（本仓）
    const texts = new Map<string, string>();
    const fileRows: { path: string; blobRef: string | null }[] = [];
    for (const file of snapshot.files) {
      const text = await readBlobText(bundle, file.blobRef);
      if (text !== null) texts.set(file.path, text);
      fileRows.push({ path: file.path, blobRef: file.blobRef });
    }
    const upstream = inferUpstream(
      repo.fullName,
      [...texts].map(([path, text]) => ({ path, text })),
    );

    repoRows.push({
      repo_id: repo.id,
      full_name: repo.fullName,
      owner: repo.owner,
      name: repo.name,
      default_branch: repo.defaultBranch,
      stars: repo.stars,
      forks: repo.forks,
      size_kb: repo.sizeKb,
      pushed_at: repo.pushedAt,
      archived: repo.archived,
      fork: repo.fork,
      homepage: repo.homepage,
      description: repo.description,
      topics: [...repo.topics],
      license_spdx: record.license.spdx,
      license_gate: record.license.gate,
      is_list_repo: record.isListRepo,
      ref: record.ref,
      fetched_at: record.fetchedAt,
      first_seen_run_id: runs[0] ?? record.runId,
      last_seen_run_id: runs[runs.length - 1] ?? record.runId,
      observation_count: runs.length,
      upstream: upstream.upstream,
      upstream_source: upstream.source,
      asset_count: record.assets.length,
    });

    licenseRows.push({
      repo_id: repo.id,
      repo_full_name: repo.fullName,
      asset_id: null,
      scope: 'repo',
      spdx: record.license.spdx,
      tier: record.license.tier,
      gate: record.license.gate,
      reasons: [...record.license.reasons],
      evidence_path: record.license.evidence.path,
      evidence_sha256: record.license.evidence.sha256,
      evidence_blob_ref: record.license.evidence.sha256,
      brand_derived: record.license.brandDerived,
      archived: record.license.archived,
      declared_license: null,
      ref: record.ref,
      fetched_at: record.fetchedAt,
      run_id: record.runId,
    });

    for (const asset of [...record.assets].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const owned = snapshot.files
        .filter((file) => asset.root === '' || file.path.startsWith(`${asset.root}/`))
        .sort((a, b) => (a.path < b.path ? -1 : 1));
      const ownedWithBlobs = owned.map((file) => ({ path: file.path, blobRef: file.blobRef }));

      const { report, primary, parsedPaths } = parseAssetContent(asset, ownedWithBlobs, texts);

      const digest = computeAssetDigest(
        owned.map((file) => ({
          path: relativeToRoot(asset.root, file.path),
          gitSha: file.gitSha,
          sha256: file.sha256,
          size: file.size,
        })),
      );
      for (const file of owned) {
        const text = texts.get(file.path);
        if (text !== null && text !== undefined && file.size !== null) {
          const actual = Buffer.byteLength(text, 'utf8');
          if (actual !== file.size) {
            issues.push({
              path: `${asset.id}:${file.path}`,
              rule: 'file-size-mismatch',
              detail: `Trees 记录 ${file.size}B，取回正文 ${actual}B（内容与清单不一致，已保留原值）`,
            });
          }
        }
      }

      const frontmatter = report.frontmatter as {
        name?: string | null;
        description?: string | null;
        version?: string | null;
        license?: string | null;
      } | null;
      const manifest = report.manifest as {
        name?: string | null;
        slug?: string | null;
        description?: string | null;
        version?: string | null;
        license?: string | null;
      } | null;
      const name =
        frontmatter?.name ??
        manifest?.slug ??
        manifest?.name ??
        asset.name ??
        slugify(asset.root || repo.name);
      const summary = frontmatter?.description ?? manifest?.description ?? repo.description ?? '';
      const summaryLang = detectLanguage(summary);
      const descriptionText = primary?.body ?? null;
      const descriptionLang = detectLanguage(descriptionText);
      const declaredLicense =
        frontmatter?.license ?? manifest?.license ?? asset.declaredLicense ?? null;
      const version = frontmatter?.version ?? manifest?.version ?? asset.version ?? null;
      const runsForAsset = (assetObservations.get(asset.id) ?? [record.runId]).slice().sort();

      assetRows.push({
        asset_id: asset.id,
        repo_id: repo.id,
        repo_full_name: repo.fullName,
        kind: asset.kind,
        name,
        display_name_zh_cn: name,
        display_name_en: name,
        summary_zh_cn: summary,
        summary_en: summary,
        summary_lang: summaryLang,
        description: descriptionText,
        description_lang: descriptionLang,
        root: asset.root,
        ref: record.ref,
        fetched_at: record.fetchedAt,
        version,
        declared_license: declaredLicense,
        compliance: asset.compliance,
        capabilities: [...asset.capabilities],
        probes: asset.probe.map((probe) => ({ piece: probe.piece, path: probe.path })),
        checks: asset.checks.map((check) => ({
          rule: check.rule,
          ok: check.ok,
          detail: check.detail,
        })),
        parse_report: report as unknown as Record<string, unknown>,
        body_bytes: primary?.bodyBytes ?? null,
        body_links_ratio: primary?.linksRatio ?? null,
        file_count: owned.length,
        known_sha256_count: owned.filter((file) => file.sha256 !== null).length,
        digest: digest.digest,
        digest_status: digest.status,
        digest_coverage: digest.coverage,
        tree_digest: asset.treeDigest,
        cluster_id: null,
        cluster_size: 1,
        cluster_reason: 'singleton',
        review_queue: false,
        review_with: [],
        license_gate: asset.brandDerived ? 'blocked' : record.license.gate,
        brand_derived: asset.brandDerived,
        is_list_repo: record.isListRepo,
        first_seen_run_id: runsForAsset[0] ?? record.runId,
        last_seen_run_id: runsForAsset[runsForAsset.length - 1] ?? record.runId,
        observation_count: runsForAsset.length,
      });

      for (const file of owned) {
        const base = file.path.split('/').pop() ?? file.path;
        assetFileRows.push({
          asset_id: asset.id,
          repo_id: repo.id,
          path: relativeToRoot(asset.root, file.path),
          repo_path: file.path,
          git_sha: file.gitSha,
          size: file.size,
          sha256: file.sha256,
          blob_ref: file.blobRef,
          media_type: file.mediaType,
          is_license: LICENSE_FILE_RE.test(base),
          is_descriptive_text: DESCRIPTIVE_FILE_RE.test(base),
          parsed: parsedPaths.has(file.path),
        });
      }

      licenseRows.push({
        repo_id: repo.id,
        repo_full_name: repo.fullName,
        asset_id: asset.id,
        scope: 'asset',
        spdx: record.license.spdx,
        tier: record.license.tier,
        gate: asset.brandDerived ? 'blocked' : record.license.gate,
        reasons: [...record.license.reasons],
        evidence_path: record.license.evidence.path,
        evidence_sha256: record.license.evidence.sha256,
        evidence_blob_ref: record.license.evidence.sha256,
        brand_derived: asset.brandDerived,
        archived: record.license.archived,
        declared_license: declaredLicense,
        ref: record.ref,
        fetched_at: record.fetchedAt,
        run_id: record.runId,
      });

      clusterInputs.push({
        assetId: asset.id,
        kind: asset.kind,
        root: asset.root,
        filePaths: owned.map((file) => relativeToRoot(asset.root, file.path)),
        bodyText: primary === null ? null : primary.body,
        // 只有强同源才作为「必进同簇」依据（规格 §2.6.3）；弱推断仍落 repo.upstream 供人工复核
        upstream: upstream.strong ? upstream.upstream : null,
      });
    }
  }

  // 同源聚合与近重复（规格 §2.6）：回填 cluster 三列
  const clusters = assignClusters(clusterInputs);
  for (const row of assetRows) {
    const assignment = clusters.assignments.get(row.asset_id);
    if (assignment === undefined) continue;
    row.cluster_id = assignment.clusterId;
    row.cluster_size = assignment.clusterSize;
    row.cluster_reason = assignment.reason;
    row.review_queue = assignment.reviewQueue;
    row.review_with = [...assignment.reviewWith];
  }

  // 稳定排序（确定性：同输入同字节）
  repoRows.sort((a, b) => a.repo_id - b.repo_id);
  assetRows.sort((a, b) => (a.asset_id < b.asset_id ? -1 : a.asset_id > b.asset_id ? 1 : 0));
  assetFileRows.sort((a, b) =>
    a.asset_id < b.asset_id
      ? -1
      : a.asset_id > b.asset_id
        ? 1
        : a.path < b.path
          ? -1
          : a.path > b.path
            ? 1
            : 0,
  );
  licenseRows.sort((a, b) => {
    if (a.repo_id !== b.repo_id) return a.repo_id - b.repo_id;
    if (a.scope !== b.scope) return a.scope < b.scope ? -1 : 1;
    const left = a.asset_id ?? '';
    const right = b.asset_id ?? '';
    return left < right ? -1 : left > right ? 1 : 0;
  });

  const tables: DwdTables = {
    repo: repoRows,
    asset: assetRows,
    asset_file: assetFileRows,
    license: licenseRows,
  };
  issues.push(...validateDwd(tables));

  const artifacts = await writeDwd(input.out, tables);
  const manifest: DwdManifest = {
    schema: 'df.market.dwd.manifest/v1',
    asOf,
    source: {
      odsRoot: input.odsRoot,
      runs: [...new Set(snapshots.map((snapshot) => snapshot.runId))].sort(),
      repoCount: snapshots.length,
      files: bundle.sources.map((source) => ({
        path: source.path,
        sha256: source.sha256,
        length: source.length,
        lineCount: source.lineCount,
      })),
    },
    tables: artifacts,
    clusters: {
      count: new Set(
        assetRows.map((row) => row.cluster_id).filter((id): id is string => id !== null),
      ).size,
      nearDupPairs: clusters.pairReports.filter((pair) => pair.reason === 'near-dup').length,
      reviewPairs: clusters.pairReports.filter((pair) => pair.reason === 'manual-review').length,
    },
  };
  const manifestPath = join(input.out, '_dwd_manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { tables, artifacts, manifest, issues, manifestPath };
}

/** 表名清单（对外复用）。 */
export const DWD_TABLE_NAMES: TableName[] = [...TABLE_NAMES];

/** 内容哈希（manifest 自证用）。 */
export function sha256Of(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}
