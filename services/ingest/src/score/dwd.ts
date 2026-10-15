/**
 * DWD 输入归一化与校验（MK-03 对接面）。
 *
 * 立场：评分器**宽松读入、严格必填**——
 *   - 必填齐（asset/repo/license/files 关键字段）→ 归一化成 `DwdAsset`；
 *   - 可选字段（增强信号 / 趋势 / 文本抽取的个别字段）缺失 → 补 null（不参与加权，不扣分）；
 *   - 缺 `text` 抽取组整体 → 报问题（MK-02 必须提供描述性文本抽取，否则五维信号无从判定）；
 *   - `compliance` 缺失 → 归为 `deferred`（如实降置信，绝不默认 `ok` 假装可信）。
 *
 * 规格依据：§4.4（DWD 四表字段摘要）+ §5.2（每维信号所需字段）+ §4.3.2（确定性：字段缺省
 * 一律显式补 null，不用 undefined 遛进计算）。
 */

import type {
  AssetKind,
  Compliance,
  DwdAsset,
  DwdFileEntry,
  DwdLicenseView,
  DwdRepoView,
  DwdTextView,
  DwdTrendView,
  LicenseGate,
} from './types.ts';

/** DWD 记录形状不合约时的错误（附字段路径，便于 MK-02/MK-05 定位）。 */
export class DwdShapeError extends Error {
  /** 问题清单（逐条含字段路径）。 */
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`DWD 记录不合约：${issues.join('；')}`);
    this.name = 'DwdShapeError';
    this.issues = issues;
  }
}

const KINDS: readonly AssetKind[] = ['skill', 'plugin', 'design-system', 'template'];
const GATES: readonly LicenseGate[] = ['loadable', 'view-only', 'blocked'];
const COMPLIANCES: readonly Compliance[] = ['ok', 'non-compliant', 'deferred'];

/** 取对象记录（非对象 → null）。 */
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 取字符串（非字符串 → null；可配空串是否算缺）。 */
function str(value: unknown, allowEmpty = false): string | null {
  if (typeof value !== 'string') return null;
  if (!allowEmpty && value.trim() === '') return null;
  return value;
}

/** 取数字（非数字 → null）。 */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 取字符串数组（非数组/含非字符串项 → 过滤）。 */
function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** 字段路径 + 期望描述组装问题清单。 */
function missing(issues: string[], path: string, expectation: string): void {
  issues.push(`${path} 缺失/非法（期望 ${expectation}）`);
}

/** 校验 DWD 记录；返回问题清单（空数组 = 通过）。 */
export function validateDwdAsset(raw: unknown): string[] {
  const issues: string[] = [];
  const root = record(raw);
  if (root === null) return ['记录不是对象'];

  const asset = record(root.asset);
  if (asset === null) missing(issues, 'asset', '对象');
  else {
    if (str(asset.id) === null) missing(issues, 'asset.id', '非空字符串（gh:owner/repo#path）');
    if (!KINDS.includes(asset.kind as AssetKind)) missing(issues, 'asset.kind', KINDS.join('|'));
    if (str(asset.name) === null) missing(issues, 'asset.name', '非空字符串');
    if (asset.compliance !== undefined && !COMPLIANCES.includes(asset.compliance as Compliance))
      missing(issues, 'asset.compliance', COMPLIANCES.join('|'));
  }

  const repo = record(root.repo);
  if (repo === null) missing(issues, 'repo', '对象');
  else {
    for (const key of ['repoId', 'stars', 'forks'] as const) {
      if (num(repo[key]) === null) missing(issues, `repo.${key}`, '数字');
    }
    for (const key of ['pushedAt', 'createdAt'] as const) {
      if (str(repo[key]) === null) missing(issues, `repo.${key}`, 'ISO8601 字符串');
    }
    if (typeof repo.archived !== 'boolean') missing(issues, 'repo.archived', '布尔');
  }

  const license = record(root.license);
  if (license === null) missing(issues, 'license', '对象');
  else if (!GATES.includes(license.gate as LicenseGate))
    missing(issues, 'license.gate', GATES.join('|'));

  const files = record(root.files);
  if (files === null) missing(issues, 'files', '对象');
  else if (!Array.isArray(files.entries)) missing(issues, 'files.entries', '数组（可空）');

  // 文本抽取组：评分的表述性信号全靠它——缺整组即报，不让五维静默塌陷。
  const text = record(root.text);
  if (text === null) {
    issues.push(
      'text 缺失（MK-02 需提供描述性文本抽取：frontmatter/body/readme/manifest/packageJson/mcpJson/changelog；字段值可 null）',
    );
  }

  return issues;
}

/** 归一化 DWD 记录为 `DwdAsset`（必填缺失即抛 `DwdShapeError`；可选缺失补 null/默认）。 */
export function normalizeDwdAsset(raw: unknown): DwdAsset {
  const issues = validateDwdAsset(raw);
  if (issues.length > 0) throw new DwdShapeError(issues);

  const root = raw as Record<string, unknown>;
  const asset = root.asset as Record<string, unknown>;
  const repo = root.repo as Record<string, unknown>;
  const license = record(root.license) as Record<string, unknown>;
  const files = root.files as Record<string, unknown>;
  const text = record(root.text) ?? {};
  const trend = record(root.trend) ?? {};
  const evidence = record(license.evidence) ?? {};

  const repoView: DwdRepoView = {
    repoId: num(repo.repoId) as number,
    fullName: str(repo.fullName, true) ?? '',
    stars: num(repo.stars) as number,
    forks: num(repo.forks) as number,
    pushedAt: str(repo.pushedAt) as string,
    createdAt: str(repo.createdAt) as string,
    archived: repo.archived === true,
    fork: repo.fork === true,
    upstream: str(repo.upstream, true),
    commits90d: num(repo.commits90d),
    lastReleaseAt: str(repo.lastReleaseAt, true),
  };

  const licenseView: DwdLicenseView = {
    spdx: str(license.spdx, true),
    gate: license.gate as LicenseGate,
    evidence: { path: str(evidence.path, true), sha256: str(evidence.sha256, true) },
  };

  const entries: DwdFileEntry[] = (files.entries as unknown[]).map((item) => {
    const entry = record(item) ?? {};
    return {
      path: str(entry.path) ?? '',
      size: num(entry.size) ?? 0,
      sha256: str(entry.sha256, true) ?? '',
    };
  });

  const textView: DwdTextView = {
    frontmatter: record(text.frontmatter),
    body: str(text.body, true),
    readme: str(text.readme, true),
    manifest: record(text.manifest),
    packageJson: record(text.packageJson),
    mcpJson: record(text.mcpJson),
    changelog: str(text.changelog, true),
  };

  const trendView: DwdTrendView = {
    stars90dAgo: num(trend.stars90dAgo),
    referencedBy: num(trend.referencedBy),
  };

  return {
    asset: {
      id: str(asset.id) as string,
      kind: asset.kind as AssetKind,
      name: str(asset.name) as string,
      ref: str(asset.ref, true) ?? '',
      path: str(asset.path, true) ?? '',
      // 缺失不默认 ok：如实降置信（deferred），绝不假装可信。
      compliance: (asset.compliance as Compliance | undefined) ?? 'deferred',
      capabilitiesDeclared: asset.capabilitiesDeclared === true,
      capabilities: strArray(asset.capabilities),
    },
    repo: repoView,
    license: licenseView,
    files: { truncated: files.truncated === true, entries },
    text: textView,
    trend: trendView,
  };
}
