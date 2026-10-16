/**
 * DWD 四表 → 评分输入契约（`score.DwdAsset`）的适配层（MK-05 集成面，规格《市场首实现》§4 环 2→3）。
 *
 * 为什么需要适配层：DWD 是**列存四表**（repo/asset/asset_file/license），评分器吃的是**一资产一记录**
 * 的联结视图（`DwdAsset`：asset+repo+license+files+text+trend）。两者字段形状在集成期自然不同名，
 * 本层做**显式映射**（缺一列即如实 null，绝不臆造），并把「不合约而排除」的资产逐条留痕——
 * 排除即证据（资产 id + 原因），不得静默丢进黑洞。
 *
 * 口径声明（写进跑通报告）：
 * - `files.truncated` ← `repo.tree_truncated`（Trees 截断标志，规格 §3.5）；
 * - `trend.stars90dAgo` ← `repo.stars_90d_ago`（MK-01 星标水位，未取到 = null）；
 * - `trend.referencedBy` ← `repo.referenced_by`（口径 = 同批仓 upstream 反向计数）；
 * - `asset.capabilitiesDeclared` ← `asset.capabilities` 非空即视为已声明（DWD 侧能力来自
 *   `.mcp.json` 等证据，见 MK-01 识别层）；未声明时不足道 `["prompt:inject"]` 由 ADS 层补。
 */

import { score, type transform } from '@dforge/ingest';

/** DWD 四表（由读取器形状推导，避免跨包类型别名带来的双向耦合）。 */
export type DwdTables = Awaited<ReturnType<typeof transform.readDwd>>;
/** 单表行类型。 */
export type DwdAssetRow = DwdTables['asset'][number];
export type DwdRepoRow = DwdTables['repo'][number];
export type DwdLicenseRow = DwdTables['license'][number];
export type DwdAssetFileRow = DwdTables['asset_file'][number];
/** 评分输入契约（一资产一记录）。 */
export type ScoreInput = ReturnType<typeof score.normalizeDwdAsset>;

export interface DwdMapResult {
  /** 进入评分的记录（按 asset id 升序，确定性）。 */
  inputs: ScoreInput[];
  /** 不合评分契约而排除的资产（asset id + 校验器给出的原因；如实留痕）。 */
  excluded: { assetId: string; reasons: string[] }[];
  /** 同一资产多 commit 观测时被丢弃的旧行数（取 fetched_at 最新一行）。 */
  dedupedRows: number;
}

/** 资产行 + 联结行（去重后）。 */
export interface JoinedAsset {
  asset: DwdAssetRow;
  repo: DwdRepoRow | null;
  license: DwdLicenseRow | null;
  files: DwdAssetFileRow[];
}

/**
 * 去重：同一 `asset_id` 多行（同仓多 commit 观测）→ 取 `fetched_at` 最新一行；
 * 并列时取 `ref` 字典序大者（确定性，不依赖输入顺序）。
 */
export function dedupeAssetRows(rows: readonly DwdAssetRow[]): {
  rows: DwdAssetRow[];
  dedupedRows: number;
} {
  const best = new Map<string, DwdAssetRow>();
  for (const row of rows) {
    const known = best.get(row.asset_id);
    if (known === undefined) {
      best.set(row.asset_id, row);
      continue;
    }
    const knownKey = `${known.fetched_at}|${known.ref}`;
    const rowKey = `${row.fetched_at}|${row.ref}`;
    if (rowKey > knownKey) best.set(row.asset_id, row);
  }
  const deduped = [...best.values()].sort((a, b) =>
    a.asset_id < b.asset_id ? -1 : a.asset_id > b.asset_id ? 1 : 0,
  );
  return { rows: deduped, dedupedRows: rows.length - deduped.length };
}

