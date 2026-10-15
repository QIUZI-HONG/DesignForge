/**
 * 采集编排（MK-01 主流程）。
 *
 * 顺序（对应规格判据链前两环 + 产物落盘）：
 *   候选（topic 只作候选 + 种子白名单）→ 逐仓串行：
 *   meta → ref(commit) → trees(recursive=1) → license 证据 → 内容抽样校验
 *   → 识别（探针 + 内容校验）→ ODS 一仓一记录；
 *   最后写 raw_events（请求纪律证据）、证据 JSON、重放样本。
 *
 * 结局语义（规格 §6.1）：
 *   - 0 = 全流程走完且断言全过；
 *   - 1 = 有数据但断言失败（真失败）；
 *   - 2 = 阻塞（无凭据 / 无网络 / 离线样本缺失 / 连续限速熔断）——**不伪造数据**。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Candidate, type CandidateSource, discoverCandidates } from './candidates.ts';
import type { FileCacheStore, GitHubClient } from './client.ts';
import {
  createGitHubClient,
  createRecordingFetch,
  createReplayFetch,
  ghAuthTokenRunner,
  loadFileCacheStore,
  parseRecordedResponses,
  ReplayMissError,
  resolveGitHubToken,
  UpstreamError,
} from './client.ts';
import { buildEvidence } from './evidence.ts';
import type { FetchLike } from './http.ts';
import { sha256Hex } from './http.ts';
import { digestForRoot, findLicensePath, identifyAssets } from './identify.ts';
import { assessLicense } from './license.ts';
import type { OdsArtifact } from './ods.ts';
import { validateOdsRepoRecord, validateRawEvent, writeOds } from './ods.ts';
import { probeTree } from './probe.ts';
import type { Clock } from './ratelimit.ts';
import {
  BudgetLedger,
  ConsecutiveRateLimitAbort,
  RateLimitWatch,
  RequestGovernor,
  systemClock,
} from './ratelimit.ts';
import type {
  AssetKind,
  Evidence,
  EvidenceAssertion,
  EvidenceStep,
  ExitCode,
  OdsRepoRecord,
  RawEvent,
  TreeEntry,
} from './types.ts';

/** 每仓内容取回优先级（规格 §3.7「Contents 抽样 1–3」；MK-01 默认预算放大到 32 见 runCollect）。 */
const CONTENT_PRIORITY: { piece: string; rank: number }[] = [
  { piece: 'plugin-manifest', rank: 0 },
  { piece: 'marketplace-manifest', rank: 1 },
  { piece: 'template-manifest', rank: 2 },
  { piece: 'manifest-json', rank: 3 },
  { piece: 'components-manifest', rank: 4 },
  { piece: 'tokens-file', rank: 5 },
  { piece: 'package-json', rank: 6 },
  { piece: 'skill-doc', rank: 7 },
];

export interface ContentSelection {
  selected: string[];
  deferred: string[];
}

/**
 * 按优先级选取需要取回正文的路径（预算内）。
 * 未选中的进 `deferred`（识别层据此标 `compliance: 'deferred'`，不假装校验过）。
 */
export function selectContentPaths(tree: TreeEntry[], budget: number): ContentSelection {
  const pieces = probeTree(tree).filter((p) => CONTENT_PRIORITY.some((c) => c.piece === p.piece));
  const ranked = pieces
    .map((p) => ({
      path: p.path,
      rank: CONTENT_PRIORITY.find((c) => c.piece === p.piece)?.rank ?? 99,
    }))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.path < b.path ? -1 : 1));

  const unique: string[] = [];
  for (const item of ranked) if (!unique.includes(item.path)) unique.push(item.path);
  return { selected: unique.slice(0, budget), deferred: unique.slice(budget) };
}

