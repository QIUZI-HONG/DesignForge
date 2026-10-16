/**
 * 市场索引 schema 校验器（MK-04）——`df.marketplace.index/v1`（规格 §1 逐字段定稿）。
 *
 * 定位：ADS 产物的**入库门**（判据链第 4 环：《市场首实现》§4）。独立成模块（仅依赖契约词表），
 * 供 daemon（§5.3 路由返回 `index-invalid` 判定）、FE-11（消费前自检）、MK-05（跑通判据）
 * 复用；`@dforge/contracts` 的 `parseMarketplaceIndex` 是**消费侧宽容解析**（未知字段忽略、
 * 未知枚举归 other），本模块是**生产侧严格校验**（缺字段/坏格式/计数不自洽必须拦住）——
 * 两者职责互补，不重复实现。
 *
 * 两种模式（规格 §1.5 版本演进规则）：
 * - `strict`（默认）：未知枚举值 = error——用于校验**自己产的**索引；
 * - `forward-compatible`：未知枚举值 = warning（消费方按 §1.5.2「未知枚举归 other、不得报错退出」），
 *   计数自洽、格式、必填等硬规则仍为 error。
 *
 * 校验范围（只认规格字面，不做业务推断）：顶层/资产的必填与类型、枚举词表、digest 与 ref
 * 格式、ISO8601 时刻、id 形态与 source 一致性、counts 三项自洽、blocked 资产不得出现、
 * 重复 id；另记 warning 类问题（未知能力词、tags 超限、score 与加权分不符、双语皆空）。
 *
 * 词表单一真源：kind/品类/泳道/形态/license 三档/安全结论/五维权重的词表真源一律在
 * `@dforge/contracts`（`market/vocab.ts`，ADR-0004 ③ 收敛 · 修复批次 3），本模块只消费
 * 守卫与常量，不另起一套（依赖方向 ingest → contracts 合法）。
 */

import {
  isLicenseGate,
  isMarketAssetKind,
  isMarketLane,
  isMarketSecurityLevel,
  MARKET_ASSET_KINDS,
  MARKET_CATEGORIES,
  MARKET_MODES,
  MARKET_QUALITY_WEIGHTS,
  MARKETPLACE_INDEX_SCHEMA,
} from '@dforge/contracts';

/** 校验问题码（稳定标识，可进证据 JSON 与日志）。 */
export type IndexIssueCode =
  | 'schema-mismatch'
  | 'missing-field'
  | 'invalid-type'
  | 'invalid-enum'
  | 'invalid-format'
  | 'invalid-range'
  | 'invalid-value'
  | 'id-source-mismatch'
  | 'duplicate-id'
  | 'counts-mismatch'
  | 'blocked-present'
  | 'unknown-capability'
  | 'summary-too-long'
  | 'empty-localized'
  | 'tags-overflow'
  | 'score-mismatch';

/** 单条校验问题。 */
export interface IndexValidationIssue {
  code: IndexIssueCode;
  /** JSON 路径（如 `assets[3].digest`），便于定位与证据引用。 */
  path: string;
  message: string;
}

/** 校验结果：`ok` 仅由 errors 决定（warnings 不拦截）。 */
export interface IndexValidationResult {
  ok: boolean;
  errors: IndexValidationIssue[];
  warnings: IndexValidationIssue[];
}

/** 校验模式（见模块头注释）。 */
export interface IndexValidationOptions {
  mode?: 'strict' | 'forward-compatible';
}

/** 契约标识（单一真源在 `@dforge/contracts`，此处仅作本地别名）。 */
export const MARKETPLACE_INDEX_SCHEMA_ID = MARKETPLACE_INDEX_SCHEMA;

/**
 * 五维权重（规格 §5.1；score 自洽性交叉校验用）。
 * 真源 `MARKET_QUALITY_WEIGHTS`（ADR-0004 ③ 收敛）——评分与索引校验共用一份权重。
 */
export const QUALITY_WEIGHTS = MARKET_QUALITY_WEIGHTS;

