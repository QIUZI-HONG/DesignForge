/**
 * 采集器本地最小契约类型（MK-01）。
 *
 * 归属说明：市场领域契约的正式归属是 `@dforge/contracts`（INF-01 落地）。本文件保留采集器
 * 自身需要的结构类型；**词表类（kind / license 档位）已收敛为契约真源的子集别名**
 * （ADR-0004 ③ 收敛 · 修复批次 3，`@dforge/contracts` 的 `market/vocab.ts`），不再另立字面量。
 *
 * 规格依据：《技能市场规格 v1》§1（ADS 数据模型）/ §2（四类识别）/ §3（采集纪律）/
 * §4.4（四层字段）/ §6.2（证据 JSON 口径，承《前端验收标准 v1》§4）。
 */

import type {
  LicenseGate as ContractLicenseGate,
  MarketAssetKind,
  MarketLicenseTier,
} from '@dforge/contracts';

/** 四类资产（规格 §2；真源 `MARKET_ASSET_KINDS`，本处为别名）。 */
export type AssetKind = MarketAssetKind;

/**
 * 候选发现阶段的归类：四类资产 + 清单仓。
 * 规格 §2.1.4：`awesome/list` 清单仓单列 `list`，不入索引、不参与评分。
 */
export type DiscoveredKind = AssetKind | 'list';

/** license 三档守门（规格 §7.2；真源 `MARKET_LICENSE_GATES`，本处为别名）。 */
export type LicenseGate = ContractLicenseGate;

/** license 细档（判定依据，gate 由细档 + 附加条件合成；真源 `MARKET_LICENSE_TIERS`）。 */
export type LicenseTier = MarketLicenseTier;

/** license 证据（规格 §1.3：`source.license.evidence = {path, sha256}`）。 */
export interface LicenseEvidence {
  /** 许可原文路径（Trees 清单中定位）；无许可文件时为 null。 */
  path: string | null;
  /** 许可原文 sha256（`sha256:<hex>`）；未取回正文时为 null。 */
  sha256: string | null;
}

/** 单仓 license 判定（规格 §7.2 三档 + 研究 #4 §2 实测分布）。 */
export interface LicenseAssessment {
  /** GitHub `license.spdx_id` 原样（可为 null = 无许可，或 `NOASSERTION`）。 */
  spdx: string | null;
  tier: LicenseTier;
  gate: LicenseGate;
  /** 判定理由（守门可解释，进 ODS 与证据 JSON）。 */
  reasons: string[];
  evidence: LicenseEvidence;
  /** 品牌复刻判定（规格 §2.4/§7.2）：true → blocked。 */
  brandDerived: boolean;
  /** 归档仓（规格 §7.2：归档仓 → 仅看）。 */
  archived: boolean;
}

/** Trees API 条目（`git/trees?recursive=1` 的 `tree[]` 子集）。 */
export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  /** blob 的 git 对象 sha（注意：**不是** sha256；§1.6 的 sha256 需正文，MK-02 处理）。 */
  sha: string;
  size?: number;
}

/** 结构探针命中的结构件类别（只认结构，不认 topic）。 */
export type PieceKind =
  | 'skill-doc'
  | 'design-md'
  | 'tokens-file'
  | 'plugin-manifest'
  | 'marketplace-manifest'
  | 'package-json'
  | 'template-manifest'
  /** `manifest.json`：设计系统清单与模板清单的共用文件名，由内容校验分流（规格 §2.4/§2.5）。 */
  | 'manifest-json'
  /** `components.manifest.json`：设计系统组件清单（规格 §2.4 硬门槛的佐证件之一）。 */
  | 'components-manifest'
  | 'preview-dir'
  | 'examples-dir'
  | 'mcp-json';

/** 一条探针命中：结构件类别 + 路径 + 归属的资产根目录。 */
export interface ProbePiece {
  piece: PieceKind;
  path: string;
  /** 资产根目录（仓库根 = `""`）；`.claude-plugin/plugin.json` 归其父目录。 */
  root: string;
}