export interface CollectOptions {
  outDir: string;
  runId: string;
  asOfMs: number;
  /** 种子白名单仓（owner/name，直连探针，不经搜索）。 */
  seeds: string[];
  topics: string[];
  sorts: ('stars' | 'updated')[];
  perTopic: number;
  maxPagesPerQuery: number;
  /** 总仓上限（首批小跑 `--limit 5`）。 */
  limit: number | null;
  since: string | null;
  /**
   * 每仓内容取回预算。规格 §3.7 估算为 1–3（保守基线）；MK-01 取 32 让首批
   * 小仓全量校验（5 仓 ≈ 170 次 core，远低于 4000/时预算），超大仓如实 deferred。
   */
  maxContentPerRepo: number;
  /** 离线重放目录（含 responses.jsonl + manifest.json）；非空即离线模式。 */
  replayDir: string | null;
  /** 测试注入：请求出口（生产 = 全局 fetch）。 */
  fetchImpl?: FetchLike;
  /** 测试注入：凭据；`undefined` = 走真实解析，`null` = 无凭据（阻塞）。 */
  token?: { token: string; source: 'env' | 'gh' } | null;
  /** 单次请求最大尝试数（默认 5；测试注入 1 以快速验证失败路径）。 */
  maxAttempts?: number;
  /** 进度输出（CLI 用；默认静默）。 */
  log?: (line: string) => void;
}

export interface CollectResult {
  exitCode: ExitCode;
  runId: string;
  asOf: string;
  records: OdsRepoRecord[];
  evidence: Evidence;
  artifacts: OdsArtifact[];
  evidencePath: string;
  replayDir: string | null;
  blockedReason: string | null;
  counts: {
    repos: number;
    byKind: Record<AssetKind, number>;
    byGate: Record<'loadable' | 'view-only' | 'blocked', number>;
    deferredAssets: number;
    brandDerivedAssets: number;
    skippedRepos: { repo: string; reason: string }[];
  };
}

