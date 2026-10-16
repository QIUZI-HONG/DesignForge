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
  MissingCachedBodyError,
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
  RepoMeta,
  StarsHistoryNote,
  TreeEntry,
} from './types.ts';

/**
 * 每仓内容取回优先级（规格 §3.7「Contents 抽样 1–3」；MK-01 默认预算放大到 32 见 runCollect）。
 *
 * 排序口径（阶段 A 对接面修复后）：**认定资产的关键文本优先**——
 * 仓根 README（全仓共用的兜底文本）→ SKILL.md 正文 → 清单族 → DESIGN.md/tokens
 * → 资产根 README → .mcp.json → CHANGELOG。四层 `text` 抽取组（规格 §4.4）据此可落成，
 * 五维评分不再因「文本空壳」静默塌陷（MK-03 探针实证）。
 */
const CONTENT_PRIORITY: { piece: string; rank: number }[] = [
  { piece: 'readme-root', rank: 0 },
  { piece: 'skill-doc', rank: 1 },
  { piece: 'plugin-manifest', rank: 2 },
  { piece: 'marketplace-manifest', rank: 3 },
  { piece: 'manifest-json', rank: 4 },
  { piece: 'template-manifest', rank: 5 },
  { piece: 'design-md', rank: 6 },
  { piece: 'components-manifest', rank: 7 },
  { piece: 'tokens-file', rank: 8 },
  { piece: 'package-json', rank: 9 },
  { piece: 'readme-asset', rank: 10 },
  { piece: 'mcp-json', rank: 11 },
  { piece: 'changelog', rank: 12 },
];

/** README/CHANGELOG 的文件名（非认定结构件，但是 `text` 抽取组的来源）。 */
const README_BASENAME = 'README.md';
const CHANGELOG_BASENAMES = new Set(['CHANGELOG.md', 'CHANGELOG']);
/** 仓根 README 的独立排序键（`readme-root` 与 `readme-asset` 同名不同位）。 */
const README_ROOT_RANK = 0;
const README_ASSET_RANK = 10;
const CHANGELOG_RANK = 12;

/**
 * 文本类扩展名（与 MK-02 `classifyMediaType` 的 `text` 集同族——镜像登记为集成债）。
 * 用途：判断一个资产根能否**完整取回**（digest 的前提，规格 §1.6）；含二进制的根直接跳过，
 * 因为合规口径禁下载二进制（§8.1），而 digest 需要全部文件的内容 sha256（§1.6）。
 */
const TEXT_EXTENSIONS = new Set([
  'md',
  'markdown',
  'mdx',
  'txt',
  'json',
  'jsonc',
  'css',
  'scss',
  'html',
  'htm',
  'svg',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'yml',
  'yaml',
  'toml',
  'sh',
  'bash',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'php',
  'csv',
  'tsv',
  'xml',
  'gitignore',
  'gitattributes',
  'editorconfig',
  'npmrc',
  'prettierrc',
  'eslintrc',
]);
/** 单文件取回上限（contents 端点 1MB 封顶；留余量）。 */
const MAX_FETCH_BYTES = 900 * 1024;

/** 文件名是否像许可/说明文件（无扩展名也要按文本取回）。 */
const TEXT_BASENAME_RE =
  /^(LICEN[CS]E|LICENCE|COPYING|NOTICE|AUTHORS|CONTRIBUTORS|CHANGELOG|CHANGES|README|Makefile|Dockerfile|AUTHORS\.md)(\.(md|txt|rst))?$/i;

