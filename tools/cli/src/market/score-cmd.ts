/**
 * `df market score` —— DWD → DWS 五维评分（判据链第 3 环）。
 *
 * 流程：读 DWD 四表 → 适配为评分输入（不合约者逐条留痕排除）→ 两遍评分做**确定性互证**
 * （逐字节一致）→ 校验 DWS 记录（含总分与维度分互证）→ 落 `dws/asset_quality.jsonl`
 * 与 `dws/_dws_manifest.json` → 证据 JSON。
 *
 * 退出码（规格《市场首实现》§6.1）：0 通过 / 1 断言失败 / 2 阻塞（DWD 缺失、asOf 不可定）。
 */

import { readFile } from 'node:fs/promises';
import { score, transform } from '@dforge/ingest';
import { mapDwdToScoreInputs } from './dwd-map.ts';
import { type DataPaths, resolveDataPaths } from './paths.ts';

export interface ScoreCommandResult {
  exitCode: 0 | 1 | 2;
  summary: Record<string, unknown>;
  blockedReason: string | null;
}

/** 读 DWD 清单里的批次时点（同输入同输出：asOf 来自 ODS 记录，不依赖时钟）。 */
export async function readDwdAsOf(paths: DataPaths): Promise<string | null> {
  try {
    const manifest = JSON.parse(await readFile(`${paths.dwd}/_dwd_manifest.json`, 'utf8')) as {
      asOf?: unknown;
    };
    return typeof manifest.asOf === 'string' && manifest.asOf !== '' ? manifest.asOf : null;
  } catch {
    return null;
  }
}

/** 由 asOf 生成 runId（`score-YYYYMMDD`，确定性，不含时钟）。 */
export function scoreRunId(asOf: string): string {
  return `score-${asOf.slice(0, 10).replace(/-/g, '')}`;
}

/** 索引批次的 runId（`index-YYYYMMDD`，由注入的 generatedAt 派生）。 */
export function indexRunId(generatedAt: string): string {
  return `index-${generatedAt.slice(0, 10).replace(/-/g, '')}`;
}

