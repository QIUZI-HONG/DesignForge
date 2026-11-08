/**
 * @dforge/daemon · 市场装载安装服务（票③ market-load-loop · 简报 §6.2）。
 *
 * 职责：消费装载提案（`POST /market/load-plan`）签发的**一次性 ackToken**，批准后从
 * GitHub raw 按 pinned ref 拉取资产内容、按规格 §1.6 复算 digest 对齐索引、真写
 * `<数据根>/.dfg/market/<kind>/<slug>/` 并回读校验、审计落盘。
 *
 * 安全语义（**等价复刻** MCP 确认桩 `../mcp/stub.ts`，不与其共用存储）：
 * 1. 一次性：token 消费（含过期/失败）后立即失效，重复使用是显式错误态；
 * 2. 短时效：TTL 缺省 `MCP_ACK_TTL_MS` 同族（2 分钟），超时显式 `market_install_ack_expired`；
 * 3. 审计只存哈希：ackToken/参数摘要只以 `sha256:<hex>` 形态落盘（记录形态对齐
 *    `McpAuditRecord`，tool='market.install'，写 `<数据根>/audit/market-install.jsonl`）；
 * 4. 待定提案登记在内存（与桩同口径：不做崩溃恢复，重启即失效——安全侧宁可失效）。
 *
 * digest 口径（简报 §6.2 要求先查清定义后写实）：索引 digest **不是** SKILL.md 单文件哈希，
 * 而是规格 §1.6 的**全文件清单流哈希**（`transform/lineage/digest.ts` computeAssetDigest：
 * 按相对路径字典序拼 `"<相对路径>\0sha256:<文件内容哈希>\0<字节数>\n"` 再取 sha256）。
 * 装载本就要取回**全部**资产文件才能落盘，故本实现直接复算**全量** digest 与索引对齐
 * （无子集近似；daemon 侧转写与 @dforge/ingest 的 computeAssetDigest 由单测互相独立对账，
 * 两处漂移会立刻红）。
 *
 * 凭据口径：与 `services/ingest/src/collect/client.ts:67-85` 同式——`GH_TOKEN`/`GITHUB_TOKEN`
 * 环境变量优先，其次 `gh auth token`（子进程带超时与错误容错，gh 挂起按无凭据处理）；
 * **无凭据 = 结构化 `market_install_source_unavailable`
 * 错误，不静默、不匿名降级**（匿名限速 60 req/h 不可靠，与采集线同一纪律）。
 */

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';

import type {
  DfErrorCode,
  MarketAsset,
  MarketInstallResponse,
  McpAuditDecision,
  McpAuditRecord,
} from '@dforge/contracts';
import { MARKET_ASSET_KINDS, MARKETPLACE_INDEX_SCHEMA, MCP_ACK_TTL_MS } from '@dforge/contracts';

import { appendJsonLine, writeFileAtomic } from '../fs-atomic.ts';
import { resolveWithin } from '../path-safety.ts';

/** 审计工具名（market-install.jsonl 内 market 装载事件的固定标识）。 */
const INSTALL_TOOL = 'market.install';

/** 单文件大小上限（字节；防恶意索引指向超大文件拖垮 daemon）。 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** 单次装载文件数上限（有界资源纪律）。 */
const MAX_FILE_COUNT = 2000;
/** 单次装载总字节上限。 */
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
/**
 * 单次上游 fetch 超时（毫秒；评审 F2）：源仓库挂起（墙/假死连接）不得把装载请求无限吊住——
 * Trees API 与逐文件 raw 下载各自计时，超时按网络失败走 source_unavailable 终态。
 */
const UPSTREAM_FETCH_TIMEOUT_MS = 30_000;

/** 装载安装结果（路由层映射为统一失败信封）。 */
export type MarketInstallResult =
  | { ok: true; response: MarketInstallResponse }
  | { ok: false; code: DfErrorCode; message: string; details?: Record<string, unknown> };

/** 失败变体（fetchAssetFiles 的失败分支精确到此形态，避免调用处二次收窄）。 */
type MarketInstallFailure = Extract<MarketInstallResult, { ok: false }>;

/** 市场装载安装服务接口。 */
export interface MarketInstallService {
  /** 装载提案签发一次性 ackToken（审计落 `decision: 'pending'`）。 */
  issue(input: { assetId: string }): Promise<{
    ackToken: string;
    expiresAt: string;
    auditId: string;
    proposalId: string;
  }>;
  /** 消费 ackToken 并执行真写（拉取 → digest 校验 → 落盘 → 回读 → 审计）。 */
  install(input: { assetId: string; ackToken: string }): Promise<MarketInstallResult>;
}