/** 把四表联结成「一资产一组」（license/files 按 asset_id 归并）。 */
export function joinTables(tables: DwdTables): JoinedAsset[] {
  const { rows } = dedupeAssetRows(tables.asset);
  const repoById = new Map(tables.repo.map((row) => [row.repo_id, row]));
  const licenseByAsset = new Map(
    tables.license.filter((row) => row.asset_id !== null).map((row) => [String(row.asset_id), row]),
  );
  const filesByAsset = new Map<string, DwdAssetFileRow[]>();
  for (const file of tables.asset_file) {
    const list = filesByAsset.get(file.asset_id) ?? [];
    list.push(file);
    filesByAsset.set(file.asset_id, list);
  }
  return rows.map((asset) => ({
    asset,
    repo: repoById.get(asset.repo_id) ?? null,
    license: licenseByAsset.get(asset.asset_id) ?? null,
    files: [...(filesByAsset.get(asset.asset_id) ?? [])].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
  }));
}

/** 一组联结行 → 评分输入记录（字段一一显式映射，缺失如实 null）。 */
export function joinedToScoreInput(joined: JoinedAsset): Record<string, unknown> {
  const { asset, repo, license, files } = joined;
  const rawTexts = joined.asset as unknown as Record<string, unknown>;
  return {
    asset: {
      id: asset.asset_id,
      kind: asset.kind,
      name: asset.name,
      ref: asset.ref,
      path: asset.root,
      compliance: asset.compliance,
      capabilitiesDeclared: Array.isArray(asset.capabilities) && asset.capabilities.length > 0,
      capabilities: Array.isArray(asset.capabilities) ? [...asset.capabilities] : [],
    },
    repo: {
      repoId: repo?.repo_id ?? asset.repo_id,
      fullName: repo?.full_name ?? asset.repo_full_name,
      stars: repo?.stars ?? 0,
      forks: repo?.forks ?? 0,
      pushedAt: repo?.pushed_at ?? '',
      createdAt: repo?.created_at ?? null,
      archived: repo?.archived === true,
      fork: repo?.fork === true,
      upstream: repo?.upstream ?? null,
      commits90d: null,
      lastReleaseAt: null,
    },
    license: {
      spdx: license?.spdx ?? null,
      gate: license?.gate ?? asset.license_gate,
      evidence: {
        path: license?.evidence_path ?? null,
        sha256: license?.evidence_sha256 ?? null,
      },
    },
    files: {
      truncated: repo?.tree_truncated === true,
      entries: files.map((file) => ({
        path: file.path,
        size: file.size ?? 0,
        sha256: file.sha256 ?? '',
      })),
    },
    text: {
      frontmatter: rawTexts.text_frontmatter ?? null,
      body: rawTexts.text_body ?? null,
      readme: rawTexts.text_readme ?? null,
      manifest: rawTexts.text_manifest ?? null,
      packageJson: rawTexts.text_package_json ?? null,
      mcpJson: rawTexts.text_mcp_json ?? null,
      changelog: rawTexts.text_changelog ?? null,
    },
    trend: {
      stars90dAgo: repo?.stars_90d_ago ?? null,
      referencedBy: repo?.referenced_by ?? null,
    },
  };
}

/**
 * DWD 四表 → 评分输入批。不合约的资产逐条排除并留原因（`score.validateDwdAsset` 的口径），
 * 返回的 `inputs` 与 `excluded` 之和 = 去重后资产总数（可对账）。
 */
export function mapDwdToScoreInputs(tables: DwdTables): DwdMapResult {
  const joined = joinTables(tables);
  const { dedupedRows } = dedupeAssetRows(tables.asset);
  const inputs: ScoreInput[] = [];
  const excluded: { assetId: string; reasons: string[] }[] = [];

  for (const item of joined) {
    const record = joinedToScoreInput(item);
    const issues = score.validateDwdAsset(record);
    if (issues.length > 0) {
      excluded.push({ assetId: item.asset.asset_id, reasons: issues });
      continue;
    }
    inputs.push(score.normalizeDwdAsset(record));
  }

  return { inputs, excluded, dedupedRows };
}
