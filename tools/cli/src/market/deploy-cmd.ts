/**
 * `df market deploy` —— ADS 产物 → daemon 数据根部署（市场线总案 v2 · 票① §4.2 真采接线）。
 *
 * 打通「采集 → 评分 → 索引 → 部署数据根」最后一段：把判据链第 4 环产出的
 * `df.marketplace.index.v1.json` + `market_search_index.v1.json` 写进 daemon 数据根
 * （`--data-root`，缺省 `~/.dforge`）的 `market/` 目录（daemon 读点
 * `apps/daemon/src/context.ts` 的 `marketIndexCandidates[0]`）。
 *
 * 模式：
 * - 缺省（重建）：对 `<data>` 的 DWD+DWS 重跑 `df market index` 同一条管线产出 ADS → 部署；
 * - `--from-index`：跳过重建，直接部署 `<data>/ads/` 现有产物（部署前仍独立过 schema 校验）；
 * - `--collect`（全链）：collect（可 `--replay` 离线）→ score → index → deploy 一条命令跑完。
 *
 * 纪律：
 * - **先校验后落盘**（复用 `ads.validateMarketplaceIndex`）——校验不过不写数据根（exit 1）；
 * - **幂等**：同输入 → 产物字节不变（sha256 相同），重复执行只更新部署账本
 *   `market/deploy-state.v1.json` 的水位（deployCount / changed / 源哈希）；
 *   账本是**部署事件记录**（`deployedAt` 用真实时刻），两张产物本体不含时钟、字节可复现；
 * - 落盘走临时文件 + rename（避免 daemon 读到半截 JSON），写后回读比对 sha256；
 * - 退出码三态（规格《市场首实现》§6.1）：0 通过 / 1 断言失败（校验不过、空索引、回读不符）/
 *   2 阻塞（上游产物缺失、上游命令阻塞、参数错误）；上游非 0 即整单非 0，禁止假绿。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { MarketplaceIndex } from '@dforge/contracts';
import { ads, score } from '@dforge/ingest';
import { runCollectCommand } from './collect-cmd.ts';
import { runIndexCommand } from './index-cmd.ts';
import type { MarketCommandOutcome } from './outcome.ts';
import { resolveDataPaths } from './paths.ts';
import { runScoreCommand } from './score-cmd.ts';

/** 出口形状取全库唯一真源（见 outcome.ts）；保留本名，调用点不动。 */
export type DeployCommandResult = MarketCommandOutcome;

/** 部署账本文件名（`<data-root>/market/deploy-state.v1.json`；daemon 不读，审计/幂等凭据）。 */
export const DEPLOY_STATE_FILENAME = 'deploy-state.v1.json';

/** 部署账本契约标识。 */
export const DEPLOY_STATE_SCHEMA = 'df.market.deploy-state/v1' as const;

/** 全链模式（`--collect`）转发给 collect/score 的选项（与 `df market collect` 同名同义）。 */
export interface DeployChainOptions {
  limit: number | null;
  seeds: readonly string[];
  topics: readonly string[];
  sorts: readonly ('stars' | 'updated')[];
  perTopic: number;
  maxPagesPerQuery: number;
  since: string | null;
  maxContent: number;
  starsHistory: boolean;
  asOf: string | null;
  runId: string | null;
  replayDir: string | null;
}

/** deploy 命令选项（CLI `df market deploy` 与单测共用）。 */
export interface DeployCommandOptions {
  /** 管线数据面根（`--data`，缺省 `data`；DWD/DWS/ADS 与 deploy 证据都在这里）。 */
  dataRoot: string;
  /** daemon 数据根（`--data-root`；null → `~/.dforge`）。 */
  deployRoot: string | null;
  /** `--from-index`：跳过重建，直接部署 `<data>/ads/` 现有产物（仍过 schema 校验）。 */
  fromIndex: boolean;
  /** `--collect` 全链模式选项；null = 不跑 collect/score。 */
  chain: DeployChainOptions | null;
  /** index 重建用 `--generated-at`（缺省取 DWD 清单 asOf）。 */
  generatedAt: string | null;
  /** index 重建用 collector.name（默认 df-market）。 */
  collectorName: string;
  /** deploy 证据 runId（缺省 `deploy-<generatedAt 日期>`，确定性、不含时钟）。 */
  runId: string | null;
}