/** 凭据解析注入点（测试注入占位/空凭据；缺省走生产口径）。 */
export interface MarketInstallCredentials {
  /** 覆盖环境变量（缺省 `process.env`）。 */
  env?: Record<string, string | undefined>;
  /** 覆盖 `gh auth token` 执行器（缺省 spawnSync 真跑）。 */
  ghRunner?: (cmd: string, args: string[]) => { status: number; stdout: string };
}

/**
 * `gh auth token` 子进程超时（毫秒；评审 F3）：gh 挂起（凭证助手假死/网络盘凭证）不得把
 * 装载请求无限吊死——超时后 spawnSync 杀掉子进程并在 result.error 报告，按无凭据口径走
 * source_unavailable 终态。
 */
const GH_TOKEN_TIMEOUT_MS = 5_000;

/** 生产用 `gh auth token` 执行器（与 services/ingest/src/collect/client.ts:86-89 同式）。 */
function defaultGhRunner(): { status: number; stdout: string } {
  const result = spawnSync('gh', ['auth', 'token'], {
    encoding: 'utf8',
    timeout: GH_TOKEN_TIMEOUT_MS,
  });
  // 子进程级失败（超时 ETIMEDOUT / ENOENT 等）：spawnSync 不抛异常而是 result.error——
  // 一律按无凭据口径（status=1、stdout 空）交上层结构化报错，不静默、不重试。
  if (result.error !== undefined) {
    return { status: 1, stdout: '' };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}

/**
 * 解析 GitHub 凭据（与 `services/ingest/src/collect/client.ts:67-85` resolveGitHubToken
 * 同口径：env 优先于 gh；返回 null 表示无凭据 → 上层结构化报错，绝不匿名降级）。
 */
function resolveCredentials(credentials: MarketInstallCredentials | undefined): string | null {
  const env = credentials?.env ?? process.env;
  const envToken = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (envToken !== undefined && envToken.trim() !== '') {
    return envToken.trim();
  }
  const run =
    credentials?.ghRunner ?? ((): { status: number; stdout: string } => defaultGhRunner());
  let result: { status: number; stdout: string };
  try {
    result = run('gh', ['auth', 'token']);
  } catch {
    // 执行器自身抛错（等价子进程失控形态）：同按无凭据口径，不让凭据探测炸掉装载请求
    return null;
  }
  if (result.status === 0 && result.stdout.trim() !== '') {
    return result.stdout.trim();
  }
  return null;
}

/**
 * 规格 §1.6 digest 的 daemon 侧转写（与 transform/lineage/digest.ts computeAssetDigest
 * 同式：相对路径字典序 + `path\0sha256:<hex>\0<size>\n` 清单流）。市场装载单测以
 * @dforge/ingest 的 computeAssetDigest 独立对账——两处不一致会立刻红。
 */
function assetDigestOf(files: readonly { relativePath: string; content: Uint8Array }[]): string {
  const lines = [...files]
    .sort((a, b) =>
      a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
    )
    .map(
      (file) =>
        `${file.relativePath}\0sha256:${createHash('sha256').update(file.content).digest('hex')}\0${
          file.content.byteLength
        }\n`,
    )
    .join('');
  return `sha256:${createHash('sha256').update(lines, 'utf8').digest('hex')}`;
}

/** 单条审计记录（形态对齐 McpAuditRecord；工具名固定 market.install，调用方恒为 user）。 */

interface PendingInstall {
  proposalId: string;
  assetId: string;
  argsDigest: string;
  auditId: string;
  expiresAtMs: number;
  consumed: boolean;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** token 只存哈希（审计可核对、泄露不可回放；与 MCP 桩 tokenHash 同式）。 */
function tokenHash(token: string): string {
  return `sha256:${sha256Hex(token)}`;
}

/** 单条审计记录（形态对齐 McpAuditRecord；工具名固定 market.install，调用方恒为 user）。 */
function auditRecord(input: {
  auditId: string;
  at: string;
  proposalId: string;
  argsDigest: string;
  decision: McpAuditDecision;
  applied: boolean;
  note: string;
}): McpAuditRecord {
  return {
    auditId: input.auditId,
    at: input.at,
    caller: 'user',
    tool: INSTALL_TOOL,
    proposalId: input.proposalId,
    argsDigest: input.argsDigest,
    decision: input.decision,
    applied: input.applied,
    note: input.note,
  };
}

/** Trees API 单条目（本实现只消费 blob 的 path 与 size）。 */
interface TreeEntry {
  path?: unknown;
  type?: unknown;
  size?: unknown;
}

/** 待下载文件（Trees API 清单条目；size 缺省 null 表示清单未提供，退回下载后复检）。 */
interface PendingBlob {
  relativePath: string;
  fullPath: string;
  size: number | null;
}

/** 源仓库文件（相对资产根的路径 + 内容字节）。 */
interface FetchedFile {
  relativePath: string;
  content: Uint8Array;
}

/** 创建市场装载安装服务（auditPath/dataRoot/fetchImpl/now/凭据/资产查找均为注入点）。 */
export function createMarketInstallService(options: {
  auditPath: string;
  /** 数据根（装载落点 `<dataRoot>/.dfg/market/<kind>/<slug>/` 的根）。 */
  dataRoot: string;
  fetchImpl: typeof fetch;
  now?: () => Date;
  ackTtlMs?: number;
  credentials?: MarketInstallCredentials;
  /** 资产查找（token 校验通过后取索引卡片；未命中返回 null → asset_not_found）。 */
  loadAsset: (assetId: string) => Promise<MarketAsset | null>;
  /** 回读读取注入点（测试模拟磁盘读失败；缺省 node readFile）。 */
  readFileImpl?: typeof readFile;
}): MarketInstallService {
  const ackTtlMs = options.ackTtlMs ?? MCP_ACK_TTL_MS;
  const now = options.now ?? ((): Date => new Date());
  const fetchImpl = options.fetchImpl;
  const readFileImpl = options.readFileImpl ?? readFile;
  const pending = new Map<string, PendingInstall>();

  const appendAudit = async (record: McpAuditRecord): Promise<void> => {
    await appendJsonLine(options.auditPath, record, 0o600);
  };

  /** 源不可用（缺凭据/上游 404/限流/树截断——结构化错误，不静默）。 */
  const sourceUnavailable = (
    message: string,
    details: Record<string, unknown>,
  ): MarketInstallFailure => ({
    ok: false,
    code: 'market_install_source_unavailable',
    message,
    details,
  });

  /**
   * 失败终态审计（评审 F4）：**所有**失败终态都留痕——用户已批准（decision 沿用既有
   * 失败形态 'approved'），applied=false + note 带原因码；token/参数只存哈希（既有形态）。
   */
  const auditFailure = async (proposal: PendingInstall, note: string): Promise<void> => {
    await appendAudit(
      auditRecord({
        auditId: proposal.auditId,
        at: now().toISOString(),
        proposalId: proposal.proposalId,
        argsDigest: proposal.argsDigest,
        decision: 'approved',
        applied: false,
        note,
      }),
    );
  };

  /**
   * 拉取资产全部文件：Trees API（pinned ref 清单）→ raw（逐文件内容）。
   * 全量拉取是装载落盘的前提，因此 digest 校验天然是**全量**对齐（无子集近似）。
   */
  const fetchAssetFiles = async (
    asset: MarketAsset,
    token: string,
  ): Promise<{ ok: true; files: FetchedFile[] } | { ok: false; result: MarketInstallFailure }> => {
    const repo = asset.source.repo;
    const ref = asset.source.ref;
    // path 允许空串（评审 F5）：与 services/ingest 索引 schema 的 allowEmpty 语义对齐——
    // path='' 表示**仓根资产**（整仓即资产），仅 repo/ref 必填。
    const assetPath = asset.source.path.replace(/\/+$/, '');
    if (repo.length === 0 || ref.length === 0) {
      return {
        ok: false,
        result: sourceUnavailable('资产源信息不完整（repo/ref 缺失），无法拉取内容', {
          reason: 'source-incomplete',
        }),
      };
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'dforge-daemon-market-install',
    };

    let treeResponse: Response;
    try {
      treeResponse = await fetchImpl(
        `https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`,
        { headers, signal: AbortSignal.timeout(UPSTREAM_FETCH_TIMEOUT_MS) },
      );
    } catch (error) {
      return {
        ok: false,
        result: sourceUnavailable('无法连接源仓库（Trees API）', {
          reason: 'network',
          message: error instanceof Error ? error.message : String(error),
        }),
      };
    }
    if (!treeResponse.ok) {
      return {
        ok: false,
        result: sourceUnavailable(`源仓库文件清单获取失败（HTTP ${String(treeResponse.status)}）`, {
          reason: 'trees',
          status: treeResponse.status,
        }),
      };
    }
    let treeJson: unknown;
    try {
      treeJson = (await treeResponse.json()) as unknown;
    } catch {
      return {
        ok: false,
        result: sourceUnavailable('源仓库文件清单不是合法 JSON', { reason: 'trees-invalid-json' }),
      };
    }
    const treeRecord = typeof treeJson === 'object' && treeJson !== null ? treeJson : {};
    if ((treeRecord as { truncated?: unknown }).truncated === true) {
      return {
        ok: false,
        result: sourceUnavailable('源仓库文件清单被截断（资产过大），拒绝不完整装载', {
          reason: 'tree-truncated',
        }),
      };
    }
    const entries = (treeRecord as { tree?: unknown }).tree;
    if (!Array.isArray(entries)) {
      return {
        ok: false,
        result: sourceUnavailable('源仓库文件清单缺少 tree 数组', { reason: 'tree-invalid' }),
      };
    }
    // 资产根前缀：path=''（仓根资产）取全仓文件；非空则限定在该前缀之下
    const prefix = assetPath.length === 0 ? '' : `${assetPath}/`;
    const blobs: PendingBlob[] = [];
    for (const entry of entries as TreeEntry[]) {
      if (entry.type !== 'blob' || typeof entry.path !== 'string') continue;
      if (!entry.path.startsWith(prefix)) continue;
      const relativePath = entry.path.slice(prefix.length);
      if (relativePath.length === 0) continue;
      blobs.push({
        relativePath,
        fullPath: entry.path,
        size: typeof entry.size === 'number' ? entry.size : null,
      });
    }
    if (blobs.length === 0) {
      return {
        ok: false,
        result: sourceUnavailable('源仓库该路径下没有可装载文件（资产可能已移动或删除）', {
          reason: 'no-files',
          path: assetPath,
        }),
      };
    }
    if (blobs.length > MAX_FILE_COUNT) {
      return {
        ok: false,
        result: sourceUnavailable(`资产文件数超过上限（${String(MAX_FILE_COUNT)}）`, {
          reason: 'too-many-files',
          fileCount: blobs.length,
        }),
      };
    }
    // SKILL.md 必需（简报 §6.2）：skill 类资产没有 SKILL.md 即拒绝装载（结构化，不静默）
    if (asset.kind === 'skill' && !blobs.some((blob) => blob.relativePath === 'SKILL.md')) {
      return {
        ok: false,
        result: sourceUnavailable('skill 资产缺少必需的 SKILL.md（源结构不符）', {
          reason: 'skill-manifest-missing',
        }),
      };
    }

    // 大小预检（评审 F2）：Trees API 清单条目自带 size——超限资产在下载前即终态失败，
    // 不发起任何 raw 请求（防恶意索引把 daemon 拖进大文件下载）。清单未给 size 的条目
    // 退回下载后复检（下方逐文件校验仍是第二道闸）。
    let precheckedTotal = 0;
    for (const blob of blobs) {
      if (blob.size === null) continue;
      if (blob.size > MAX_FILE_BYTES) {
        return {
          ok: false,
          result: sourceUnavailable(`源文件超过单文件上限：${blob.relativePath}`, {
            reason: 'file-too-large',
            path: blob.relativePath,
            bytes: blob.size,
            phase: 'precheck',
          }),
        };
      }
      precheckedTotal += blob.size;
    }
    if (precheckedTotal > MAX_TOTAL_BYTES) {
      return {
        ok: false,
        result: sourceUnavailable('资产总大小超过装载上限', {
          reason: 'total-too-large',
          bytes: precheckedTotal,
          phase: 'precheck',
        }),
      };
    }

    const files: FetchedFile[] = [];
    let totalBytes = 0;
    for (const blob of blobs) {
      let response: Response;
      try {
        response = await fetchImpl(
          `https://raw.githubusercontent.com/${repo}/${ref}/${blob.fullPath}`,
          {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(UPSTREAM_FETCH_TIMEOUT_MS),
          },
        );
      } catch (error) {
        return {
          ok: false,
          result: sourceUnavailable(`无法获取源文件 ${blob.relativePath}`, {
            reason: 'network',
            path: blob.relativePath,
            message: error instanceof Error ? error.message : String(error),
          }),
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          result: sourceUnavailable(
            `源文件获取失败：${blob.relativePath}（HTTP ${String(response.status)}）`,
            { reason: 'raw', status: response.status, path: blob.relativePath },
          ),
        };
      }
      const content = new Uint8Array(await response.arrayBuffer());
      if (content.byteLength > MAX_FILE_BYTES) {
        return {
          ok: false,
          result: sourceUnavailable(`源文件超过单文件上限：${blob.relativePath}`, {
            reason: 'file-too-large',
            path: blob.relativePath,
            bytes: content.byteLength,
          }),
        };
      }
      totalBytes += content.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        return {
          ok: false,
          result: sourceUnavailable('资产总大小超过装载上限', {
            reason: 'total-too-large',
            bytes: totalBytes,
          }),
        };
      }
      files.push({ relativePath: blob.relativePath, content });
    }
    return { ok: true, files };
  };

  return {
    async issue(input: { assetId: string }) {
      const atMs = now().getTime();
      const proposalId = `minst_${randomBytes(6).toString('hex')}`;
      const ackToken = randomBytes(24).toString('hex');
      const auditId = `audit_${randomBytes(6).toString('hex')}`;
      const argsDigest = tokenHash(JSON.stringify({ assetId: input.assetId }));
      const expiresAtMs = atMs + ackTtlMs;
      pending.set(ackToken, {
        proposalId,
        assetId: input.assetId,
        argsDigest,
        auditId,
        expiresAtMs,
        consumed: false,
      });
      await appendAudit(
        auditRecord({
          auditId,
          at: new Date(atMs).toISOString(),
          proposalId,
          argsDigest,
          decision: 'pending',
          applied: false,
          note: '装载提案（dryRun）；ackToken 已签发（仅哈希可审计）',
        }),
      );
      return {
        ackToken,
        expiresAt: new Date(expiresAtMs).toISOString(),
        auditId,
        proposalId,
      };
    },

    async install(input: { assetId: string; ackToken: string }): Promise<MarketInstallResult> {
      const proposal = pending.get(input.ackToken);
      if (proposal === undefined || proposal.consumed || proposal.assetId !== input.assetId) {
        return {
          ok: false,
          code: 'market_install_ack_invalid',
          message: 'ackToken 无效或已被使用（一次性 token 不可复用，且必须与资产绑定）',
        };
      }
      if (now().getTime() > proposal.expiresAtMs) {
        proposal.consumed = true;
        await appendAudit(
          auditRecord({
            auditId: proposal.auditId,
            at: now().toISOString(),
            proposalId: proposal.proposalId,
            argsDigest: proposal.argsDigest,
            decision: 'expired',
            applied: false,
            note: 'ackToken 超时未确认，已失效',
          }),
        );
        return {
          ok: false,
          code: 'market_install_ack_expired',
          message: 'ackToken 已过期（短时效，请重新发起装载提案）',
        };
      }
      // 一次性：合法 token 立即消费（执行失败也不可重放——重装须重新出提案）
      proposal.consumed = true;

      // 资产仍须存在（索引可能在提案后更新/被采集线重建）
      const asset = await options.loadAsset(input.assetId);
      if (asset === null) {
        await auditFailure(
          proposal,
          `装载失败：资产不存在（索引可能已更新；终态 asset_not_found assetId=${input.assetId}）`,
        );
        return {
          ok: false,
          code: 'market_install_asset_not_found',
          message: '资产不存在（索引可能已更新，请重新发起装载提案）',
          details: { assetId: input.assetId },
        };
      }

      // 消费时复查装载闸门（评审 F7）：提案签发后索引可能重建——资产被 yank 或闸门改为
      // 不可装载时，旧 ackToken 不得再消费（写路径前的最后一道策略闸）。
      if (asset.installGate.mode !== 'loadable' || asset.yanked !== null) {
        await auditFailure(
          proposal,
          `装载失败：装载闸门已变化（终态 gate_blocked；mode=${asset.installGate.mode}${
            asset.yanked === null ? '' : '，资产已下架'
          }；assetId=${input.assetId}）`,
        );
        return {
          ok: false,
          code: 'market_install_gate_blocked',
          message: '装载闸门已变化：资产已被下架或不再可装载（请重新发起装载提案）',
          details: {
            assetId: input.assetId,
            mode: asset.installGate.mode,
            ...(asset.yanked === null ? {} : { yanked: true }),
          },
        };
      }

      // 凭据解析（env → gh；无凭据 = 结构化 source_unavailable，不静默、不匿名降级）
      const token = resolveCredentials(options.credentials);
      if (token === null) {
        const result = sourceUnavailable(
          '缺少 GitHub 凭据：请设置 GH_TOKEN（或 GITHUB_TOKEN），或运行 gh auth login 后重试',
          {
            reason: 'credentials-missing',
          },
        );
        await appendAudit(
          auditRecord({
            auditId: proposal.auditId,
            at: now().toISOString(),
            proposalId: proposal.proposalId,
            argsDigest: proposal.argsDigest,
            decision: 'approved',
            applied: false,
            note: `装载失败：${result.message}`,
          }),
        );
        return result;
      }

      // 拉取全量源文件
      const fetched = await fetchAssetFiles(asset, token);
      if (!fetched.ok) {
        await appendAudit(
          auditRecord({
            auditId: proposal.auditId,
            at: now().toISOString(),
            proposalId: proposal.proposalId,
            argsDigest: proposal.argsDigest,
            decision: 'approved',
            applied: false,
            note: `装载失败：${fetched.result.message}`,
          }),
        );
        return fetched.result;
      }

      // digest 对齐（规格 §1.6 全量清单流哈希 vs 索引 digest）：不符即拒，绝不落盘
      const actualDigest = assetDigestOf(fetched.files);
      if (actualDigest !== asset.digest) {
        await appendAudit(
          auditRecord({
            auditId: proposal.auditId,
            at: now().toISOString(),
            proposalId: proposal.proposalId,
            argsDigest: proposal.argsDigest,
            decision: 'approved',
            applied: false,
            note: '装载失败：内容 digest 与索引不符（可能索引损坏或源被篡改）',
          }),
        );
        return {
          ok: false,
          code: 'market_install_digest_mismatch',
          message: '源内容 digest 与索引不符：拒绝装载（未写入任何文件）',
          details: { expected: asset.digest, actual: actualDigest },
        };
      }

      // 落点解析：`<数据根>/.dfg/market/<kind>/<slug>/`；slug（资产名）过白名单，
      // 任何越界/不安全形态都拒绝（防索引投毒写穿数据根）
      if (!(MARKET_ASSET_KINDS as readonly string[]).includes(asset.kind)) {
        await auditFailure(proposal, `装载失败：未知资产类型 ${asset.kind}（终态 target_invalid）`);
        return {
          ok: false,
          code: 'market_install_target_invalid',
          message: `未知资产类型：${asset.kind}`,
          details: { kind: asset.kind },
        };
      }
      const target = await resolveWithin(
        options.dataRoot,
        '.dfg',
        'market',
        asset.kind,
        asset.name,
      );
      if (target === null) {
        await auditFailure(proposal, '装载失败：装载落点不安全（终态 target_invalid，零写入）');
        return {
          ok: false,
          code: 'market_install_target_invalid',
          message: '装载落点不安全（资产名含路径分隔符/越界形态），拒绝写入',
          details: { kind: asset.kind, slug: asset.name },
        };
      }

      // 两阶段单事务（评审 F4）：**先验证后写入**——阶段一对全部文件做路径解析，
      // 任一不安全即终态失败且零写入（写循环中途不再有「半批通过半批被拒」的中间态）；
      // 阶段二拿到全部写点后逐文件原子写。
      const planned: { relativePath: string; destination: string; content: Uint8Array }[] = [];
      for (const file of fetched.files) {
        const destination = await resolveWithin(target, ...file.relativePath.split('/'));
        if (destination === null) {
          await auditFailure(
            proposal,
            `装载失败：源文件路径不安全 ${file.relativePath}（终态 target_invalid，零写入）`,
          );
          return {
            ok: false,
            code: 'market_install_target_invalid',
            message: `源文件路径不安全：${file.relativePath}（预写校验未通过，未写入任何文件）`,
            details: { path: file.relativePath, phase: 'prewrite' },
          };
        }
        planned.push({
          relativePath: file.relativePath,
          destination,
          content: file.content,
        });
      }

      // 阶段二：逐文件原子写（临时文件 + rename）。中途失败 = 写入中断：尽力清理本次
      // 已写文件（删不掉的残留如实记审计），终态失败——残留不由响应谎称「未写入」。
      const writtenPaths: string[] = [];
      const leftoverPaths: string[] = [];
      try {
        for (const item of planned) {
          await writeFileAtomic(item.destination, item.content, 0o644);
          writtenPaths.push(item.relativePath);
        }
      } catch (error) {
        for (const item of planned.slice(0, writtenPaths.length)) {
          try {
            await rm(item.destination, { force: true });
          } catch {
            leftoverPaths.push(item.relativePath);
          }
        }
        const cleanupSummary =
          leftoverPaths.length === 0
            ? `已清理本次全部写入（${String(writtenPaths.length)} 个文件）`
            : `已清理 ${String(writtenPaths.length - leftoverPaths.length)} 个、残留 ${String(leftoverPaths.length)} 个（${leftoverPaths.join('、')}）`;
        await auditFailure(
          proposal,
          `装载失败：写入中断（${error instanceof Error ? error.message : String(error)}）；${cleanupSummary}（终态 write-failed）`,
        );
        return {
          ok: false,
          code: 'internal',
          message: `写入中断：${cleanupSummary}——详见诊断`,
          details: {
            reason: 'write-failed',
            written: writtenPaths.length,
            ...(leftoverPaths.length === 0 ? {} : { leftovers: leftoverPaths }),
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }

      // 写后回读校验：从磁盘重算 digest，必须与索引一致（防半截写/磁盘损坏）
      const readBack: FetchedFile[] = [];
      for (const file of fetched.files) {
        const destination = await resolveWithin(target, ...file.relativePath.split('/'));
        if (destination === null) {
          // 阶段一已验过同一路径：这里失败属异常形态，但文件已在盘上——文案必须如实
          await auditFailure(
            proposal,
            `装载失败：回读路径不安全 ${file.relativePath}（终态 target_invalid；文件已落盘）`,
          );
          return {
            ok: false,
            code: 'market_install_target_invalid',
            message: `回读路径不安全：${file.relativePath}（文件已写入但校验未完成，可能有残留——详见诊断）`,
            details: { path: file.relativePath, phase: 'readback' },
          };
        }
        try {
          readBack.push({
            relativePath: file.relativePath,
            content: new Uint8Array(await readFileImpl(destination)),
          });
        } catch {
          await auditFailure(
            proposal,
            `装载失败：回读失败 ${file.relativePath}（终态 digest_mismatch/readback；文件已落盘）`,
          );
          return {
            ok: false,
            code: 'market_install_digest_mismatch',
            message: `回读失败：${file.relativePath}（文件已写入但校验未通过，可能有残留——详见诊断）`,
            details: { path: file.relativePath, phase: 'readback' },
          };
        }
      }
      const readBackDigest = assetDigestOf(readBack);
      if (readBackDigest !== asset.digest) {
        await appendAudit(
          auditRecord({
            auditId: proposal.auditId,
            at: now().toISOString(),
            proposalId: proposal.proposalId,
            argsDigest: proposal.argsDigest,
            decision: 'approved',
            applied: false,
            note: '装载失败：回读 digest 与索引不符（写入后内容不一致）',
          }),
        );
        return {
          ok: false,
          code: 'market_install_digest_mismatch',
          message: '回读校验失败：落盘内容与索引 digest 不符',
          details: { expected: asset.digest, actual: readBackDigest, phase: 'readback' },
        };
      }

      const loadedAt = now().toISOString();
      const targetPathMarker = `.dfg/market/${asset.kind}/${asset.name}/`;
      await appendAudit(
        auditRecord({
          auditId: proposal.auditId,
          at: loadedAt,
          proposalId: proposal.proposalId,
          argsDigest: proposal.argsDigest,
          decision: 'approved',
          applied: true,
          note: `已装载 ${String(fetched.files.length)} 个文件至 ${targetPathMarker}；digest=${asset.digest}`,
        }),
      );
      return {
        ok: true,
        response: {
          schema: MARKETPLACE_INDEX_SCHEMA,
          assetId: asset.id,
          kind: asset.kind,
          slug: asset.name,
          targetPath: targetPathMarker,
          digest: asset.digest,
          files: fetched.files
            .map((file) => file.relativePath)
            .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
          loadedAt,
          auditId: proposal.auditId,
        },
      };
    },
  };
}
