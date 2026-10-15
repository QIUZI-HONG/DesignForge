/**
 * `df market index` —— DWS（评分 + 分类面）→ ADS 市场索引与检索索引（判据链第 4 环）。
 *
 * 流程：读 DWD 四表 + `dws/asset_quality.jsonl` → 按 assetId 联结 → 分类面推导 →
 * `buildAdsArtifacts`（含 `df.marketplace.index/v1` schema 校验）→ **校验不过拒绝落盘（exit 1）**
 * → 写 `ads/`（index + search index）与 `dws/asset_facet.jsonl`（分类面留痕）→ 证据 JSON。
 *
 * 退出码：0 通过 / 1 断言失败（schema 不过、联结缺行）/ 2 阻塞（DWD 或 DWS 缺失）。
 */

import { readFile } from 'node:fs/promises';
import { ads, score, transform } from '@dforge/ingest';
import { buildDwsRecord } from './ads-join.ts';
import { joinTables } from './dwd-map.ts';
import { resolveDataPaths } from './paths.ts';
import { indexRunId, readDwdAsOf } from './score-cmd.ts';

/** 评分行类型（DWS JSONL 逐行解析后仍按契约校验）。 */
type QualityRecord = ReturnType<typeof score.scoreBatch>['records'][number];

export interface IndexCommandResult {
  exitCode: 0 | 1 | 2;
  summary: Record<string, unknown>;
  blockedReason: string | null;
}

/** 解析 DWS JSONL（坏行即报，不静默跳过）。 */
export function parseDwsLines(text: string): { records: unknown[]; badLines: number[] } {
  const records: unknown[] = [];
  const badLines: number[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      records.push(JSON.parse(trimmed) as unknown);
    } catch {
      badLines.push(index + 1);
    }
  }
  return { records, badLines };
}

