/**
 * MK-02 规范化与四层仓落盘的类型与常量（ODS 输入口径 + DWD 输出口径）。
 *
 * 归属：本文件是 MK-01 采集器类型的**结构镜像**（只读消费，不改语义）。MK-01 的类型在
 * `services/ingest/src/collect/types.ts`；收尾合并集成 tip 后以 collect 为单一真源，本处
 * 镜像退化为别名。镜像存在的原因：两票并行落地，MK-02 不得阻塞等待。
 *
 * 规格依据：《技能市场规格 v1》§1.2/§1.6（资产与 digest）/§2（识别）/§4.1（目录布局）/
 * §4.3（幂等与可离线复跑）/§4.4（四层字段）。
 */

/** 四类资产（规格 §2）。 */
export type AssetKind = 'skill' | 'plugin' | 'design-system' | 'template';

/** license 三档守门（规格 §7.2）。 */
export type LicenseGate = 'loadable' | 'view-only' | 'blocked';

/** license 细档（判定依据）。 */
export type LicenseTier =
  | 'permissive'
  | 'noassertion'
  | 'none'
  | 'strong-copyleft'
  | 'weak-copyleft'
  | 'custom';

/** 探针命中的结构件类别（规格 §2.1–§2.5）。 */
export type PieceKind =
  | 'skill-doc'
  | 'design-md'
  | 'tokens-file'
  | 'plugin-manifest'
  | 'marketplace-manifest'
  | 'package-json'
  | 'template-manifest'
  | 'manifest-json'
  | 'components-manifest'
  | 'preview-dir'
  | 'examples-dir'
  | 'mcp-json';

/** 单条内容校验结论。 */
export interface ContentCheck {
  rule: string;
  ok: boolean;
  detail: string;
}

/** 识别出的资产（ODS 记录内嵌，规格 §1.2 的采集侧子集）。 */
export interface IdentifiedAsset {
  id: string;
  kind: AssetKind;
  root: string;
  name: string;
  version: string | null;
  declaredLicense: string | null;
  compliance: 'ok' | 'non-compliant' | 'deferred';
  probe: { piece: PieceKind; path: string }[];
  checks: ContentCheck[];
  /** 资产根文件清单摘要（`路径\0gitSha\0size\n` 字典序 sha256；非 §1.6 digest）。 */
  treeDigest: string;
  capabilities: string[];
  brandDerived: boolean;
}

/** 被拒绝的候选（内容校验未过）。 */
export interface RejectedCandidate {
  kind: AssetKind;
  root: string;
  piece: PieceKind;
  path: string;
  reason: string;
}

/** 单仓 license 判定。 */
export interface LicenseAssessment {
  spdx: string | null;
  tier: LicenseTier;
  gate: LicenseGate;
  reasons: string[];
  evidence: { path: string | null; sha256: string | null };
  brandDerived: boolean;
  archived: boolean;
}

/** 一仓一记录（ODS 原始 JSONL，规格 §4.4 + MK-01 补充字段）。 */
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
    /** 仓库创建时间（冷启动判定输入，规格 §5.4）；空串 = 上游未给。 */
    createdAt: string;
    /** 90 天前星标水位（生态维，规格 §5.2）；null = 未取到（原因见 starsHistory）。 */
    stars90dAgo: number | null;
    /** 水位取数留痕（MK-01 阶段 A 对接面字段）。 */
    starsHistory: {
      method: 'direct-page' | 'binary-search' | 'budget-exhausted' | 'skipped';
      pagesFetched: number;
      reason: string | null;
    } | null;
    archived: boolean;
    fork: boolean;
    sizeKb: number;
    homepage: string | null;
    description: string | null;
    topics: string[];
  };
  ref: string;
  etag: string | null;
  digest: string;
  tree: { sha: string; truncated: boolean; entryCount: number; etag: string | null };
  license: LicenseAssessment;
  assets: IdentifiedAsset[];
  rejected: RejectedCandidate[];
  isListRepo: boolean;
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
    conditional: boolean;
  };
  response: {
    status: number;
    etag: string | null;
    linkNext: string | null;
    bodyDigest: string | null;
    countedAgainstBudget: boolean;
    quota: { limit: number | null; remaining: number | null; resetAtMs: number | null } | null;
  };
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
}

/** Trees API 条目（`git/trees?recursive=1` 的 `tree[]` 子集）。 */
export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

/** 文件清单条目（规格 §4.1 `raw_snapshots` 的「文件级 sha256」）。 */
export interface OdsFileEntry {
  /** 仓库内相对路径。 */
  path: string;
  /** git blob sha（Trees API 原样；始终可得）。 */
  gitSha: string;
  /** 字节数（Trees API 原样；可能缺失）。 */
  size: number | null;
  /** 正文 sha256（仅当正文被采集进 blobs 时可得，否则 null——不臆造）。 */
  sha256: string | null;
  /** 正文内容寻址引用（`sha256:<hex>`），未采集为 null。 */
  blobRef: string | null;
  mediaType: 'text' | 'binary' | 'unknown';
}

/** 一仓一 commit 的 ODS 快照（规格 §4.1 `raw_snapshots/<owner>__<repo>/<commit>/files.json`）。 */
export interface OdsRepoFilesSnapshot {
  schema: 'df.market.ods.files/v1';
  runId: string;
  fetchedAt: string;
  repoId: number;
  fullName: string;
  ref: string;
  etag: string | null;
  /** 本仓采集窗口内 API 配额余量下限（规格 §4.4：配额留痕）。 */
  apiQuotaLeft: number | null;
  isListRepo: boolean;
  tree: { sha: string; truncated: boolean; entryCount: number; listingDigest: string };
  files: OdsFileEntry[];
  /** 采集侧一仓一记录（原样内嵌；DWD 的识别依据）。 */
  record: OdsRepoRecord;
  /** 本快照（不含本字段）规范序列化的 sha256。 */
  snapshotDigest: string;
}

/** 校验问题（路径 + 稳定规则码 + 明细）。 */
export interface OdsValidationIssue {
  path: string;
  rule: string;
  detail: string;
}

/** 来源文件清单（溯源链：MK-01 产物 → 本票产物）。 */
export interface OdsSourceFile {
  path: string;
  kind: 'raw_snapshots' | 'raw_events' | 'replay';
  sha256: string;
  length: number;
  lineCount: number | null;
}

/** `sha256:<64hex>` 形态。 */
export const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
