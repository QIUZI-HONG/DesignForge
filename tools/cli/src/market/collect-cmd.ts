/**
 * `df market collect` —— 采集（真网/离线重放）→ ODS 规整 → DWD 构建（判据链第 1→2 环入口）。
 *
 * 三段（`--stage` 可选 `raw` / `ods` / `dwd` / `all`，默认 all）：
 * 1. `raw`：MK-01 采集器（候选发现 → 逐仓串行 → 结构探针 + 内容校验 → ODS 原始层 + 证据 JSON）；
 * 2. `ods`：MK-02 规整（gzip 事件 + 逐仓 `files.json` + 内容寻址 blob）；
 * 3. `dwd`：MK-02 DWD 四表（Parquet）。
 *
 * 输出根 = `--data <dir>`（默认 `data`）：`<data>/ods`、`<data>/dwd`、`<data>/replay/<runId>`、
 * `<data>/evidence/`。CLI 自己的证据落在 `<data>/evidence/cli-<runId>.json`（不与各层证据冲突）。
 *
 * 退出码：0 通过 / 1 断言失败 / 2 阻塞（无凭据、无网络、样本缺失、依赖产物缺失）。
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { collect, score, transform } from '@dforge/ingest';
import { type DataPaths, resolveDataPaths } from './paths.ts';

export interface CollectCommandOptions {
  dataRoot: string;
  limit: number | null;
  seeds: string[];
  topics: string[];
  sorts: ('stars' | 'updated')[];
  perTopic: number;
  maxPagesPerQuery: number;
  since: string | null;
  maxContent: number;
  starsHistory: boolean;
  asOf: string | null;
  runId: string | null;
  replayDir: string | null;
  stage: 'raw' | 'ods' | 'dwd' | 'all';
}

export interface CollectCommandResult {
  exitCode: 0 | 1 | 2;
  summary: Record<string, unknown>;
  blockedReason: string | null;
}

/** 路径是否存在（区分「阻塞」与「断言失败」）。 */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从既有 ODS 记录推 runId（仅 ods/dwd 段运行时用；**不用当前时钟**——纯离线复跑的证据名要可复现）。
 * 取 `<ods>/raw_snapshots/date=…/…jsonl` 首行记录的 runId；读不到返回 null。
 */