/** 执行索引命令。 */
export async function runIndexCommand(
  options: {
    dataRoot: string;
    generatedAt: string | null;
    runId: string | null;
    collectorName: string;
  },
  log: (line: string) => void,
): Promise<IndexCommandResult> {
  const paths = resolveDataPaths(options.dataRoot);

  let tables: Awaited<ReturnType<typeof transform.readDwd>>;
  try {
    tables = await transform.readDwd(paths.dwd);
  } catch (error) {
    return {
      exitCode: 2,
      summary: { dataRoot: paths.root },
      blockedReason: `DWD 读取失败（${paths.dwd}）：${String(error)}`,
    };
  }

  let qualityText: string;
  try {
    qualityText = await readFile(paths.qualityFile, 'utf8');
  } catch (error) {
    return {
      exitCode: 2,
      summary: { dataRoot: paths.root },
      blockedReason: `DWS 评分产物缺失（${paths.qualityFile}）：${String(error)}——先跑 df market score`,
    };
  }

  const { records: rawQuality, badLines } = parseDwsLines(qualityText);
  if (badLines.length > 0) {
    return {
      exitCode: 1,
      summary: { dataRoot: paths.root, badLines: badLines.slice(0, 5) },
      blockedReason: null,
    };
  }
  const qualityByAsset = new Map<string, QualityRecord>();
  const qualityIssues: string[] = [];
  for (const raw of rawQuality) {
    const issues = score.validateDwsRecord(raw);
    const record = raw as { assetId?: unknown };
    if (issues.length > 0) {
      qualityIssues.push(`${String(record.assetId)}: ${issues[0]}`);
      continue;
    }
    qualityByAsset.set(String(record.assetId), raw as QualityRecord);
  }

  const joined = joinTables(tables);
  const dwsRecords: ads.DwsAssetRecord[] = [];
  const missingQuality: string[] = [];
  const excludedIncomplete: { assetId: string; repo: string; kind: string; reason: string }[] = [];
  for (const item of joined) {
    const quality = qualityByAsset.get(item.asset.asset_id);
    if (quality === undefined) {
      missingQuality.push(item.asset.asset_id);
      continue;
    }
    // 卡片硬门槛（集成裁决，见跑通报告「漂移与裁决」）：
    //   ① `digest` 必填且为规格 §1.6 口径（内容齐备才可算，MK-02 未齐时如实 null）；
    //   ② 许可证据 `sha256` 需为真实哈希（§1.3）——空串会被 MK-04 的严格校验器拦下
    //      （其构造器与校验器对「空证据」口径不一致，已登记集成债；本票不伪造证据，改为不入索引）。
    if (item.asset.digest === null || item.asset.digest_status !== 'ok') {
      excludedIncomplete.push({
        assetId: item.asset.asset_id,
        repo: item.asset.repo_full_name,
        kind: item.asset.kind,
        reason: `digest 未齐（status=${item.asset.digest_status}，coverage=${String(item.asset.digest_coverage)}）——内容未全量取回，不入首版索引`,
      });
      continue;
    }
    const evidenceSha = item.license?.evidence_sha256 ?? null;
    if (evidenceSha === null) {
      excludedIncomplete.push({
        assetId: item.asset.asset_id,
        repo: item.asset.repo_full_name,
        kind: item.asset.kind,
        reason: '许可原文 sha256 未取回（§1.3 证据缺失）——不入首版索引',
      });
      continue;
    }
    dwsRecords.push(buildDwsRecord(item, quality));
  }

  const asOf = await readDwdAsOf(paths);
  const generatedAt = options.generatedAt ?? asOf ?? '';
  if (generatedAt === '') {
    return {
      exitCode: 2,
      summary: { dataRoot: paths.root },
      blockedReason: 'generatedAt 不可定（DWD 清单缺 asOf；请显式 --generated-at）',
    };
  }
  const runId = options.runId ?? indexRunId(generatedAt);

  const artifacts = ads.buildAdsArtifacts(dwsRecords, {
    generatedAt,
    collector: {
      name: options.collectorName,
      version: '0.1.0',
      runId,
      odsWatermark: asOf ?? generatedAt,
    },
  });

  const facetArtifact = score.writeJsonFile(paths.facetFile, {
    schema: 'df.market.dws.asset_facet/v1',
    asOf: generatedAt,
    rows: dwsRecords.map((record) => ({
      assetId: record.id,
      kind: record.kind,
      facets: record.facets,
    })),
  });

  const blockedCount = dwsRecords.filter(
    (record) => record.source.license.gate === 'blocked' || record.source.brandDerived,
  ).length;
  const kindCounts = { skill: 0, plugin: 0, 'design-system': 0, template: 0 };
  for (const record of dwsRecords) kindCounts[record.kind] += 1;

  const assertions: { name: string; expected: string; actual: string; ok: boolean }[] = [
    {
      name: 'index 通过 schema 校验（df.marketplace.index/v1）',
      expected: '0 错误',
      actual: artifacts.validation.ok
        ? '0 错误'
        : artifacts.validation.errors
            .slice(0, 2)
            .map((issue) => `${issue.path}:${issue.code}`)
            .join(' / '),
      ok: artifacts.validation.ok,
    },
    {
      name: 'DWS 评分行全部可校验（无坏行/无契约问题）',
      expected: '0 问题',
      actual: qualityIssues.length === 0 ? '0 问题' : qualityIssues.slice(0, 2).join(' / '),
      ok: qualityIssues.length === 0,
    },
    {
      name: '每个入库资产都有评分记录（联结无缺口）',
      expected: '0 缺口',
      actual:
        missingQuality.length === 0
          ? '0 缺口'
          : `${missingQuality.length} 条（如 ${missingQuality[0]}）`,
      ok: missingQuality.length === 0,
    },
    {
      name: 'blocked 资产不进索引（规格 §1.1/§7.2）',
      expected: '0',
      actual: String(
        artifacts.index.assets.filter((asset) => asset.installGate.mode === 'blocked').length,
      ),
      ok: artifacts.index.assets.every((asset) => asset.installGate.mode !== 'blocked'),
    },
  ];

  if (!artifacts.validation.ok) {
    log('索引未通过 schema 校验，拒绝落盘（先修上游，不写坏产物）');
    for (const issue of artifacts.validation.errors.slice(0, 10)) {
      log(`  ✗ ${issue.path || '(root)'}：${issue.code}`);
    }
  }
  const written = artifacts.validation.ok
    ? await ads.writeAdsArtifacts(paths.ads, artifacts)
    : null;

  const steps: score.EvidenceStep[] = [
    {
      id: 'index-build',
      name: '索引产出（ADS）',
      verdict: 'pass',
      assertions,
      artifacts: written === null ? [] : [written.index, written.searchIndex, facetArtifact],
      metrics: {
        dwsRecords: dwsRecords.length,
        excludedNoQuality: missingQuality.length,
        excludedIncomplete: excludedIncomplete.length,
        excludedNoDigest: excludedIncomplete.filter((item) => item.reason.startsWith('digest'))
          .length,
        excludedNoLicenseEvidence: excludedIncomplete.filter((item) =>
          item.reason.startsWith('许可原文'),
        ).length,
        blockedInBatch: blockedCount,
        assets: artifacts.index.counts.total,
        loadable: artifacts.index.counts.loadable,
        byKind: JSON.stringify(artifacts.index.counts.byKind),
        warnings: artifacts.validation.warnings.length,
      },
    },
  ];

  // 排除留痕（不入索引的资产逐条可审计；不静默丢）
  const excludedArtifact = score.writeJsonFile(`${paths.dws}/_index_excluded.json`, {
    schema: 'df.market.dws.index-excluded/v1',
    asOf: generatedAt,
    counts: {
      noQuality: missingQuality.length,
      incompleteEvidence: excludedIncomplete.length,
      noDigest: excludedIncomplete.filter((item) => item.reason.startsWith('digest')).length,
      noLicenseEvidence: excludedIncomplete.filter((item) => item.reason.startsWith('许可原文'))
        .length,
    },
    items: excludedIncomplete,
    qualityGaps: missingQuality,
  });

  const evidence = score.buildEvidence({
    runId,
    asOf: generatedAt,
    offline: true,
    collector: { name: 'df-market-cli', version: '0.1.0' },
    steps,
  });
  const evidenceArtifact = score.writeJsonFile(paths.evidenceFile(runId), evidence);

  if (written !== null) {
    log(
      `index：${written.index.path}（${artifacts.index.counts.total} 卡片，loadable ${artifacts.index.counts.loadable}，sha256 ${written.index.sha256.slice(0, 16)}…）`,
    );
    log(`检索索引：${written.searchIndex.path}`);
  }
  log(`证据：${evidenceArtifact.path}`);
  return {
    exitCode: evidence.exitCode,
    summary: {
      dataRoot: paths.root,
      runId,
      generatedAt,
      assets: artifacts.index.counts.total,
      loadable: artifacts.index.counts.loadable,
      byKind: artifacts.index.counts.byKind,
      loadableByKind: countLoadableByKind(artifacts.index.assets),
      excludedNoQuality: missingQuality.length,
      excludedIncomplete: excludedIncomplete.length,
      excludedArtifact: excludedArtifact.path,
      blockedInBatch: blockedCount,
      indexSha256: written?.index.sha256 ?? null,
      searchIndexSha256: written?.searchIndex.sha256 ?? null,
      evidence: evidenceArtifact.path,
    },
    blockedReason: null,
  };
}

function countLoadableByKind(assets: readonly { kind: string; installGate: { mode: string } }[]) {
  const out: Record<string, number> = { skill: 0, plugin: 0, 'design-system': 0, template: 0 };
  for (const asset of assets) {
    if (asset.installGate.mode === 'loadable') out[asset.kind] = (out[asset.kind] ?? 0) + 1;
  }
  return out;
}
