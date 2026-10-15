/**
 * @dforge/contracts · evidence 命名空间。
 *
 * 验收证据 JSON 字段（对齐《前端验收标准 v1》§4）：
 * `page / level / diff.{bbox,diffPixels,ratio} / artifacts{ref,actual,diff:{sha256,length}} /
 *  humanReview{verdict,reviewer,reason} / exitCode(0/1/2)`。
 *
 * 两族证据共用同一基础形状：
 * - 对照页证据（像素 diff，参照集冻结后由 verify-figma-* 产出）；
 * - 功能证据（本票 verify-daemon 等无参照集门禁：`diff` 退化为零值、`level` 固定 A，
 *   以 `steps` 承载逐项断言明细）。
 * 退出码语义：0=通过 / 1=违规 / 2=阻塞（未实现或前置条件不成立——**2 不是通过**）。
 * 证据落仓库外（`~/df-evidence/<票号>/`）。
 */

/** 判定级别（A=像素级自动断言；B=视觉等价人工复核）。 */
export type EvidenceLevel = 'A' | 'B';

/** 门禁退出码（三态；禁止把 2 当绿）。 */
export type EvidenceExitCode = 0 | 1 | 2;

/** 差异包围盒（px）。 */
export interface EvidenceBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 像素差异统计。 */
export interface EvidenceDiff {
  bbox: EvidenceBBox | null;
  diffPixels: number;
  /** 差异像素率（0–1）。 */
  ratio: number;
}

/** 单份产物的内容寻址引用（sha256 + 字节数）。 */
export interface EvidenceArtifactRef {
  sha256: string;
  length: number;
}

/** 三份产物引用（参照/实际/差异图；功能证据可为 null）。 */
export interface EvidenceArtifacts {
  ref: EvidenceArtifactRef | null;
  actual: EvidenceArtifactRef | null;
  diff: EvidenceArtifactRef | null;
}

/** 人工复核结论。 */
export interface HumanReview {
  verdict: 'pass' | 'fail' | 'pending' | null;
  reviewer: string | null;
  reason: string | null;
}

/** 验收证据 JSON（对照页与功能门禁的公共字段）。 */
export interface EvidenceJson {
  /** 页面/对象标识（功能门禁用门禁名，如 `verify-daemon`）。 */
  page: string;
  level: EvidenceLevel;
  diff: EvidenceDiff;
  artifacts: EvidenceArtifacts;
  humanReview: HumanReview;
  exitCode: EvidenceExitCode;
}

/** 功能断言步骤明细（功能证据的审计单位）。 */
export interface EvidenceStep {
  id: string;
  ok: boolean;
  detail: string;
}

/** 功能证据（无参照集门禁：如 scripts/verify-daemon.mjs）。 */
export interface FunctionalEvidence extends EvidenceJson {
  /** 执行环境与命令等元信息。 */
  meta: Record<string, unknown>;
  steps: EvidenceStep[];
}

/** 构造零值 diff（功能证据用）。 */
export function emptyEvidenceDiff(): EvidenceDiff {
  return { bbox: null, diffPixels: 0, ratio: 0 };
}

/** 构造全空产物引用（功能证据用）。 */
export function emptyEvidenceArtifacts(): EvidenceArtifacts {
  return { ref: null, actual: null, diff: null };
}

/** 构造功能证据骨架（门禁脚本填充 steps 与 exitCode）。 */
export function createFunctionalEvidence(options: {
  page: string;
  exitCode: EvidenceExitCode;
  steps: EvidenceStep[];
  meta?: Record<string, unknown>;
}): FunctionalEvidence {
  return {
    page: options.page,
    level: 'A',
    diff: emptyEvidenceDiff(),
    artifacts: emptyEvidenceArtifacts(),
    humanReview: { verdict: null, reviewer: null, reason: null },
    exitCode: options.exitCode,
    meta: options.meta ?? {},
    steps: options.steps,
  };
}

/** 校验值是否为合法证据 JSON（字段完备性）。 */
export function isEvidenceJson(value: unknown): value is EvidenceJson {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.page !== 'string') return false;
  if (record.level !== 'A' && record.level !== 'B') return false;
  if (record.exitCode !== 0 && record.exitCode !== 1 && record.exitCode !== 2) return false;
  const diff = record.diff as Record<string, unknown> | undefined;
  if (typeof diff !== 'object' || diff === null) return false;
  if (typeof diff.diffPixels !== 'number' || typeof diff.ratio !== 'number') return false;
  if (!('bbox' in diff)) return false;
  const artifacts = record.artifacts as Record<string, unknown> | undefined;
  if (typeof artifacts !== 'object' || artifacts === null) return false;
  if (!('ref' in artifacts) || !('actual' in artifacts) || !('diff' in artifacts)) return false;
  const humanReview = record.humanReview as Record<string, unknown> | undefined;
  if (typeof humanReview !== 'object' || humanReview === null) return false;
  return 'verdict' in humanReview && 'reviewer' in humanReview && 'reason' in humanReview;
}