/** 单条内容校验结论（防纯文件名误报，规格 §2.1.2/§2.4 反例）。 */
export interface ContentCheck {
  /** 规则标识（稳定，可进证据 JSON）。 */
  rule: string;
  ok: boolean;
  detail: string;
}

/** 识别出的资产（ODS 记录内嵌；ADS 卡片字段由 MK-02/MK-04 补齐）。 */
export interface IdentifiedAsset {
  /** 稳定资产标识：`gh:<owner>/<repo>#<资产根相对路径>`（规格 §1.2）。 */
  id: string;
  kind: AssetKind;
  root: string;
  /** 机器名（frontmatter `name` 或目录名规范化）。 */
  name: string;
  version: string | null;
  /** 资产自声明许可（frontmatter/manifest `license` 原样，仅记录，不改守门）。 */
  declaredLicense: string | null;
  /**
   * 规范符合度：`ok` 全过；`non-compliant` 不合规样本（规格 §2.2：可入库但不计规范分）；
   * `deferred` 内容受每仓取回预算限制未全量校验（如实记录，不得假装通过）。
   */
  compliance: 'ok' | 'non-compliant' | 'deferred';
  probe: { piece: PieceKind; path: string }[];
  checks: ContentCheck[];
  /**
   * 资产根文件清单摘要：对该根下全部文件按 `路径\0blobSha\0size\n` 字典序拼接后取 sha256。
   * 注意：**不等于**规格 §1.6 的 `digest`（后者按文件 sha256 计算，MK-02 落 DWD 时产出）；
   * 本字段是 MK-01 层的可复现内容指纹（仅依赖 Trees 单次调用）。
   */
  treeDigest: string;
  /** 能力证据（首版仅 `mcp`：`.mcp.json` 单独出现不升类，只作能力证据）。 */
  capabilities: string[];
  /**
   * 品牌复刻（规格 §2.4/§7.2）：true → 该资产守门 blocked。
   * 资产粒度字段；仓级 license 判定不含此标记（避免一仓一品牌件拖累全仓）。
   */
  brandDerived: boolean;
}

/** 被拒绝的候选（内容校验未过），保留用于证据与调参。 */
export interface RejectedCandidate {
  kind: AssetKind;
  root: string;
  piece: PieceKind;
  path: string;
  reason: string;
}

/**
 * 星标历史水位取数留痕（`trend.stars90dAgo` 的来源与口径，规格 §5.2 生态热度）。
 * `method`：`direct-page` 一页内直接计数 / `binary-search` 二分定位边界页 /
 * `budget-exhausted` 调用预算耗尽（count=null，如实降级不阻塞）/ `skipped` 未发起（含原因）。
 */
export interface StarsHistoryNote {
  method: 'direct-page' | 'binary-search' | 'budget-exhausted' | 'skipped';
  pagesFetched: number;
  reason: string | null;
}

/** 一仓一记录（ODS 层原始 JSONL；含 fetchedAt/etag/digest）。 */
export interface OdsRepoRecord {
  schema: 'df.market.ods.repo/v1';
  runId: string;
  fetchedAt: string;
  repo: {
    id: number;
    fullName: string;
    owner: string;
    name: string;
    defaultBranch: string;
    stars: number;
    forks: number;
    pushedAt: string;
    /** 仓库创建时间（冷启动判定输入）；空串 = 上游未给（如实缺省）。 */
    createdAt: string;
    /**
     * 90 天前星标水位（`trend.stars90dAgo` 的来源，规格 §5.2 星标增速）；
     * null = 未取到/预算耗尽（原因见 starsHistory，绝不臆造）。
     */
    stars90dAgo: number | null;
    /** 水位取数留痕（诚实记录取数方式与页数）。 */
    starsHistory: StarsHistoryNote | null;
    archived: boolean;
    fork: boolean;
    sizeKb: number;
    homepage: string | null;
    description: string | null;
    topics: string[];
  };
  /** 采集时点 commit（40 位 hex，规格 §1.3 `source.ref`）。 */
  ref: string;
  /** 仓库元数据响应的 ETag（增量巡检依据）。 */
  etag: string | null;
  /** 本仓快照摘要：Trees 全路径清单（`路径\0blobSha\0size\n` 字典序）的 sha256。 */
  digest: string;
  tree: { sha: string; truncated: boolean; entryCount: number; etag: string | null };
  license: LicenseAssessment;
  assets: IdentifiedAsset[];
  rejected: RejectedCandidate[];
  /** 清单仓标记（规格 §2.1.4）。 */
  isListRepo: boolean;
  /** 本仓采集期间的 API 请求 URL 清单（与 raw_events 对齐）。 */
  requestUrls: string[];
}