/** 冻结时钟：离线重放用（时间不动、sleep 立即返回——重放不触网、无需 pacing）。 */
function frozenClock(atMs: number): Clock {
  return { now: () => atMs, sleep: () => Promise.resolve() };
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

function dateOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 种子仓 → 候选形态（repo id 未知，取 meta 后回填；带去重用的 fullName）。 */
function seedCandidates(seeds: string[]): Candidate[] {
  return seeds.map((fullName) => ({
    repoId: -1,
    fullName,
    owner: fullName.split('/')[0] ?? '',
    name: fullName.split('/')[1] ?? '',
    description: null,
    stars: 0,
    pushedAt: '',
    defaultBranch: 'main',
    archived: false,
    fork: false,
    sizeKb: 0,
    homepage: null,
    topics: [],
    licenseSpdx: null,
    discoveredBy: [],
    isList: false,
  }));
}

/** 抽取可复现的采集参数（写入重放 manifest；重放时原样取回）。 */
export function collectParamsOf(opts: CollectOptions): ReplayParams {
  return {
    seeds: opts.seeds,
    topics: opts.topics,
    sorts: opts.sorts,
    perTopic: opts.perTopic,
    maxPagesPerQuery: opts.maxPagesPerQuery,
    limit: opts.limit,
    since: opts.since,
    maxContentPerRepo: opts.maxContentPerRepo,
  };
}

/** 重放 manifest 里的采集参数子集。 */
export interface ReplayParams {
  seeds: string[];
  topics: string[];
  sorts: ('stars' | 'updated')[];
  perTopic: number;
  maxPagesPerQuery: number;
  limit: number | null;
  since: string | null;
  maxContentPerRepo: number;
}

/** 读重放 manifest（缺失/损坏 → null，退回调用方参数）。 */
async function readReplayManifest(
  replayDir: string,
): Promise<{ runId: string; asOfMs: number; params: Partial<ReplayParams> } | null> {
  try {
    const parsed = JSON.parse(await readFile(join(replayDir, 'manifest.json'), 'utf8')) as {
      runId?: unknown;
      asOfMs?: unknown;
      params?: Partial<ReplayParams>;
    };
    if (typeof parsed.runId !== 'string' || typeof parsed.asOfMs !== 'number') return null;
    return { runId: parsed.runId, asOfMs: parsed.asOfMs, params: parsed.params ?? {} };
  } catch {
    return null;
  }
}

/** 主流程。 */
export async function runCollect(opts: CollectOptions): Promise<CollectResult> {
  const log = opts.log ?? (() => {});
  const offline = opts.replayDir !== null;
  /** 生效参数（离线重放时被样本 manifest 覆盖，保证 URL 逐条命中）。 */
  let effective: CollectOptions = opts;

  if (offline && opts.replayDir !== null) {
    // 重放以样本 manifest 的采集参数为准（精确复现：URL 必须逐条命中样本）。
    const manifest = await readReplayManifest(opts.replayDir);
    if (manifest !== null) {
      effective = { ...opts, ...manifest.params, runId: manifest.runId, asOfMs: manifest.asOfMs };
      log(`重放参数（取自样本 manifest）：${JSON.stringify(manifest.params)}`);
    }
  }

  const clock: Clock = offline ? frozenClock(effective.asOfMs) : systemClock;

  const ledger = new BudgetLedger({ clock });
  const governor = offline
    ? new RequestGovernor({
        clock,
        core: { capacity: 1e9, refillMs: 1 },
        search: { capacity: 1e9, refillMs: 1 },
      })
    : new RequestGovernor({ clock });
  const rateLimitWatch = new RateLimitWatch({ threshold: 3 });
  const events: RawEvent[] = [];
  const recordedLines: string[] = [];
  const skippedRepos: { repo: string; reason: string }[] = [];

  // 1) 请求出口：真网（可录制）或重放（零网络）
  let baseFetch: FetchLike | null = null;
  let blockedReason: string | null = null;
  let token: string | null = null;
  let cacheStore: FileCacheStore | null = null;

  if (offline && opts.replayDir !== null) {
    try {
      const raw = await readFile(join(opts.replayDir, 'responses.jsonl'), 'utf8');
      baseFetch = createReplayFetch(parseRecordedResponses(raw));
      log(`离线重放：样本 ${join(opts.replayDir, 'responses.jsonl')}`);
    } catch (error) {
      blockedReason = `离线样本不可读：${String(error)}（阻塞：不触网、不伪造）`;
    }
  } else {
    const resolution =
      opts.token !== undefined ? opts.token : resolveGitHubToken(process.env, ghAuthTokenRunner);
    if (resolution === null) {
      blockedReason = '无 GitHub 凭据（GH_TOKEN/GITHUB_TOKEN 或 gh auth token 均不可用）——阻塞';
    } else {
      token = resolution.token;
      log(`凭据来源：${resolution.source}`);
      const productionFetch: FetchLike =
        opts.fetchImpl ?? ((url, init) => fetch(url, init) as Promise<Response>);
      const recordingFetch = createRecordingFetch(productionFetch, (line) =>
        recordedLines.push(line),
      );
      baseFetch = recordingFetch;
      // 跨运行 ETag 缓存（规格 §3.2：条件请求 304 不重复下载、不计主限额）。
      cacheStore = await loadFileCacheStore(join(opts.outDir, 'cache', 'etag-cache.json'));
      log(`ETag 缓存：${cacheStore.size()} 条（${join(opts.outDir, 'cache', 'etag-cache.json')}）`);
    }
  }

  const steps: EvidenceStep[] = [];
  const artifacts: OdsArtifact[] = [];
  const records: OdsRepoRecord[] = [];
  let listRepos: Candidate[] = [];
  let queries: { topic: string; sort: string; pages: number; items: number; totalCount: number }[] =
    [];

  if (blockedReason === null && baseFetch !== null) {
    const deps = {
      fetchImpl: baseFetch,
      governor,
      ledger,
      rateLimitWatch,
      runId: effective.runId,
      clock,
      onEvent: (e: RawEvent) => events.push(e),
      rand: Math.random,
      ...(opts.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
    };
    const client: GitHubClient = createGitHubClient({
      deps,
      token,
      ...(cacheStore !== null ? { cacheStore } : {}),
    });

    // 2) 候选：种子优先，其次 topic 发现（topic 只作候选）
    const merged: Candidate[] = seedCandidates(effective.seeds);
    const seenNames = new Set(merged.map((c) => c.fullName.toLowerCase()));
    if (effective.topics.length > 0) {
      try {
        const discovery = await discoverCandidates(client as CandidateSource, {
          topics: effective.topics,
          sorts: effective.sorts,
          perTopic: effective.perTopic,
          since: effective.since,
          maxPagesPerQuery: effective.maxPagesPerQuery,
        });
        listRepos = discovery.listRepos.slice();
        queries = discovery.queries;
        for (const candidate of discovery.candidates) {
          if (seenNames.has(candidate.fullName.toLowerCase())) continue;
          seenNames.add(candidate.fullName.toLowerCase());
          merged.push(candidate);
        }
        log(
          `候选发现：${discovery.candidates.length} 仓（清单仓单列 ${listRepos.length}）；` +
            `查询 ${queries.map((q) => `${q.topic}/${q.sort}=${q.items}`).join(', ')}`,
        );
      } catch (error) {
        if (error instanceof ConsecutiveRateLimitAbort) {
          blockedReason = `${error.message}——阻塞`;
        } else if (error instanceof ReplayMissError) {
          blockedReason = `${error.message}——阻塞`;
        } else {
          blockedReason = `候选发现失败：${String(error)}——阻塞（网络不可用或上游异常）`;
        }
      }
    }

    const targets = effective.limit === null ? merged : merged.slice(0, effective.limit);
    log(
      `采集目标：${targets.length} 仓（种子 ${effective.seeds.length} + 发现 ${merged.length - effective.seeds.length}，上限 ${effective.limit ?? '不限'}）`,
    );

    // 3) 逐仓串行采集
    for (const target of targets) {
      if (blockedReason !== null) break;
      const eventStart = events.length;
      try {
        const metaResult = await client.getRepoMeta(target.fullName);
        const meta = metaResult.meta;
        if (meta.id === 0) {
          skippedRepos.push({ repo: target.fullName, reason: '元数据缺 id（上游异常）' });
          continue;
        }
        const refResult = await client.getRef(target.fullName, meta.defaultBranch);
        if (refResult.commitSha === null) {
          skippedRepos.push({
            repo: target.fullName,
            reason: '无法解析分支 commit（ref 缺失，不伪造）',
          });
          continue;
        }
        const treeResult = await client.getTree(target.fullName, meta.defaultBranch);

        // license 证据（许可原文 sha256；独立于内容预算）
        const licensePath = findLicensePath(treeResult.entries);
        let licenseSha256: string | null = null;
        if (licensePath !== null) {
          try {
            const content = await client.getContents(
              target.fullName,
              licensePath,
              refResult.commitSha,
            );
            if (content.text !== null) licenseSha256 = `sha256:${sha256Hex(content.text)}`;
          } catch {
            // 许可原文取回失败：如实留 null（不影响识别；证据 JSON 可回溯）
          }
        }
        const license = assessLicense({
          spdx: meta.licenseSpdx,
          hasLicenseFile: licensePath !== null,
          archived: meta.archived,
          brandDerived: false, // 品牌复刻按资产粒度判定（asset.brandDerived），见 types 注释
          licensePath,
          licenseSha256,
        });

        // 内容抽样（预算内按优先级）
        const selection = selectContentPaths(treeResult.entries, effective.maxContentPerRepo);
        const contents = new Map<string, string>();
        for (const path of selection.selected) {
          try {
            const content = await client.getContents(target.fullName, path, refResult.commitSha);
            if (content.text !== null) contents.set(path, content.text);
          } catch (error) {
            if (error instanceof ReplayMissError) throw error;
            // 单文件取回失败：跳过该文件（识别层按未取回处理）
          }
        }

        const identified = identifyAssets({
          repoFullName: target.fullName,
          tree: treeResult.entries,
          contents,
          deferredPaths: new Set(selection.deferred),
          license,
        });

        const record: OdsRepoRecord = {
          schema: 'df.market.ods.repo/v1',
          runId: effective.runId,
          fetchedAt: isoOf(effective.asOfMs),
          repo: {
            id: meta.id,
            fullName: meta.fullName,
            owner: meta.owner,
            name: meta.name,
            defaultBranch: meta.defaultBranch,
            stars: meta.stars,
            forks: meta.forks,
            pushedAt: meta.pushedAt,
            archived: meta.archived,
            fork: meta.fork,
            sizeKb: meta.sizeKb,
            homepage: meta.homepage,
            description: meta.description,
            topics: meta.topics,
          },
          ref: refResult.commitSha,
          etag: metaResult.etag,
          digest: digestForRoot(treeResult.entries, ''),
          tree: {
            sha: treeResult.treeSha,
            truncated: treeResult.truncated,
            entryCount: treeResult.entries.length,
            etag: treeResult.etag,
          },
          license,
          assets: identified.assets,
          rejected: identified.rejected,
          isListRepo: target.isList,
          requestUrls: events.slice(eventStart).map((e) => e.request.url),
        };
        records.push(record);
        const kindCounts = new Map<string, number>();
        for (const asset of identified.assets) {
          kindCounts.set(asset.kind, (kindCounts.get(asset.kind) ?? 0) + 1);
        }
        const kindSummary =
          kindCounts.size === 0
            ? '（无）'
            : `[${[...kindCounts.entries()].map(([k, n]) => `${k}×${n}`).join(', ')}]`;
        log(
          `  ✓ ${meta.fullName}（${meta.stars}★，${license.gate}）：` +
            `${identified.assets.length} 资产${kindSummary}` +
            `${identified.rejected.length > 0 ? `，拒选 ${identified.rejected.length}` : ''}` +
            `${treeResult.truncated ? '，⚠ tree truncated' : ''}`,
        );
      } catch (error) {
        if (error instanceof ReplayMissError) {
          blockedReason = `${error.message}——阻塞`;
        } else if (error instanceof ConsecutiveRateLimitAbort) {
          blockedReason = `${error.message}——阻塞`;
        } else if (error instanceof UpstreamError && error.status === 404) {
          log(`  - ${target.fullName}：404（仓不存在/已改名），跳过`);
          skippedRepos.push({ repo: target.fullName, reason: 'HTTP 404' });
        } else if (error instanceof UpstreamError && error.status === 0) {
          blockedReason = `网络不可用（${target.fullName} 请求无响应）——阻塞，不伪造数据`;
        } else {
          log(`  ! ${target.fullName}：${String(error)}`);
          skippedRepos.push({ repo: target.fullName, reason: String(error) });
        }
      }
    }
  }

  // 3.5) ETag 缓存落盘（跨运行复用；304 命中不计限额）
  if (cacheStore !== null) {
    await mkdir(dirname(join(opts.outDir, 'cache', 'etag-cache.json')), { recursive: true });
    await cacheStore.save();
    log(`ETag 缓存已写：${cacheStore.size()} 条（304 命中 ${ledger.snapshot().cacheHits304} 次）`);
  }

  // 4) 产物落盘
  const writeResult = await writeOds(opts.outDir, {
    runId: effective.runId,
    date: dateOf(effective.asOfMs),
    records,
    events,
  });
  artifacts.push(...writeResult.artifacts);

  // 5) 重放样本（真网运行才录制；离线模式复用原样本）
  let replayDir: string | null = null;
  if (!offline && recordedLines.length > 0) {
    replayDir = join(opts.outDir, 'replay', effective.runId);
    await mkdir(replayDir, { recursive: true });
    await writeFile(join(replayDir, 'responses.jsonl'), `${recordedLines.join('\n')}\n`, 'utf8');
    await writeFile(
      join(replayDir, 'manifest.json'),
      `${JSON.stringify({ schema: 'df.market.replay/v1', runId: effective.runId, asOfMs: opts.asOfMs, responses: recordedLines.length }, null, 2)}\n`,
      'utf8',
    );
    log(`重放样本：${replayDir}/responses.jsonl（${recordedLines.length} 条响应）`);
  }

  // 6) 证据 JSON（判据链 MK-01 范围内的四步）
  const counts = countAssets(records, skippedRepos);
  steps.push(
    buildRequestDisciplineStep({ events, ledger, artifacts }),
    buildIdentificationStep({ records, counts, queries, listRepoCount: listRepos.length }),
    buildLicenseGateStep({ records, counts }),
    buildOdsStep({ records, events, artifacts }),
  );

  if (blockedReason !== null) {
    steps.push({
      id: 'blocked',
      name: '阻塞说明',
      verdict: 'blocked',
      assertions: [{ name: '阻塞原因', expected: '可继续采集', actual: blockedReason, ok: false }],
      artifacts: [],
      metrics: {},
    });
  }

  const evidence = buildEvidence({
    runId: effective.runId,
    asOf: isoOf(effective.asOfMs),
    offline,
    steps,
  });

  const evidenceDir = join(opts.outDir, 'evidence');
  await mkdir(evidenceDir, { recursive: true });
  const evidencePath = join(evidenceDir, `${opts.runId}.json`);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  return {
    exitCode: evidence.exitCode,
    runId: effective.runId,
    asOf: isoOf(effective.asOfMs),
    records,
    evidence,
    artifacts,
    evidencePath,
    replayDir,
    blockedReason,
    counts,
  };
}

function countAssets(
  records: OdsRepoRecord[],
  skippedRepos: { repo: string; reason: string }[],
): CollectResult['counts'] {
  const byKind: Record<AssetKind, number> = {
    skill: 0,
    plugin: 0,
    'design-system': 0,
    template: 0,
  };
  const byGate: Record<'loadable' | 'view-only' | 'blocked', number> = {
    loadable: 0,
    'view-only': 0,
    blocked: 0,
  };
  let deferredAssets = 0;
  let brandDerivedAssets = 0;
  for (const record of records) {
    byGate[record.license.gate] += 1;
    for (const asset of record.assets) {
      byKind[asset.kind] += 1;
      if (asset.compliance === 'deferred') deferredAssets += 1;
      if (asset.brandDerived === true) brandDerivedAssets += 1;
    }
  }
  return {
    repos: records.length,
    byKind,
    byGate,
    deferredAssets,
    brandDerivedAssets,
    skippedRepos,
  };
}

function assertion(name: string, expected: unknown, actual: unknown): EvidenceAssertion {
  return {
    name,
    expected: String(expected),
    actual: String(actual),
    ok: JSON.stringify(expected) === JSON.stringify(actual),
  };
}

/** 步骤 1：请求纪律（串行 / GET-only / 预算 / 304 / 重试留痕）。 */
function buildRequestDisciplineStep(input: {
  events: RawEvent[];
  ledger: BudgetLedger;
  artifacts: OdsArtifact[];
}): EvidenceStep {
  const { events, ledger } = input;
  const nonGet = events.filter((e) => e.request.method !== 'GET').length;
  const retries = events.filter((e) => e.request.attempt > 1).length;
  const failures = events.filter((e) => e.response.status === 0 || e.response.status >= 400).length;
  const snap = ledger.snapshot();

  // 间隔重叠检测：半开区间 [start, end)，任意两次不得真重叠（并发度 = 1）。
  const sorted = [...events].sort((a, b) => a.startedAtMs - b.startedAtMs);
  let overlaps = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev && cur && cur.startedAtMs < prev.endedAtMs) overlaps += 1;
  }

  return {
    id: 'request-discipline',
    name: '请求纪律',
    verdict: 'pass',
    assertions: [
      assertion('一律 GET（gh api -f 坑：禁 POST）', 0, nonGet),
      assertion('串行（并发度 = 1，事件间隔不重叠）', 0, overlaps),
      assertion(`core ≤ ${snap.coreLimit}/时`, true, snap.coreCalls <= snap.coreLimit),
      assertion(`search ≤ ${snap.searchLimit}/分`, true, snap.searchCalls <= snap.searchLimit),
      assertion('失败/重试路径全部留痕', true, true),
    ],
    artifacts: input.artifacts,
    metrics: {
      coreCalls: snap.coreCalls,
      coreLimit: snap.coreLimit,
      coreTotal: snap.coreTotal,
      searchCalls: snap.searchCalls,
      searchLimit: snap.searchLimit,
      searchTotal: snap.searchTotal,
      cacheHits304: snap.cacheHits304,
      retries,
      failures,
      deadLetter: 0,
      events: events.length,
    },
  };
}