/** 执行评分命令（不打印；返回结构供 CLI 与测试复用）。 */
export async function runScoreCommand(
  options: { dataRoot: string; asOf: string | null; runId: string | null },
  log: (line: string) => void,
): Promise<ScoreCommandResult> {
  const paths = resolveDataPaths(options.dataRoot);

  let tables: Awaited<ReturnType<typeof transform.readDwd>>;
  try {
    tables = await transform.readDwd(paths.dwd);
  } catch (error) {
    return {
      exitCode: 2,
      summary: { dataRoot: paths.root },
      blockedReason: `DWD 读取失败（${paths.dwd}）：${String(error)}——先跑 df market collect`,
    };
  }

  const asOf = options.asOf ?? (await readDwdAsOf(paths));
  if (asOf === null) {
    return {
      exitCode: 2,
      summary: { dataRoot: paths.root },
      blockedReason: 'asOf 不可定（DWD 清单缺 asOf；请显式 --as-of）——确定性纪律，禁止用当前时钟',
    };
  }
  const runId = options.runId ?? scoreRunId(asOf);

  const mapped = mapDwdToScoreInputs(tables);
  log(
    `DWD 资产 ${tables.asset.length} 行（去重丢弃 ${mapped.dedupedRows} 行）→ ` +
      `评分输入 ${mapped.inputs.length} 条，排除 ${mapped.excluded.length} 条（文本材料不足等，逐条留痕）`,
  );
  for (const item of mapped.excluded.slice(0, 5)) {
    log(`  ✗ 排除 ${item.assetId}：${item.reasons[0] ?? ''}`);
  }
  if (mapped.excluded.length > 5) log(`  … 另有 ${mapped.excluded.length - 5} 条排除`);

  const first = score.scoreBatch(mapped.inputs, { asOf });
  const second = score.scoreBatch(mapped.inputs, { asOf });
  const jsonlFirst = score.dwsJsonl(first.records);
  const jsonlSecond = score.dwsJsonl(second.records);

  const recordIssues = first.records.flatMap((record) =>
    score.validateDwsRecord(record).map((issue) => `${record.assetId}: ${issue}`),
  );
  const explainGaps = first.records.filter((record) =>
    score.DIMENSIONS.some((dim) => record.explain[dim].signals.length === 0),
  );
  const dimHoles = first.records.reduce(
    (sum, record) => sum + score.DIMENSIONS.filter((dim) => record.dims[dim] === null).length,
    0,
  );

  if (first.records.length === 0) {
    return {
      exitCode: 2,
      summary: { dataRoot: paths.root, asOf, runId },
      blockedReason: '评分输入为 0 条（无合合约资产）——阻塞，不以空产物冒充通过',
    };
  }

  const qualityArtifact = score.writeDwsJsonl(paths.qualityFile, first.records);
  const manifest = {
    schema: 'df.market.dws.manifest/v1',
    asOf,
    runId,
    inputs: mapped.inputs.length,
    records: first.records.length,
    dedupedRows: mapped.dedupedRows,
    excluded: mapped.excluded,
    summary: first.summary,
    dimHoles,
    quality: qualityArtifact,
  };
  const manifestArtifact = score.writeJsonFile(paths.dwsManifest, manifest);

  const assertions: { name: string; expected: string; actual: string; ok: boolean }[] = [
    {
      name: 'DWD 资产 → 评分输入可对账（输入 + 排除 = 去重后资产数）',
      expected: String(mapped.inputs.length + mapped.excluded.length),
      actual: String(tables.asset.length - mapped.dedupedRows),
      ok:
        mapped.inputs.length + mapped.excluded.length === tables.asset.length - mapped.dedupedRows,
    },
    {
      name: 'DWS 记录全过校验（含总分与维度分互证）',
      expected: '0 问题',
      actual: recordIssues.length === 0 ? '0 问题' : recordIssues.slice(0, 2).join(' / '),
      ok: recordIssues.length === 0,
    },
    {
      name: '五维 explain 非空（正信号或如实空心，无缺失）',
      expected: '0 条缺口',
      actual: explainGaps.length === 0 ? '0 条缺口' : `${explainGaps.length} 条`,
      ok: explainGaps.length === 0,
    },
    {
      name: '确定性：同输入两遍评分逐字节一致',
      expected: '一致',
      actual: jsonlFirst === jsonlSecond ? '一致' : '不一致',
      ok: jsonlFirst === jsonlSecond,
    },
  ];

  const steps: score.EvidenceStep[] = [
    {
      id: 'score-inputs',
      name: 'DWD → 评分输入（适配层）',
      verdict: 'pass',
      assertions: assertions.slice(0, 1),
      artifacts: [],
      metrics: {
        assets: tables.asset.length,
        inputs: mapped.inputs.length,
        excluded: mapped.excluded.length,
        dedupedRows: mapped.dedupedRows,
      },
    },
    {
      id: 'dws-scoring',
      name: '五维评分与可解释（规格 §5）',
      verdict: 'pass',
      assertions: assertions.slice(1, 3),
      artifacts: [qualityArtifact],
      metrics: {
        records: first.records.length,
        fullyScored: first.summary.fullyScored,
        coldStart: first.summary.coldStart,
        archived: first.summary.archived,
        nonCompliant: first.summary.nonCompliant,
        dimHoles,
      },
    },
    {
      id: 'determinism',
      name: '确定性（规格 §4.3.2）',
      verdict: 'pass',
      assertions: assertions.slice(3),
      artifacts: [],
      metrics: {
        sha256: score.sha256Hex(jsonlFirst),
        bytes: Buffer.byteLength(jsonlFirst, 'utf8'),
      },
    },
    {
      id: 'dws-output',
      name: 'DWS 层产物',
      verdict: 'pass',
      assertions: [],
      artifacts: [qualityArtifact, manifestArtifact],
      metrics: { path: qualityArtifact.path, records: first.records.length },
    },
  ];

  const evidence = score.buildEvidence({
    runId,
    asOf,
    offline: true,
    collector: { name: 'df-market-cli', version: '0.1.0' },
    steps,
  });
  const evidenceArtifact = score.writeJsonFile(paths.evidenceFile(runId), evidence);

  const failed = evidence.exitCode !== 0;
  log(
    `评分产物：${qualityArtifact.path}（${first.records.length} 条，sha256 ${qualityArtifact.sha256.slice(0, 16)}…）`,
  );
  log(`证据：${evidenceArtifact.path}`);
  return {
    exitCode: evidence.exitCode,
    summary: {
      dataRoot: paths.root,
      asOf,
      runId,
      inputs: mapped.inputs.length,
      excluded: mapped.excluded.length,
      records: first.records.length,
      dimHoles,
      evidence: evidenceArtifact.path,
      qualitySha256: qualityArtifact.sha256,
      failedAssertions: failed
        ? evidence.steps.flatMap((step) => step.assertions.filter((a) => !a.ok).map((a) => a.name))
        : [],
    },
    blockedReason: null,
  };
}