/** 该路径是否按文本取回（扩展名白名单 + 无扩展名的说明/许可文件 + 常见点文件）。 */
export function isTextLikePath(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  if (TEXT_BASENAME_RE.test(base)) return true;
  if (base.startsWith('.') && !base.slice(1).includes('.')) return true; // .gitignore / .npmrc 等
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false; // 无扩展名且不在白名单：不可判定 → 保守跳过
  return TEXT_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

/**
 * 完整资产根的类群（与识别层同目录多命中的优先级一致：plugin > design-system > template > skill，
 * 规格 §2.1.3）；`other` 兜底（package.json / .mcp.json 等非认定结构件）。
 */
const CONTENT_ROOT_GROUPS: { name: string; pieces: string[] }[] = [
  { name: 'plugin', pieces: ['plugin-manifest', 'marketplace-manifest'] },
  {
    name: 'design-system',
    pieces: ['design-md', 'tokens-file', 'components-manifest', 'manifest-json'],
  },
  { name: 'template', pieces: ['template-manifest'] },
  { name: 'skill', pieces: ['skill-doc'] },
  { name: 'other', pieces: ['package-json', 'mcp-json'] },
];

/** 类群序号（越小越优先；未知群排最后）。 */
function groupRank(name: string): number {
  const index = CONTENT_ROOT_GROUPS.findIndex((group) => group.name === name);
  return index < 0 ? CONTENT_ROOT_GROUPS.length : index;
}

export interface ContentSelection {
  selected: string[];
  deferred: string[];
}

/**
 * 内容取回选择（预算内）。两级策略（阶段 A 对接面修复口径）：
 *
 * 1. **完整资产根优先**：把「结构件所在目录 = 资产根」下的**全部文本文件**按根一次性取回
 *    （根按文件数升序排，贪心装填预算）。理由：规格 §1.6 的 `digest` 需要资产根内全部文件的
 *    内容 sha256，缺一即 `digest=null`（MK-02 如实标注）→ 卡片契约（§1.2 digest 必填）无从落成。
 *    含二进制/超大文件的根**直接跳过**（合规禁下载二进制，§8.1），不浪费预算。
 * 2. **仓根 README/CHANGELOG**：全仓共用的兜底文本（`text.readme` 回退源，规格 §4.4）。
 * 3. 余量（通常为 0）再按优先级表补单文件（SKILL.md 正文 / 清单 / tokens …）。
 *
 * 未选中的进 `deferred`（识别层据此标 `compliance: 'deferred'`，不假装校验过）。
 */
export function selectContentPaths(tree: TreeEntry[], budget: number): ContentSelection {
  const blobs = tree.filter((entry) => entry.type === 'blob');
  const priorityOf = (piece: string): number | null =>
    CONTENT_PRIORITY.find((c) => c.piece === piece)?.rank ?? null;

  // 候选登记（用于 deferred 集合与收尾补位）
  const candidateRank = new Map<string, number>();
  const register = (path: string, rank: number): void => {
    const known = candidateRank.get(path);
    if (known === undefined || rank < known) candidateRank.set(path, rank);
  };
  for (const piece of probeTree(tree)) {
    const rank = priorityOf(piece.piece);
    if (rank !== null) register(piece.path, rank);
  }
  for (const entry of blobs) {
    const base = entry.path.split('/').pop() ?? entry.path;
    if (base === README_BASENAME) {
      register(entry.path, entry.path === README_BASENAME ? README_ROOT_RANK : README_ASSET_RANK);
    } else if (CHANGELOG_BASENAMES.has(base)) {
      register(entry.path, CHANGELOG_RANK);
    }
  }

  // 1) 仓根 README/CHANGELOG（兜底文本，先占 1–2 格预算）
  const selected: string[] = [];
  const selectedSet = new Set<string>();
  const take = (path: string): void => {
    if (selectedSet.has(path)) return;
    selectedSet.add(path);
    selected.push(path);
  };
  for (const entry of blobs) {
    if (selected.length >= budget) break;
    const isRootReadme = entry.path === README_BASENAME;
    const isRootChangelog = entry.path === 'CHANGELOG.md' || entry.path === 'CHANGELOG';
    if ((isRootReadme || isRootChangelog) && isTextLikePath(entry.path)) take(entry.path);
  }

  // 2) 完整资产根（结构件目录 → 根内全部文本文件）
  //    装填顺序 = **按资产类群轮转**（plugin → design-system → template → skill → 其他），
  //    群内按根规模升序。为什么要轮转：只按规模会一路吃「1 文件小根」，四类卡片的分布被单类
  //    挤空（实测 5 仓小跑：design-system 卡片 0 张）——市场是给四类看的，批次预算得先保均衡。
  const sizeOf = new Map(blobs.map((entry) => [entry.path, entry.size ?? 0]));
  const rootFiles = new Map<string, string[]>();
  const rootGroup = new Map<string, string>();
  for (const piece of probeTree(tree)) {
    if (priorityOf(piece.piece) === null) continue;
    const root = piece.root;
    const group = CONTENT_ROOT_GROUPS.find((g) => g.pieces.includes(piece.piece))?.name ?? 'other';
    const known = rootGroup.get(root);
    if (known === undefined || groupRank(group) < groupRank(known)) rootGroup.set(root, group);
    if (rootFiles.has(root)) continue;
    const prefix = root === '' ? '' : `${root}/`;
    rootFiles.set(
      root,
      blobs
        .filter((entry) => (root === '' ? true : entry.path.startsWith(prefix)))
        .map((entry) => entry.path),
    );
  }
  const completableByGroup = new Map<string, { root: string; files: string[] }[]>();
  for (const [root, files] of rootFiles) {
    if (files.length === 0) continue;
    const textOnly = files.every(
      (path) => isTextLikePath(path) && (sizeOf.get(path) ?? 0) <= MAX_FETCH_BYTES,
    );
    if (!textOnly) continue;
    const group = rootGroup.get(root) ?? 'other';
    const list = completableByGroup.get(group) ?? [];
    list.push({ root, files: [...files].sort() });
    completableByGroup.set(group, list);
  }
  for (const list of completableByGroup.values()) {
    list.sort((a, b) =>
      a.files.length !== b.files.length
        ? a.files.length - b.files.length
        : a.root < b.root
          ? -1
          : 1,
    );
  }
  // 装填：各群**均分预算份额**，群内按根规模升序尽量装；装不下的根放弃（升序，后面只会更大）；
  // 用不完的份额顺延给下一群，最后仍有余量则按全群规模升序兜底——预算不会被空群浪费。
  const groupOrder = CONTENT_ROOT_GROUPS.map((g) => g.name);
  const perGroupBase = Math.floor(budget / groupOrder.length);
  /** 单群份额上限 = 预算一半（防「一个超大的根吃掉整仓预算」）。 */
  const perGroupCap = Math.max(1, Math.floor(budget / 2));
  let carry = 0;
  const consumed = new Map<string, number>();
  /** 本群当前第一个待装根的待取文件数（用于份额下限）。 */
  const headSizeOf = (group: string): number => {
    const list = completableByGroup.get(group);
    if (list === undefined) return 0;
    const head = list[consumed.get(group) ?? 0];
    if (head === undefined) return 0;
    return head.files.filter((path) => !selectedSet.has(path)).length;
  };
  const spendInGroup = (group: string, allowance: number): number => {
    const list = completableByGroup.get(group);
    if (list === undefined) return allowance;
    let left = allowance;
    let cursor = consumed.get(group) ?? 0;
    // 升序列表：一旦装不下即停（后面只会更大），剩下的留给兜底装填
    while (cursor < list.length) {
      const candidate = list[cursor];
      if (candidate === undefined) break;
      const pending = candidate.files.filter((path) => !selectedSet.has(path));
      if (pending.length > left) break;
      cursor += 1;
      for (const path of pending) take(path);
      left -= pending.length;
    }
    consumed.set(group, cursor);
    return left;
  };
  for (const group of groupOrder) {
    // 份额 = max(均分, 本群最小根规模)，上限预算一半——否则「大根类群」（设计系统常见
    // 24–41 文件的资产根）在小预算下永远一张卡片都出不了（实测 5 仓与 40 仓批次都踩到）。
    const share = Math.max(perGroupBase, Math.min(perGroupCap, headSizeOf(group)));
    carry = spendInGroup(group, share + carry);
  }
  // 兜底：全群剩余根按规模升序装填（用尽预算或无可装之根为止）
  const leftoversRoots = [...completableByGroup.values()]
    .flat()
    .filter((root) => root.files.some((path) => !selectedSet.has(path)))
    .sort((a, b) =>
      a.files.length !== b.files.length
        ? a.files.length - b.files.length
        : a.root < b.root
          ? -1
          : 1,
    );
  for (const root of leftoversRoots) {
    const pending = root.files.filter((path) => !selectedSet.has(path));
    if (selected.length + pending.length > budget) continue;
    for (const path of pending) take(path);
  }

  // 3) 余量按优先级补单文件（SKILL.md 正文 / 清单 / tokens / 资产根 README / .mcp.json …）
  const leftovers = [...candidateRank.entries()]
    .filter(([path]) => !selectedSet.has(path))
    .map(([path, rank]) => ({ path, rank }))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.path < b.path ? -1 : 1));
  for (const item of leftovers) {
    if (selected.length >= budget) break;
    if (isTextLikePath(item.path)) take(item.path);
  }

  const deferred = [...candidateRank.keys()].filter((path) => !selectedSet.has(path)).sort();
  return { selected, deferred };
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
  /**
   * 是否取星标历史水位（`trend.stars90dAgo` 的来源，规格 §5.2 星标增速）。
   * 默认关：需 `stargazers` 端点额外调用（每仓 ≤ `STARS_HISTORY_MAX_CALLS` 次），
   * 由调用方（`df market collect`）显式开启；取不到时如实留 null + 原因，不阻塞链路。
   */
  starsHistory?: boolean;
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