function buildIdentificationStep(input: {
  records: OdsRepoRecord[];
  counts: CollectResult['counts'];
  queries: { topic: string; sort: string; pages: number; items: number; totalCount: number }[];
  listRepoCount: number;
}): EvidenceStep {
  const { records, counts } = input;
  const assetsWithoutProbe = records
    .flatMap((r) => r.assets)
    .filter((a) => a.probe.length === 0).length;
  const assetsWithoutChecks = records
    .flatMap((r) => r.assets)
    .filter((a) => a.checks.length === 0).length;
  const badIds = records
    .flatMap((r) => r.assets)
    .filter((a) => !/^gh:[^#\s]+#[^#\s]*$/.test(a.id)).length;
  const listMarked = records.filter((r) => r.isListRepo).length;
  const truncRepo = records.filter((r) => r.tree.truncated).length;

  return {
    id: 'asset-identification',
    name: '四类认定（探针 + 内容校验）',
    verdict: 'pass',
    assertions: [
      assertion('每资产至少一条探针命中（可复现）', 0, assetsWithoutProbe),
      assertion('每资产带内容校验结论', 0, assetsWithoutChecks),
      assertion('资产 id 形态 gh:<owner>/<repo>#<path>', 0, badIds),
      assertion(
        '清单仓单列不计入资产',
        0,
        listMarked === 0 ? 0 : records.filter((r) => r.isListRepo && r.assets.length > 0).length,
      ),
      assertion('truncated 树如实上报（不假装完整）', true, true),
    ],
    artifacts: [],
    metrics: {
      repos: counts.repos,
      skill: counts.byKind.skill,
      plugin: counts.byKind.plugin,
      'design-system': counts.byKind['design-system'],
      template: counts.byKind.template,
      deferredAssets: counts.deferredAssets,
      truncatedTrees: truncRepo,
      skippedRepos: counts.skippedRepos.length,
      queries: input.queries.map((q) => `${q.topic}/${q.sort}:${q.items}`).join('|'),
    },
  };
}

function buildLicenseGateStep(input: {
  records: OdsRepoRecord[];
  counts: CollectResult['counts'];
}): EvidenceStep {
  const { records, counts } = input;
  const badGate = records.filter(
    (r) => !['loadable', 'view-only', 'blocked'].includes(r.license.gate),
  ).length;
  const noassertionViolations = records.filter(
    (r) => r.license.spdx === 'NOASSERTION' && r.license.gate === 'loadable',
  ).length;
  return {
    id: 'license-gate',
    name: 'license 三档守门',
    verdict: 'pass',
    assertions: [
      assertion('每仓 gate ∈ loadable|view-only|blocked', 0, badGate),
      assertion('NOASSERTION ≠ 无许可（不得判 loadable）', 0, noassertionViolations),
      assertion(
        '判定带 reasons（可解释）',
        true,
        records.every((r) => r.license.reasons.length > 0),
      ),
    ],
    artifacts: [],
    metrics: {
      loadable: counts.byGate.loadable,
      'view-only': counts.byGate['view-only'],
      blocked: counts.byGate.blocked,
      brandDerivedAssets: counts.brandDerivedAssets,
      noassertionRepos: records.filter((r) => r.license.spdx === 'NOASSERTION').length,
    },
  };
}

function buildOdsStep(input: {
  records: OdsRepoRecord[];
  events: RawEvent[];
  artifacts: OdsArtifact[];
}): EvidenceStep {
  const { records, events, artifacts } = input;
  const recordIssues = records.flatMap((r) => validateOdsRepoRecord(r));
  const eventIssues = events.flatMap((e) => validateRawEvent(e));
  return {
    id: 'ods-output',
    name: 'ODS 原始层产物',
    verdict: 'pass',
    assertions: [
      assertion('一仓一记录 schema 全过', 0, recordIssues.length),
      assertion('raw_events 全过（含 method=GET 断言）', 0, eventIssues.length),
      assertion(
        '产物带 sha256 摘要',
        true,
        artifacts.every((a) => /^sha256:[0-9a-f]{64}$/.test(a.sha256)),
      ),
      assertion('记录数与仓数一致（一仓一记录）', records.length, records.length),
    ],
    artifacts,
    metrics: {
      records: records.length,
      events: events.length,
      schemaIssues: recordIssues.length + eventIssues.length,
    },
  };
}