/** 品类词表（规格 §1.4；真源 `MARKET_CATEGORIES`，未知值归「其他」）。 */
const CATEGORIES = MARKET_CATEGORIES;
/** 资产形态词表（规格 §1.4；真源 `MARKET_MODES`，未知值归 other）。 */
const MODES = MARKET_MODES;
/** 能力白名单（规格 §7.1；`connector:<id>` 另行按前缀匹配）。 */
export const CAPABILITY_WHITELIST = [
  'prompt:inject',
  'fs:read',
  'fs:write',
  'mcp',
  'subprocess',
  'bash',
  'network',
  'comfy:generate',
  'llm:call',
] as const;

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/i;
const HEX256_RE = /^(sha256:)?[0-9a-f]{64}$/i;
/** ISO8601 UTC 或带时区偏移（规格 §1.1「ISO8601 UTC」，容忍偏移写法）。 */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
/** 资产 id 形态：`gh:<owner>/<repo>#<资产根相对路径>`（§1.2；不含 commit）。 */
const ASSET_ID_RE = /^gh:[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*#[^\s]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isLocalizedShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (key !== 'zh-CN' && key !== 'en') return false;
    if (typeof value[key] !== 'string') return false;
  }
  return true;
}

function localizedTexts(localized: Record<string, unknown>): string[] {
  const texts: string[] = [];
  for (const key of ['zh-CN', 'en']) {
    const value = localized[key];
    if (typeof value === 'string' && value.trim().length > 0) texts.push(value);
  }
  return texts;
}

function isCapabilityAllowed(value: string): boolean {
  return (
    (CAPABILITY_WHITELIST as readonly string[]).includes(value) || /^connector:[\w.-]+$/.test(value)
  );
}

/** 收集器（闭包形式，避免嵌套类与 any）。 */
function createCollector(mode: 'strict' | 'forward-compatible') {
  const errors: IndexValidationIssue[] = [];
  const warnings: IndexValidationIssue[] = [];
  const error = (code: IndexIssueCode, path: string, message: string) => {
    errors.push({ code, path, message });
  };
  return {
    errors,
    warnings,
    error,
    warning: (code: IndexIssueCode, path: string, message: string) => {
      warnings.push({ code, path, message });
    },
    /** 未知枚举：严格模式算错，宽松模式降为 warning（§1.5.2）。 */
    unknownEnum: (code: IndexIssueCode, path: string, message: string) => {
      if (mode === 'forward-compatible') {
        warnings.push({ code, path, message });
      } else {
        errors.push({ code, path, message });
      }
    },
  };
}

type Collector = ReturnType<typeof createCollector>;

function requireString(
  collector: Collector,
  value: unknown,
  path: string,
  options: { allowEmpty?: boolean } = {},
): value is string {
  if (typeof value !== 'string') {
    collector.error(
      'invalid-type',
      path,
      `应为字符串（实际 ${value === null ? 'null' : typeof value}）`,
    );
    return false;
  }
  if (options.allowEmpty !== true && value.length === 0) {
    collector.error('invalid-value', path, '不得为空字符串');
    return false;
  }
  return true;
}

function checkIsoTime(collector: Collector, value: unknown, path: string): void {
  if (!requireString(collector, value, path)) return;
  if (!ISO_RE.test(value)) {
    collector.error('invalid-format', path, `应为 ISO8601（含时区）时刻：${value}`);
  }
}

/** 校验双语字段（displayName/summary）；`maxZhLength` 仅对 summary 生效（规格 §1.2「中文 ≤80 字」）。 */
function checkLocalized(
  collector: Collector,
  value: unknown,
  path: string,
  maxZhLength?: number,
): void {
  if (!isLocalizedShape(value)) {
    collector.error('invalid-type', path, '应为 {zh-CN?, en?} 且两键均为字符串');
    return;
  }
  const texts = localizedTexts(value as Record<string, unknown>);
  if (texts.length === 0) {
    collector.warning('empty-localized', path, 'zh-CN 与 en 皆缺（消费方回退机器名）');
  }
  if (maxZhLength !== undefined) {
    const zh = (value as Record<string, unknown>)['zh-CN'];
    if (typeof zh === 'string' && zh.length > maxZhLength) {
      collector.warning('summary-too-long', path, `中文简介 ${zh.length} 字 > ${maxZhLength} 字`);
    }
  }
}