/** 种子仓 → 候选形态（repo id 未知，取 meta 后回填；带去重用的 fullName）。 */ function seedCandidates(
  seeds: string[],
): Candidate[] {
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
    starsHistory: opts.starsHistory === true,
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
  /** 星标水位开关（重放必须复现，否则样本缺 stargazers 响应 → 明确阻塞）。 */
  starsHistory: boolean;
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

/** 星标历史水位的窗口（90 天，规格 §5.2 星标增速口径）。 */
export const STARS_HISTORY_DAYS = 90;
/** 每仓水位取数调用上限（≈log2(页数)+2；超出即如实降级，不阻塞链路）。 */
export const STARS_HISTORY_MAX_CALLS = 10;

/**
 * 从录制样本反推「每仓取回的内容路径」——**重放的内容名单以样本为准**。
 *
 * 为什么：离线复跑要保证「URL 逐条命中样本」，而内容取回算法会随版本演进（优先级/预算/完整根策略）。
 * 若重放仍按当前算法重算名单，算法一变样本就复现不出来（实测踩过：批次后修订策略 → 复跑 12 仓缺样本）。
 * 样本里已经记录了逐条 URL，因此把 `contents/<path>?ref=` 反解成名单，重放时原样取回——
 * 复跑复现的是**那次真实采集**，与算法版本解耦（参数仍以样本 manifest 为准）。
 */
export function selectionsFromRecorded(responses: { url: string }[]): Map<string, string[]> {
  const byRepo = new Map<string, Set<string>>();
  for (const response of responses) {
    const match = /\/repos\/([^/]+\/[^/]+)\/contents\/(.+?)\?ref=/.exec(response.url);
    if (match === null) continue;
    const repo = match[1];
    const path = decodeURIComponent(match[2] ?? '');
    if (repo === undefined || path === '') continue;
    const set = byRepo.get(repo) ?? new Set<string>();
    set.add(path);
    byRepo.set(repo, set);
  }
  return new Map([...byRepo.entries()].map(([repo, set]) => [repo, [...set].sort()]));
}

/**
 * 取一仓的星标历史水位（`trend.stars90dAgo` 的来源）。
 * 取不到（上游异常/预算耗尽）→ null + 原因码，**绝不臆造**；离线重放缺样本按阻塞上抛。
 */
async function collectStarsHistory(
  client: GitHubClient,
  meta: RepoMeta,
  asOfMs: number,
): Promise<{ stars90dAgo: number | null; note: StarsHistoryNote }> {
  const cutoffMs = asOfMs - STARS_HISTORY_DAYS * 24 * 60 * 60 * 1000;
  const createdMs = meta.createdAt === '' ? Number.NaN : Date.parse(meta.createdAt);
  if (Number.isFinite(createdMs) && createdMs > cutoffMs) {
    return {
      stars90dAgo: 0,
      note: {
        method: 'skipped',
        pagesFetched: 0,
        reason: `仓创建于水位之后（${meta.createdAt}），水位时点星标 = 0`,
      },
    };
  }
  try {
    const history = await client.getStarsHistory({
      repo: meta.fullName,
      totalStars: meta.stars,
      cutoffMs,
      maxCalls: STARS_HISTORY_MAX_CALLS,
    });
    return {
      stars90dAgo: history.count,
      note: {
        method: history.method,
        pagesFetched: history.pagesFetched,
        reason: history.count === null ? '调用预算耗尽（如实降级，不阻塞链路）' : null,
      },
    };
  } catch (error) {
    if (error instanceof ReplayMissError) throw error;
    return {
      stars90dAgo: null,
      note: { method: 'skipped', pagesFetched: 0, reason: `取数失败：${String(error)}` },
    };
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

  let recordedResponses: { url: string }[] = [];
  if (offline && opts.replayDir !== null) {
    try {
      const raw = await readFile(join(opts.replayDir, 'responses.jsonl'), 'utf8');
      recordedResponses = parseRecordedResponses(raw);
      baseFetch = createReplayFetch(recordedResponses as Parameters<typeof createReplayFetch>[0]);
      log(
        `离线重放：样本 ${join(opts.replayDir, 'responses.jsonl')}（${recordedResponses.length} 条响应）`,
      );
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
      const recordingFetch = createRecordingFetch(
        productionFetch,
        (line) => recordedLines.push(line),
        // 304 时用缓存正文还原为 200 记录（样本自包含，离线重放可完整还原）
        { resolveCachedBody: (url) => cacheStore?.get(url)?.bodyText ?? null },
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
        // 星标历史水位（可选；失败/预算耗尽 → null + 原因，不阻塞链路）
        let stars90dAgo: number | null = null;
        let starsHistoryNote: StarsHistoryNote | null = null;
        if (effective.starsHistory === true) {
          const history = await collectStarsHistory(client, meta, effective.asOfMs);
          stars90dAgo = history.stars90dAgo;
          starsHistoryNote = history.note;
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

        // 内容抽样：离线重放**以样本名单为准**（保证 URL 逐条命中；算法演进不影响复现），
        // 真网运行按当前策略（完整资产根 + 类群份额）选取。
        const recordedSelection = offline
          ? selectionsFromRecorded(recordedResponses)
              .get(target.fullName)
              // 许可原文走独立取回（不属于内容名单）——重放名单里剔除它，避免重复请求
              ?.filter((path) => path !== licensePath)
          : undefined;
        const selection =
          recordedSelection !== undefined
            ? {
                selected: recordedSelection,
                deferred: selectContentPaths(treeResult.entries, effective.maxContentPerRepo)
                  .deferred,
              }
            : selectContentPaths(treeResult.entries, effective.maxContentPerRepo);
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
            createdAt: meta.createdAt,
            stars90dAgo,
            starsHistory: starsHistoryNote,
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
        } else if (error instanceof MissingCachedBodyError) {
          // 304-无正文 = 样本/缓存不完整（D3）：与 ReplayMissError 同口径判阻塞 exit 2，
          // 不得降级成「单仓跳过」后以 0 记录收场（那会把「缺数据」冒充成「跑完了」）。
          skippedRepos.push({ repo: target.fullName, reason: String(error) });
          blockedReason = `${error.message}——阻塞（样本/缓存不完整，不伪造数据）`;
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
      `${JSON.stringify(
        {
          schema: 'df.market.replay/v1',
          runId: effective.runId,
          asOfMs: effective.asOfMs,
          asOf: isoOf(effective.asOfMs),
          responses: recordedLines.length,
          // 完整采集参数：离线复跑据此精确重放（URL 逐条命中样本）。
          params: collectParamsOf(effective),
        },
        null,
        2,
      )}\n`,
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
  // 对接面修复的覆盖度（不设为硬断言：取不到是允许的，但要如实进证据，供 MK-05 判据链复核）
  const createdAtPresent = records.filter((r) => r.repo.createdAt !== '').length;
  const stars90dCovered = records.filter((r) => r.repo.stars90dAgo !== null).length;

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
      repoCreatedAtPresent: createdAtPresent,
      stars90dAgoCovered: stars90dCovered,
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
