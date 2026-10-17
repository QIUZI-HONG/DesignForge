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

import {
  isLicenseGate,
  isMarketAssetKind,
  isMarketCompliance,
  MARKET_ASSET_KINDS,
  MARKET_COMPLIANCES,
  MARKET_LICENSE_GATES,
} from '@dforge/contracts';

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
    if (!isMarketAssetKind(asset.kind)) missing(issues, 'asset.kind', MARKET_ASSET_KINDS.join('|'));
    if (str(asset.name) === null) missing(issues, 'asset.name', '非空字符串');
    if (asset.compliance !== undefined && !isMarketCompliance(asset.compliance)) {
      missing(issues, 'asset.compliance', MARKET_COMPLIANCES.join('|'));
    }
  }

  const repo = record(root.repo);
  if (repo === null) missing(issues, 'repo', '对象');
  else {
    for (const key of ['repoId', 'stars', 'forks'] as const) {
      if (num(repo[key]) === null) missing(issues, `repo.${key}`, '数字');
    }
    if (str(repo.pushedAt) === null) missing(issues, 'repo.pushedAt', 'ISO8601 字符串');
    // createdAt：采集侧当前未采（允许缺省 → 冷启动只按零采纳判定，见 types.ts 注释）。
    if (repo.createdAt !== undefined && repo.createdAt !== null && str(repo.createdAt) === null)
      missing(issues, 'repo.createdAt', 'ISO8601 字符串或 null');
    if (typeof repo.archived !== 'boolean') missing(issues, 'repo.archived', '布尔');
  }

  const license = record(root.license);
  if (license === null) missing(issues, 'license', '对象');
  else if (!isLicenseGate(license.gate))
    missing(issues, 'license.gate', MARKET_LICENSE_GATES.join('|'));

  const files = record(root.files);
  if (files === null) missing(issues, 'files', '对象');
  else if (!Array.isArray(files.entries)) missing(issues, 'files.entries', '数组（可空）');

  // 文本抽取组：评分的表述性信号全靠它——缺整组、或整组空壳，都要报，不让五维静默塌陷。
  const text = record(root.text);
  if (text === null) {
    issues.push(
      'text 缺失（MK-02 需提供描述性文本抽取：frontmatter/body/readme/manifest/packageJson/mcpJson/changelog；字段值可 null）',
    );
  } else {
    const kind = asset?.kind as AssetKind | undefined;
    const hasAnyText = ['body', 'readme', 'manifest', 'frontmatter'].some(
      (key) => text[key] !== undefined && text[key] !== null,
    );
    if (!hasAnyText) {
      issues.push(
        'text 抽取组为空壳（body/readme/manifest/frontmatter 全 null）——识别规则要求的最低文本未提供，五维会静默塌陷',
      );
    } else if (kind === 'skill' && text.body == null && text.readme == null) {
      issues.push('text.body/readme 均缺失（skill 认定要求正文非空，规格 §2.2）');
    }
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
    createdAt: str(repo.createdAt, true),
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

/** 非有限值一律归 null（可选数值位：无数据，不参与加权）。 */
function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 非有限值一律归 0（必填计数位：按「无采纳/未知计数」保守处理，宁可少判）。 */
function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * 评分入口统一兜底（D4）：把**绕过 `normalizeDwdAsset` 直喂**的脏数值清洗为契约允许的值域。
 *
 * 为什么需要：`scoreBatch` 的调用方理论上都先归一化（NaN 会被 `DwdShapeError` 拦下），
 * 但对抗验证证明直喂 `DwdAsset` 时 NaN 会一路进信号观测值（`maintenance.pushed-at=NaN`、
 * `ecosystem.stars-growth=NaN` …）与扣分理由文本（「增速 NaN」）——JSONL 落盘时 NaN 又会
 * 静默变 null（语义漂移），且人话理由不该出现 NaN。故在**评分入口**统一清洗：
 *   - 数值位：非有限（NaN/±Infinity）→ 可选位归 null（信号不可得）；计数位归 0（保守）；
 *   - 时间位：不可解析的 ISO 字符串由 `daysBetween` 归 null（信号不可得），本函数不改写。
 * 纯函数：返回新对象，不改动调用方输入（`scoreBatch` 幂等：清洗前后结果一致）。
 */
export function sanitizeDwdAsset(input: DwdAsset): DwdAsset {
  return {
    ...input,
    repo: {
      ...input.repo,
      repoId: finiteCount(input.repo.repoId),
      stars: finiteCount(input.repo.stars),
      forks: finiteCount(input.repo.forks),
      commits90d: finiteOrNull(input.repo.commits90d),
    },
    files: {
      truncated: input.files.truncated,
      entries: input.files.entries.map((entry) => ({
        ...entry,
        size: finiteCount(entry.size),
      })),
    },
    trend: {
      stars90dAgo: finiteOrNull(input.trend.stars90dAgo),
      referencedBy: finiteOrNull(input.trend.referencedBy),
    },
  };
}