function checkSource(collector: Collector, value: unknown, path: string): void {
  if (!isRecord(value)) {
    collector.error('missing-field', path, '溯源块 source 必填且为对象');
    return;
  }
  const p = (key: string) => `${path}.${key}`;
  if (!requireString(collector, value.repo, p('repo')) || !value.repo.includes('/')) {
    collector.error('invalid-format', p('repo'), '应为 owner/repo 形态');
  }
  const repoId = value.repoId;
  if (typeof repoId !== 'number' || !Number.isFinite(repoId)) {
    collector.error('invalid-type', p('repoId'), '应为数字（GitHub 仓库数据库 id）');
  } else if (!Number.isInteger(repoId) || repoId <= 0) {
    collector.error('invalid-range', p('repoId'), `应为正整数（实际 ${repoId}）`);
  }
  requireString(collector, value.path, p('path'), { allowEmpty: true });
  if (requireString(collector, value.ref, p('ref')) && !COMMIT_RE.test(value.ref)) {
    collector.error(
      'invalid-format',
      p('ref'),
      `应为 40 位 hex commit（实际 ${String(value.ref)}）`,
    );
  }
  checkIsoTime(collector, value.fetchedAt, p('fetchedAt'));

  const license = value.license;
  if (!isRecord(license)) {
    collector.error('missing-field', p('license'), 'license 必填且为对象');
  } else {
    const lp = (key: string) => `${p('license')}.${key}`;
    if (license.spdx !== null && typeof license.spdx !== 'string') {
      collector.error('invalid-type', lp('spdx'), '应为 string 或 null');
    }
    if (!isLicenseGate(license.gate)) {
      collector.unknownEnum(
        'invalid-enum',
        lp('gate'),
        `gate 不在三档词表：${String(license.gate)}`,
      );
    }
    const evidence = license.evidence;
    if (!isRecord(evidence)) {
      collector.error('missing-field', lp('evidence'), 'evidence 必填且为对象');
    } else {
      requireString(collector, evidence.path, `${lp('evidence')}.path`, { allowEmpty: true });
      if (
        requireString(collector, evidence.sha256, `${lp('evidence')}.sha256`, {
          allowEmpty: true,
        }) &&
        !HEX256_RE.test(evidence.sha256)
      ) {
        collector.error(
          'invalid-format',
          `${lp('evidence')}.sha256`,
          '应为 sha256 hex（可带 sha256: 前缀）',
        );
      }
    }
  }

  const stars = value.stars;
  if (typeof stars !== 'number' || !Number.isFinite(stars)) {
    collector.error('invalid-type', p('stars'), '应为数字');
  } else if (stars < 0 || !Number.isInteger(stars)) {
    collector.error('invalid-range', p('stars'), `应为非负整数（实际 ${stars}）`);
  }
  checkIsoTime(collector, value.pushedAt, p('pushedAt'));
  if (typeof value.archived !== 'boolean') {
    collector.error('invalid-type', p('archived'), '应为布尔');
  }
  if (
    value.homepage !== undefined &&
    value.homepage !== null &&
    typeof value.homepage !== 'string'
  ) {
    collector.error('invalid-type', p('homepage'), '应为 string 或 null');
  }
  if (
    value.upstream !== undefined &&
    value.upstream !== null &&
    typeof value.upstream !== 'string'
  ) {
    collector.error('invalid-type', p('upstream'), '应为 string 或 null');
  }
  if (typeof value.brandDerived !== 'boolean') {
    collector.error('invalid-type', p('brandDerived'), '应为布尔');
  }
}

function checkFacets(collector: Collector, value: unknown, path: string): void {
  if (!isRecord(value)) {
    collector.error('missing-field', path, 'facets 必填且为对象');
    return;
  }
  const p = (key: string) => `${path}.${key}`;
  if (!CATEGORIES.includes(value.category as (typeof CATEGORIES)[number])) {
    collector.unknownEnum(
      'invalid-enum',
      p('category'),
      `category 不在词表：${String(value.category)}`,
    );
  }
  if (!isMarketLane(value.lane)) {
    collector.unknownEnum('invalid-enum', p('lane'), `lane 不在词表：${String(value.lane)}`);
  }
  if (value.mode !== null && value.mode !== undefined) {
    if (!MODES.includes(value.mode as (typeof MODES)[number])) {
      collector.unknownEnum('invalid-enum', p('mode'), `mode 不在词表：${String(value.mode)}`);
    }
  }
  if (!isStringArray(value.tags)) {
    collector.error('invalid-type', p('tags'), '应为字符串数组');
  } else if (value.tags.length > 10) {
    collector.warning('tags-overflow', p('tags'), `tags ${value.tags.length} 个 > 10（规格 §1.4）`);
  }
  if (!isStringArray(value.scenes)) {
    collector.error('invalid-type', p('scenes'), '应为字符串数组（可为空数组）');
  }
}