async function odsRunId(paths: DataPaths): Promise<string | null> {
  try {
    const snapshotRoot = join(paths.ods, 'raw_snapshots');
    const dates = (await readdir(snapshotRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const date of dates) {
      const files = (await readdir(join(snapshotRoot, date)))
        .filter((name) => name.endsWith('.jsonl'))
        .sort();
      for (const name of files) {
        const text = await readFile(join(snapshotRoot, date, name), 'utf8');
        const first = text.split('\n').find((line) => line.trim() !== '');
        if (first === undefined) continue;
        const record = JSON.parse(first) as { runId?: unknown };
        if (typeof record.runId === 'string' && record.runId !== '') return record.runId;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** 执行采集命令（三段链路；每段产出一个证据 step）。 */
export async function runCollectCommand(
  options: CollectCommandOptions,
  log: (line: string) => void,
): Promise<CollectCommandResult> {
  const paths: DataPaths = resolveDataPaths(options.dataRoot);
  const runStages =
    options.stage === 'all' ? new Set(['raw', 'ods', 'dwd']) : new Set([options.stage]);
  const steps: score.EvidenceStep[] = [];

  const asOfMs = options.asOf !== null ? Date.parse(options.asOf) : Date.now();
  if (Number.isNaN(asOfMs)) {
    return {
      exitCode: 2,
      summary: { dataRoot: paths.root },
      blockedReason: `--as-of 不是合法时间：${String(options.asOf)}`,
    };
  }

  let runId = options.runId ?? collect.runIdOf(asOfMs);
  let rawResult: collect.CollectResult | null = null;
  let blockedReason: string | null = null;
  let asOf = options.asOf ?? new Date(asOfMs).toISOString();

  // 1) 原始采集（MK-01）
  if (runStages.has('raw')) {
    rawResult = await collect.runCollect({
      outDir: paths.root,
      runId,
      asOfMs,
      seeds: options.seeds,
      topics: options.topics,
      sorts: options.sorts,
      perTopic: options.perTopic,
      maxPagesPerQuery: options.maxPagesPerQuery,
      limit: options.limit,
      since: options.since,
      maxContentPerRepo: options.maxContent,
      starsHistory: options.starsHistory,
      replayDir: options.replayDir,
      log,
    });
    runId = rawResult.runId;
    asOf = rawResult.asOf;
    const blockStep = rawResult.evidence.steps.find((step) => step.verdict === 'blocked');
    steps.push({
      id: 'raw-collect',
      name: '原始采集（MK-01：候选 → 探针 → 内容校验 → ODS）',
      verdict: rawResult.exitCode === 2 ? 'blocked' : 'pass',
      assertions: [
        {
          name: '采集退出码（0 = 走完全流程）',
          expected: '0',
          actual: String(rawResult.exitCode),
          ok: rawResult.exitCode === 0,
        },
        {
          name: '仓数 > 0（0 仓不得当通过）',
          expected: '>0',
          actual: String(rawResult.counts.repos),
          ok: rawResult.counts.repos > 0,
        },
      ],
      artifacts: rawResult.artifacts.map((artifact) => ({
        path: artifact.path,
        sha256: artifact.sha256,
        length: artifact.length,
      })),
      metrics: {
        repos: rawResult.counts.repos,
        offline: options.replayDir !== null ? 1 : 0,
        byKind: JSON.stringify(rawResult.counts.byKind),
        byGate: JSON.stringify(rawResult.counts.byGate),
        deferredAssets: rawResult.counts.deferredAssets,
        runEvidence: rawResult.evidencePath,
      },
    });
    if (rawResult.exitCode === 2) {
      blockedReason =
        rawResult.blockedReason ??
        blockStep?.assertions[0]?.actual ??
        '采集阻塞（原因见 MK-01 证据 JSON）';
    }
  } else {
    // 只跑 ods/dwd 段：runId 从既有 ODS 记录推（不用当前时钟，证据名可复现）
    runId = options.runId ?? (await odsRunId(paths)) ?? 'cli-local';
  }

  // 2) ODS 规整（MK-02）；仅在前段未阻塞时执行
  if (blockedReason === null && runStages.has('ods')) {
    const materialize = await transform.materializeOds({ source: paths.root, out: paths.ods });
    const blockingIssues = materialize.issues.filter((issue) =>
      ['snapshot-parse', 'files-listing-missing', 'blob-corrupt', 'snapshot-conflict'].includes(
        issue.rule,
      ),
    );
    steps.push({
      id: 'ods-normalize',
      name: 'ODS 规整（gzip 事件 / 逐仓 files.json / 内容寻址 blob）',
      verdict: 'pass',
      assertions: [
        {
          name: '无阻断性问题（解析失败/清单缺失/blob 损坏/快照冲突）',
          expected: '0',
          actual: String(blockingIssues.length),
          ok: blockingIssues.length === 0,
        },
        {
          name: '产出快照数 > 0',
          expected: '>0',
          actual: String(materialize.snapshotFiles.length),
          ok: materialize.snapshotFiles.length > 0,
        },
      ],
      artifacts: materialize.artifacts.slice(0, 20),
      metrics: {
        snapshots: materialize.snapshotFiles.length,
        events: materialize.eventFiles.length,
        blobs: materialize.blobFiles.length,
        blobsWritten: materialize.blobsWritten,
        blobsDeduped: materialize.blobsDeduped,
        conflicts: materialize.conflicts.length,
        issues: materialize.issues.length,
      },
    });
  }

  // 3) DWD 构建（MK-02）
  if (blockedReason === null && runStages.has('dwd')) {
    const dwd = await transform.buildDwd({
      odsRoot: paths.ods,
      out: paths.dwd,
      ...(options.asOf !== null ? { asOf: options.asOf } : {}),
    });
    steps.push({
      id: 'dwd-build',
      name: 'DWD 四表（Parquet；`text` 抽取组与仓级列已落，规格 §4.4）',
      verdict: 'pass',
      assertions: [
        {
          name: 'DWD 校验无问题（含引用完整性）',
          expected: '0',
          actual: String(dwd.issues.length),
          ok: dwd.issues.length === 0,
        },
        {
          name: '四表产物齐（repo/asset/asset_file/license）',
          expected: '4',
          actual: String(dwd.manifest.tables.length),
          ok: dwd.manifest.tables.length === 4,
        },
      ],
      artifacts: dwd.manifest.tables.map((table) => ({
        path: table.path,
        sha256: table.sha256,
        length: table.length,
      })),
      metrics: {
        rows: JSON.stringify(
          Object.fromEntries(dwd.manifest.tables.map((table) => [table.name, table.rows])),
        ),
        clusters: JSON.stringify(dwd.manifest.clusters),
        dwdAsOf: dwd.manifest.asOf,
        manifestPath: dwd.manifestPath,
      },
    });
  }

  // 4) 对接面缺口闭合自证（阶段 A：text 组 / created_at / stars90dAgo）
  if (blockedReason === null && (await exists(join(paths.dwd, 'asset.parquet')))) {
    const tables = await transform.readDwd(paths.dwd);
    const withText = tables.asset.filter(
      (row) =>
        row.text_body !== null ||
        row.text_readme !== null ||
        row.text_manifest !== null ||
        row.text_frontmatter !== null,
    ).length;
    const withCreatedAt = tables.repo.filter((row) => row.created_at !== null).length;
    const withStars90d = tables.repo.filter((row) => row.stars_90d_ago !== null).length;
    steps.push({
      id: 'gap-closure',
      name: '对接面缺口闭合（text 抽取组 / created_at / stars90dAgo）',
      verdict: 'pass',
      assertions: [
        {
          name: 'text 抽取组非空壳（至少 1 个资产带正文/README/清单/frontmatter）',
          expected: '>0',
          actual: String(withText),
          ok: withText > 0,
        },
        {
          name: '仓级 created_at 全落（MK-01 采到即非空）',
          expected: `${tables.repo.length} 仓全落`,
          actual: `${withCreatedAt}/${tables.repo.length}`,
          ok: withCreatedAt === tables.repo.length,
        },
      ],
      artifacts: [],
      metrics: {
        assets: tables.asset.length,
        assetsWithText: withText,
        repos: tables.repo.length,
        reposWithCreatedAt: withCreatedAt,
        reposWithStars90d: withStars90d,
      },
    });
  }

  // 证据名带段名：分段跑（ods/dwd 分段）不互相覆盖，可逐段复核
  const evidenceName = `cli-${runId}-${options.stage}`;
  const evidence = score.buildEvidence({
    runId: evidenceName,
    asOf,
    offline: options.replayDir !== null,
    collector: { name: 'df-market-cli', version: '0.1.0' },
    steps,
  });
  const evidenceArtifact = score.writeJsonFile(paths.evidenceFile(evidenceName), evidence);

  return {
    exitCode: evidence.exitCode,
    summary: {
      dataRoot: paths.root,
      runId,
      offline: evidence.offline,
      stage: options.stage,
      repos: rawResult?.counts.repos ?? null,
      byKind: rawResult?.counts.byKind ?? null,
      evidence: evidenceArtifact.path,
      evidenceSha256: evidenceArtifact.sha256,
    },
    blockedReason,
  };
}