/** daemon 数据根解析（缺省 `~/.dforge`；纯函数——单测不写盘即可锁缺省口径）。 */
export function resolveDeployRoot(raw: string | null): string {
  return raw ?? join(homedir(), '.dforge');
}

function sha256Of(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/** 原子写（临时文件 + 同目录 rename，避免 daemon/读方见到半截 JSON）。 */
async function atomicWrite(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

/** 读现有部署账本的水位（缺文件/坏行按 0 处理——账本损坏不阻塞重新部署）。 */
async function readDeployCount(targetDir: string): Promise<number> {
  try {
    const raw = JSON.parse(await readFile(join(targetDir, DEPLOY_STATE_FILENAME), 'utf8')) as {
      deployCount?: unknown;
    };
    return typeof raw.deployCount === 'number' && Number.isInteger(raw.deployCount)
      ? raw.deployCount
      : 0;
  } catch {
    return 0;
  }
}

/** 执行部署命令。 */
export async function runDeployCommand(
  options: DeployCommandOptions,
  log: (line: string) => void,
): Promise<DeployCommandResult> {
  const deployRoot = resolveDeployRoot(options.deployRoot);
  const targetDir = join(deployRoot, 'market');
  const paths = resolveDataPaths(options.dataRoot);

  // 全链模式：collect → score 先行（index 在下方与缺省重建模式同一条路径）。
  if (options.chain !== null) {
    const collectResult = await runCollectCommand(
      {
        dataRoot: options.dataRoot,
        limit: options.chain.limit,
        seeds: [...options.chain.seeds],
        topics: [...options.chain.topics],
        sorts: [...options.chain.sorts],
        perTopic: options.chain.perTopic,
        maxPagesPerQuery: options.chain.maxPagesPerQuery,
        since: options.chain.since,
        maxContent: options.chain.maxContent,
        starsHistory: options.chain.starsHistory,
        asOf: options.chain.asOf,
        runId: options.chain.runId,
        replayDir: options.chain.replayDir,
        stage: 'all',
      },
      log,
    );
    if (collectResult.exitCode !== 0) {
      return {
        exitCode: collectResult.exitCode,
        summary: { stage: 'collect', ...collectResult.summary },
        blockedReason: collectResult.blockedReason,
      };
    }
    const scoreResult = await runScoreCommand(
      { dataRoot: options.dataRoot, asOf: options.chain.asOf, runId: options.chain.runId },
      log,
    );
    if (scoreResult.exitCode !== 0) {
      return {
        exitCode: scoreResult.exitCode,
        summary: { stage: 'score', ...scoreResult.summary },
        blockedReason: scoreResult.blockedReason,
      };
    }
  }

  // 重建模式（缺省与全链共用）：重跑 index 管线产出 ADS（index 自身已先校验后落盘）。
  if (!options.fromIndex) {
    const indexResult = await runIndexCommand(
      {
        dataRoot: options.dataRoot,
        generatedAt: options.generatedAt,
        collectorName: options.collectorName,
        runId: null,
      },
      log,
    );
    if (indexResult.exitCode !== 0) {
      return {
        exitCode: indexResult.exitCode,
        summary: { stage: 'index', ...indexResult.summary },
        blockedReason: indexResult.blockedReason,
      };
    }
  }

  // 读源 ADS 产物（缺任一 → 阻塞，指明先跑 index）。
  let indexText: string;
  let searchText: string;
  try {
    indexText = await readFile(join(paths.ads, ads.ADS_INDEX_FILENAME), 'utf8');
    searchText = await readFile(join(paths.ads, ads.ADS_SEARCH_INDEX_FILENAME), 'utf8');
  } catch (error) {
    return {
      exitCode: 2,
      summary: { dataRoot: options.dataRoot, deployRoot },
      blockedReason: `ADS 产物缺失（${paths.ads}）：${String(error)}——先跑 df market index（或用 --collect 全链模式）`,
    };
  }

  // 写前校验（复用 ADS 读入面 + 生产侧 schema 校验器；解析失败按断言失败处理，不部署）。
  // arch-v1 · 票② · #3：与 CLI search / daemon 同一读入实现，不再各写一份浅查。
  const readResult = await ads.readAdsArtifacts(paths.ads);
  if (readResult.ok && readResult.searchIndex === null) {
    // 两张产物缺一不可（上方 readFile 已确认存在；此处覆盖读入面报缺失的竞态）
    return {
      exitCode: 2,
      summary: { dataRoot: options.dataRoot, deployRoot },
      blockedReason: `检索索引缺失（${join(paths.ads, ads.ADS_SEARCH_INDEX_FILENAME)}）——先跑 df market index（或用 --collect 全链模式）`,
    };
  }

  const assertions: score.EvidenceAssertion[] = [];
  const parsedIndex: MarketplaceIndex | null = readResult.ok ? readResult.index : null;
  const parsedSearch: ads.SearchIndex | null = readResult.ok ? readResult.searchIndex : null;
  assertions.push({
    name: '源 ADS 索引可解析且通过 schema 校验（df.marketplace.index/v1）',
    expected: '0 错误',
    actual: readResult.ok ? '0 错误' : readResult.reason,
    ok: readResult.ok,
  });

  const total = parsedIndex?.counts.total ?? 0;
  assertions.push({
    name: '资产数 > 0（空索引不部署，防清空真实数据根市场面）',
    expected: '> 0',
    actual: String(total),
    ok: total > 0,
  });

  const searchConsistent =
    parsedSearch !== null &&
    parsedSearch.docCount === total &&
    parsedSearch.generatedAt === parsedIndex?.generatedAt;
  assertions.push({
    name: '检索索引与卡片索引同源（schema / docCount / generatedAt 一致）',
    expected: '一致',
    actual:
      parsedSearch === null
        ? '检索索引不可解析'
        : searchConsistent
          ? '一致'
          : `schema=${String(parsedSearch.schema)}，docCount=${String(parsedSearch.docCount)}，generatedAt=${String(parsedSearch.generatedAt)}`,
    ok: searchConsistent,
  });

  const failed = assertions.filter((item) => !item.ok);
  if (failed.length > 0) {
    log('部署前校验未通过，拒绝写入数据根（先修上游，不写坏产物）：');
    for (const item of failed) log(`  ✗ ${item.name}：${item.actual}`);
    const runId = options.runId ?? 'deploy-rejected';
    const evidence = score.buildEvidence({
      runId,
      asOf: String(parsedIndex?.generatedAt ?? ''),
      offline: true,
      collector: { name: 'df-market-cli', version: '0.1.0' },
      steps: [
        {
          id: 'deploy',
          name: '部署数据根（ADS → daemon 数据根）',
          verdict: 'fail',
          assertions,
          artifacts: [],
          metrics: { assets: total, deployRootWritten: 0 },
        },
      ],
    });
    const evidenceArtifact = score.writeJsonFile(paths.evidenceFile(runId), evidence);
    log(`证据：${evidenceArtifact.path}`);
    return {
      exitCode: 1,
      summary: {
        dataRoot: options.dataRoot,
        deployRoot,
        assets: total,
        failedAssertions: failed.map((item) => item.name),
        evidence: evidenceArtifact.path,
      },
      blockedReason: null,
    };
  }

  const index = parsedIndex as MarketplaceIndex;
  const indexSha = sha256Of(indexText);
  const searchSha = sha256Of(searchText);

  // 落盘（原子写）+ 回读校验（sha256 对齐源产物）。
  await mkdir(targetDir, { recursive: true });
  const targetIndexPath = join(targetDir, ads.ADS_INDEX_FILENAME);
  const targetSearchPath = join(targetDir, ads.ADS_SEARCH_INDEX_FILENAME);
  let indexChanged = false;
  let searchIndexChanged = false;
  try {
    indexChanged = (await readFile(targetIndexPath, 'utf8')) !== indexText;
  } catch {
    indexChanged = true;
  }
  try {
    searchIndexChanged = (await readFile(targetSearchPath, 'utf8')) !== searchText;
  } catch {
    searchIndexChanged = true;
  }
  await atomicWrite(targetIndexPath, indexText);
  await atomicWrite(targetSearchPath, searchText);

  const readbackIndex = await readFile(targetIndexPath, 'utf8');
  const readbackSearch = await readFile(targetSearchPath, 'utf8');
  const readbackOk = sha256Of(readbackIndex) === indexSha && sha256Of(readbackSearch) === searchSha;
  assertions.push({
    name: '落盘回读一致（sha256 与源产物对齐）',
    expected: '对齐',
    actual: readbackOk ? '对齐' : '回读不一致（半截写或盘异常）',
    ok: readbackOk,
  });

  // 部署账本（水位；事件时刻用真实时钟，产物本体不含时钟、字节可复现）。
  const prevCount = await readDeployCount(targetDir);
  const collector = index.collector;
  const generatedAt = String(index.generatedAt);
  const ledgerPath = join(targetDir, DEPLOY_STATE_FILENAME);
  const ledger = {
    schema: DEPLOY_STATE_SCHEMA,
    deployedAt: new Date().toISOString(),
    source: {
      dataRoot: options.dataRoot,
      chain: options.chain !== null,
      fromIndex: options.fromIndex,
      runId: collector.runId,
      generatedAt,
      odsWatermark: collector.odsWatermark,
      indexSha256: indexSha,
      searchIndexSha256: searchSha,
    },
    counts: index.counts,
    targets: { index: targetIndexPath, searchIndex: targetSearchPath },
    changed: { index: indexChanged, searchIndex: searchIndexChanged },
    deployCount: prevCount + 1,
  };
  await atomicWrite(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

  const runId = options.runId ?? `deploy-${generatedAt.slice(0, 10).replace(/-/g, '')}`;
  const evidence = score.buildEvidence({
    runId,
    asOf: generatedAt,
    offline: true,
    collector: { name: 'df-market-cli', version: '0.1.0' },
    steps: [
      {
        id: 'deploy',
        name: '部署数据根（ADS → daemon 数据根）',
        verdict: readbackOk ? 'pass' : 'fail',
        assertions,
        artifacts: [
          { path: targetIndexPath, sha256: indexSha, length: Buffer.byteLength(indexText) },
          { path: targetSearchPath, sha256: searchSha, length: Buffer.byteLength(searchText) },
          {
            path: ledgerPath,
            sha256: sha256Of(`${JSON.stringify(ledger, null, 2)}\n`),
            length: Buffer.byteLength(`${JSON.stringify(ledger, null, 2)}\n`),
          },
        ],
        metrics: {
          assets: index.counts.total,
          loadable: index.counts.loadable,
          byKind: JSON.stringify(index.counts.byKind),
          deployCount: prevCount + 1,
          indexChanged: indexChanged ? 1 : 0,
          searchIndexChanged: searchIndexChanged ? 1 : 0,
        },
      },
    ],
  });
  const evidenceArtifact = score.writeJsonFile(paths.evidenceFile(runId), evidence);

  log(
    `deploy：${targetIndexPath}（${index.counts.total} 卡片，loadable ${index.counts.loadable}${indexChanged ? '，内容更新' : '，字节不变（幂等）'}）`,
  );
  log(`检索索引：${targetSearchPath}${searchIndexChanged ? '（内容更新）' : '（字节不变）'}`);
  log(`账本：${ledgerPath}（deployCount=${prevCount + 1}）`);
  log(`证据：${evidenceArtifact.path}`);

  return {
    exitCode: readbackOk ? 0 : 1,
    summary: {
      dataRoot: options.dataRoot,
      deployRoot,
      marketDir: targetDir,
      assets: index.counts.total,
      loadable: index.counts.loadable,
      byKind: index.counts.byKind,
      generatedAt,
      indexSha256: indexSha,
      searchIndexSha256: searchSha,
      indexChanged,
      searchIndexChanged,
      deployCount: prevCount + 1,
      ledger: ledgerPath,
      runId,
      evidence: evidenceArtifact.path,
    },
    blockedReason: null,
  };
}