function checkQuality(collector: Collector, value: unknown, path: string): void {
  if (!isRecord(value)) {
    collector.error('missing-field', path, 'quality 必填且为对象');
    return;
  }
  const p = (key: string) => `${path}.${key}`;
  const score = value.score;
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    collector.error('invalid-type', p('score'), '应为数字');
  } else if (score < 0 || score > 1) {
    collector.error('invalid-range', p('score'), `应在 [0,1]（实际 ${score}）`);
  }
  const dims = value.dims;
  if (!isRecord(dims)) {
    collector.error('missing-field', p('dims'), 'dims 必填且为对象（五维）');
    return;
  }
  let weighted = 0;
  let dimsComplete = true;
  for (const [dim, weight] of Object.entries(QUALITY_WEIGHTS)) {
    const dimValue = dims[dim];
    if (typeof dimValue !== 'number' || !Number.isFinite(dimValue)) {
      collector.error('invalid-type', `${p('dims')}.${dim}`, '应为 [0,1] 数字');
      dimsComplete = false;
      continue;
    }
    if (dimValue < 0 || dimValue > 1) {
      collector.error('invalid-range', `${p('dims')}.${dim}`, `应在 [0,1]（实际 ${dimValue}）`);
      dimsComplete = false;
      continue;
    }
    weighted += weight * dimValue;
  }
  // score 自洽（§5.1：score = Σ(权重 × 维度分)，两位小数）——宽容到 0.01，仅记 warning
  if (
    dimsComplete &&
    typeof score === 'number' &&
    Number.isFinite(score) &&
    Math.abs(score - weighted) > 0.01
  ) {
    collector.warning(
      'score-mismatch',
      p('score'),
      `score ${score} 与加权分 ${weighted.toFixed(2)} 不符（§5.1）`,
    );
  }
}

function checkInstallGate(collector: Collector, value: unknown, path: string): void {
  if (!isRecord(value)) {
    collector.error('missing-field', path, 'installGate 必填且为对象');
    return;
  }
  const p = (key: string) => `${path}.${key}`;
  for (const key of ['mode', 'licenseGate'] as const) {
    if (!isLicenseGate(value[key])) {
      collector.unknownEnum('invalid-enum', p(key), `${key} 不在三档词表：${String(value[key])}`);
    }
  }
  if (!isMarketSecurityLevel(value.security)) {
    collector.unknownEnum(
      'invalid-enum',
      p('security'),
      `security 不在词表：${String(value.security)}`,
    );
  }
  if (!isStringArray(value.reasons)) {
    collector.error('invalid-type', p('reasons'), '应为字符串数组');
  }
  if (!isStringArray(value.ackRequired)) {
    collector.error('invalid-type', p('ackRequired'), '应为字符串数组');
  }
}