/** 一次 API 往返事件（ODS `raw_events` 每行一条，规格 §4.4）。 */
export interface RawEvent {
  ts: string;
  runId: string;
  request: {
    method: 'GET';
    url: string;
    kind: 'core' | 'search';
    attempt: number;
    /** 是否携带 If-None-Match 条件请求头。 */
    conditional: boolean;
  };
  response: {
    status: number;
    etag: string | null;
    linkNext: string | null;
    bodyDigest: string | null;
    /** 是否计入本规格预算（304 不计，规格 §3.2）。 */
    countedAgainstBudget: boolean;
    quota: { limit: number | null; remaining: number | null; resetAtMs: number | null } | null;
  };
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
}

/** 断言（证据 JSON，承《前端验收标准 v1》§4 同族口径）。 */
export interface EvidenceAssertion {
  name: string;
  expected: string;
  actual: string;
  ok: boolean;
}

/** 判据链一步（MK-01 范围内的环）。 */
export interface EvidenceStep {
  id: string;
  name: string;
  verdict: 'pass' | 'fail' | 'blocked';
  assertions: EvidenceAssertion[];
  artifacts: { path: string; sha256: string; length: number }[];
  metrics: Record<string, number | string | null>;
}

/** 证据 JSON（规格《市场首实现》§6.2 `df.market.evidence/v1`）。 */
export interface Evidence {
  schema: 'df.market.evidence/v1';
  runId: string;
  asOf: string;
  offline: boolean;
  collector: { name: string; version: string };
  steps: EvidenceStep[];
  exitCode: 0 | 1 | 2;
}

/** 仓库元数据（`GET /repos/{owner}/{repo}` 的采集子集）。 */
export interface RepoMeta {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  stars: number;
  forks: number;
  pushedAt: string;
  updatedAt: string;
  /** 仓库创建时间（冷启动 <90 天判定的输入，规格 §5.4）；缺省空串 = 上游未给。 */
  createdAt: string;
  archived: boolean;
  fork: boolean;
  sizeKb: number;
  homepage: string | null;
  description: string | null;
  topics: string[];
  licenseSpdx: string | null;
  licenseName: string | null;
}

/** 退出码语义（规格 §6.1：0 通过 / 1 失败 / 2 阻塞；禁止假绿）。 */
export type ExitCode = 0 | 1 | 2;

/** 候选仓（搜索发现产物，**未经认定**）。 */
export interface Candidate {
  repoId: number;
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  stars: number;
  pushedAt: string;
  defaultBranch: string;
  archived: boolean;
  fork: boolean;
  sizeKb: number;
  homepage: string | null;
  topics: string[];
  licenseSpdx: string | null;
  /** 召回来源（topic × 排序版本），用于复核排名漂移（规格《市场首实现》§2.1）。 */
  discoveredBy: { topic: string; sort: 'stars' | 'updated' }[];
  /** 清单仓标记（规格 §2.1.4：kind=list 单列，不入索引）。 */
  isList: boolean;
}

/** 候选发现的搜索依赖（真实客户端或夹具重放实现同一接口）。 */
export interface CandidateSource {
  /** 按完整 URL 拉搜索页（翻页 URL 来自 Link header，禁手拼）。 */
  searchByUrl(url: string): Promise<{ json: unknown; linkNext: string | null }>;
}