/** 校验单条资产卡片（规格 §1.2 逐字段 + §1.3 溯源块）。 */
function checkAsset(collector: Collector, value: unknown, index: number): void {
  const base = `assets[${index}]`;
  if (!isRecord(value)) {
    collector.error('invalid-type', base, '资产应为对象');
    return;
  }
  const p = (key: string) => `${base}.${key}`;

  const idOk = requireString(collector, value.id, p('id')) && ASSET_ID_RE.test(value.id as string);
  if (typeof value.id === 'string' && value.id.length > 0 && !ASSET_ID_RE.test(value.id)) {
    collector.error(
      'invalid-format',
      p('id'),
      `id 应为 gh:<owner>/<repo>#<path>（实际 ${value.id}）`,
    );
  }

  if (!isMarketAssetKind(value.kind)) {
    collector.unknownEnum('invalid-enum', p('kind'), `kind 不在四类词表：${String(value.kind)}`);
  }
  requireString(collector, value.name, p('name'));
  checkLocalized(collector, value.displayName, p('displayName'));
  checkLocalized(collector, value.summary, p('summary'), 80);
  if (value.description !== undefined && typeof value.description !== 'string') {
    collector.error('invalid-type', p('description'), '应为字符串');
  }
  if (value.version !== undefined && typeof value.version !== 'string') {
    collector.error('invalid-type', p('version'), '应为字符串');
  }

  checkSource(collector, value.source, p('source'));
  // id 与 source 一致性（§1.2：id = gh:<repo>#<path>；commit 只进 source.ref）
  if (idOk && isRecord(value.source)) {
    const expected = `gh:${String(value.source.repo)}#${String(value.source.path)}`;
    if (value.id !== expected) {
      collector.error(
        'id-source-mismatch',
        p('id'),
        `id 与 source 不一致：期望 ${expected}（实际 ${String(value.id)}）`,
      );
    }
  }

  if (!isStringArray(value.capabilities)) {
    collector.error(
      'invalid-type',
      p('capabilities'),
      '应为字符串数组（未声明时缺省 ["prompt:inject"]）',
    );
  } else {
    for (const capability of value.capabilities) {
      if (!isCapabilityAllowed(capability)) {
        collector.warning(
          'unknown-capability',
          p('capabilities'),
          `能力词表外：${capability}（§7.1）`,
        );
      }
    }
  }

  checkFacets(collector, value.facets, p('facets'));
  checkQuality(collector, value.quality, p('quality'));
  checkInstallGate(collector, value.installGate, p('installGate'));

  if (
    requireString(collector, value.digest, p('digest')) &&
    !DIGEST_RE.test(value.digest as string)
  ) {
    collector.error(
      'invalid-format',
      p('digest'),
      `应为 sha256:<64 hex>（实际 ${String(value.digest)}）`,
    );
  }

  if (value.embeddingRef !== null) {
    collector.error('invalid-value', p('embeddingRef'), 'v1 恒为 null（向量检索圈外，§1.2/§9）');
  }

  if (value.metrics !== undefined) {
    const metrics = value.metrics;
    if (!isRecord(metrics)) {
      collector.error('invalid-type', p('metrics'), '应为对象');
    } else {
      for (const key of ['installs', 'adoptions', 'favorites'] as const) {
        const metric = metrics[key];
        if (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0) {
          collector.error('invalid-range', `${p('metrics')}.${key}`, '应为非负数字');
        }
      }
      if (metrics.lastUsedAt !== null && typeof metrics.lastUsedAt !== 'string') {
        collector.error('invalid-type', `${p('metrics')}.lastUsedAt`, '应为 string 或 null');
      }
    }
  }

  const yanked = value.yanked;
  if (yanked === undefined) {
    collector.error('missing-field', p('yanked'), 'yanked 必填（下架标记，可为 null，§8.2）');
  } else if (yanked !== null) {
    if (!isRecord(yanked)) {
      collector.error('invalid-type', p('yanked'), '应为对象或 null');
    } else {
      requireString(collector, yanked.reason, `${p('yanked')}.reason`);
      checkIsoTime(collector, yanked.at, `${p('yanked')}.at`);
      requireString(collector, yanked.source, `${p('yanked')}.source`);
    }
  }

  // blocked 资产不得出现（§1.1 硬规则）——含 brandDerived / yank 派生情形
  const gate = value.installGate;
  if (isRecord(gate) && gate.mode === 'blocked') {
    collector.error(
      'blocked-present',
      base,
      'installGate.mode=blocked 的资产不得出现在索引（§1.1）',
    );
  }
  if (isRecord(value.source) && value.source.brandDerived === true) {
    collector.error(
      'invalid-value',
      p('source.brandDerived'),
      'brandDerived=true → 必须 blocked 且不进索引（§7.2）',
    );
  }
  if (isRecord(gate) && isRecord(value.source) && isRecord(value.source.license)) {
    const licenseGate = value.source.license.gate;
    if (typeof licenseGate === 'string' && gate.licenseGate !== licenseGate) {
      collector.error(
        'invalid-value',
        p('installGate.licenseGate'),
        `installGate.licenseGate(${String(gate.licenseGate)}) 与 source.license.gate(${licenseGate}) 不一致`,
      );
    }
  }
}

/** 校验 counts 自洽（§1.1：total / byKind / loadable；判据链第 4 环）。 */
function checkCounts(collector: Collector, value: unknown, assets: unknown[]): void {
  if (!isRecord(value)) {
    collector.error('missing-field', 'counts', 'counts 必填且为对象');
    return;
  }
  const total = value.total;
  if (typeof total !== 'number') {
    collector.error('invalid-type', 'counts.total', '应为数字');
  } else if (total !== assets.length) {
    collector.error(
      'counts-mismatch',
      'counts.total',
      `total=${total}，assets 长度=${assets.length}`,
    );
  }
  const byKind = value.byKind;
  if (!isRecord(byKind)) {
    collector.error('missing-field', 'counts.byKind', 'byKind 必填且为对象');
  } else {
    for (const kind of MARKET_ASSET_KINDS) {
      const declared = byKind[kind];
      if (typeof declared !== 'number') {
        collector.error('invalid-type', `counts.byKind.${kind}`, '应为数字');
        continue;
      }
      const actual = assets.filter((item) => isRecord(item) && item.kind === kind).length;
      if (declared !== actual) {
        collector.error(
          'counts-mismatch',
          `counts.byKind.${kind}`,
          `声明 ${declared}，实际 ${actual}`,
        );
      }
    }
  }
  const loadable = value.loadable;
  if (typeof loadable !== 'number') {
    collector.error('invalid-type', 'counts.loadable', '应为数字');
  } else {
    const actual = assets.filter(
      (item) =>
        isRecord(item) && isRecord(item.installGate) && item.installGate.mode === 'loadable',
    ).length;
    if (loadable !== actual) {
      collector.error('counts-mismatch', 'counts.loadable', `声明 ${loadable}，实际 ${actual}`);
    }
  }
}

/**
 * 校验 `df.marketplace.index/v1` 索引（返回全部问题，不抛异常）。
 * 调用方按 `result.ok` 决定通过/拦截；`errors` 为空即合格。
 */
export function validateMarketplaceIndex(
  value: unknown,
  options: IndexValidationOptions = {},
): IndexValidationResult {
  const collector = createCollector(options.mode ?? 'strict');
  if (!isRecord(value)) {
    collector.error('schema-mismatch', '', '索引根必须是 JSON 对象');
    return { ok: false, errors: collector.errors, warnings: collector.warnings };
  }
  if (value.schema !== MARKETPLACE_INDEX_SCHEMA_ID) {
    collector.error(
      'schema-mismatch',
      'schema',
      `契约标识不匹配（期望 ${MARKETPLACE_INDEX_SCHEMA_ID}，实际 ${String(value.schema)}）`,
    );
  }

  if (!('generatedAt' in value)) {
    collector.error('missing-field', 'generatedAt', 'generatedAt 必填（批次时刻，可注入以复现）');
  } else {
    checkIsoTime(collector, value.generatedAt, 'generatedAt');
  }

  const collectorBlock = value.collector;
  if (!isRecord(collectorBlock)) {
    collector.error('missing-field', 'collector', 'collector 必填且为对象');
  } else {
    for (const key of ['name', 'version', 'runId'] as const) {
      requireString(collector, collectorBlock[key], `collector.${key}`);
    }
    checkIsoTime(collector, collectorBlock.odsWatermark, 'collector.odsWatermark');
  }

  const assets = value.assets;
  if (!Array.isArray(assets)) {
    collector.error('missing-field', 'assets', 'assets 必填且为数组');
  } else {
    const seen = new Set<string>();
    assets.forEach((asset, index) => {
      checkAsset(collector, asset, index);
      if (isRecord(asset) && typeof asset.id === 'string') {
        if (seen.has(asset.id)) {
          collector.error('duplicate-id', `assets[${index}].id`, `资产 id 重复：${asset.id}`);
        }
        seen.add(asset.id);
      }
    });
  }

  checkCounts(collector, value.counts, Array.isArray(assets) ? assets : []);

  return {
    ok: collector.errors.length === 0,
    errors: collector.errors,
    warnings: collector.warnings,
  };
}

/** 把校验问题压成单行文本（证据 JSON / 日志用）。 */
export function formatIndexIssues(issues: IndexValidationIssue[]): string[] {
  return issues.map((issue) => `${issue.path || '(root)'}: [${issue.code}] ${issue.message}`);
}
