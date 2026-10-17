/**
 * @dforge/contracts · 市场词表单真源（ADR-0004 ③ 收敛 · 修复批次 3）。
 *
 * 为什么单列模块：kind/lane 等词表此前在采集 / 变换 / 评分 / 索引各层重复声明，
 * 层间漂移只能靠人工比对（ADR-0004 ③ 登记的技术债）。本模块是这些词表的**唯一真源**：
 * 规范词表以 `as const` 数组导出、联合类型由数组派生、并配**运行时类型守卫**；
 * 各层只声明「本层关心的子集」——即 import 本模块的数组再 filter/sort，**不得再写字面量**。
 * 机器门禁：`scripts/guard-vocab.mjs`（`pnpm guard:vocab`）静态断言各层无词表字面量声明。
 *
 * 词表口径以 `docs/spec/marketplace-spec-v1.md` 为准（§1.2 资产/§1.4 facets/§5.1 五维/
 * §7.2 license 三档）；词表变动必须走票面（`vocab.test.ts` 是值冻结声明）。
 *
 * 纪律：本包零运行时依赖——本模块只用标准语言特性，不 import 任何运行时模块。
 */

/** 四类资产（kind，《技能市场规格 v1》§1.2/§2）。 */
export const MARKET_ASSET_KINDS = ['skill', 'plugin', 'design-system', 'template'] as const;

/** kind 联合类型（由词表派生，勿另立一份）。 */
export type MarketAssetKind = (typeof MARKET_ASSET_KINDS)[number];

/** 工作泳道（lane，§1.4）。 */
export const MARKET_LANES = ['create', 'refine', 'deliver'] as const;

/** lane 联合类型。 */
export type MarketLane = (typeof MARKET_LANES)[number];

/** license 三档守门（§7.2；工程口径，非法务结论）。 */
export const MARKET_LICENSE_GATES = ['loadable', 'view-only', 'blocked'] as const;

/** license 守门联合类型。 */
export type LicenseGate = (typeof MARKET_LICENSE_GATES)[number];

/** 资产合规结论（§2.2：识别/变换/评分各层共用）。 */
export const MARKET_COMPLIANCES = ['ok', 'non-compliant', 'deferred'] as const;

/** 合规结论联合类型。 */
export type MarketCompliance = (typeof MARKET_COMPLIANCES)[number];

/** 静态安全审计结论（§1.2 `installGate.security`）。 */
export const MARKET_SECURITY_LEVELS = ['pass', 'warn', 'fail'] as const;

/** 安全结论联合类型。 */
export type MarketSecurityLevel = (typeof MARKET_SECURITY_LEVELS)[number];

/** license 细档（§7.2 判定依据；gate 由细档 + 附加条件合成）。 */
export const MARKET_LICENSE_TIERS = [
  'permissive',
  'noassertion',
  'none',
  'strong-copyleft',
  'weak-copyleft',
  'custom',
] as const;

/** license 细档联合类型。 */
export type MarketLicenseTier = (typeof MARKET_LICENSE_TIERS)[number];

/** 资产品类（§1.4：9 场景种子 + 兜底；未知枚举归「其他」）。 */
export const MARKET_CATEGORIES = [
  '网站设计',
  '移动端App',
  '设计系统',
  'Web App',
  'PPT设计',
  '交互原型',
  '品牌设计',
  '图标&插画',
  '视觉海报',
  '其他',
] as const;

/** 品类联合类型。 */
export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

/** 资产形态（§1.4；未知归 other）。 */
export const MARKET_MODES = [
  'template',
  'design-system',
  'prototype',
  'components',
  'tokens',
  'utility',
  'other',
] as const;

/** 形态联合类型。 */
export type MarketMode = (typeof MARKET_MODES)[number];

/** 五维键（§5.1；数组顺序即雷达轴序）。 */
export const MARKET_QUALITY_DIMENSIONS = [
  'spec',
  'maintenance',
  'docs',
  'security',
  'ecosystem',
] as const;

/** 维度键联合类型。 */
export type MarketQualityDim = (typeof MARKET_QUALITY_DIMENSIONS)[number];

/**
 * 五维权重（§5.1 定稿，合计 1.00；`score = Σ(权重 × 维度分)`，两位小数）。
 * 冻结：评分（MK-03）与索引自洽校验（MK-04）必须同源，禁止任一层另抄一份。
 */
export const MARKET_QUALITY_WEIGHTS: Readonly<Record<MarketQualityDim, number>> = Object.freeze({
  spec: 0.25,
  maintenance: 0.2,
  docs: 0.2,
  security: 0.2,
  ecosystem: 0.15,
});

/** 运行时窄化：值是否为四类资产之一。 */
export function isMarketAssetKind(value: unknown): value is MarketAssetKind {
  return typeof value === 'string' && (MARKET_ASSET_KINDS as readonly string[]).includes(value);
}

/** 运行时窄化：值是否为工作泳道之一。 */
export function isMarketLane(value: unknown): value is MarketLane {
  return typeof value === 'string' && (MARKET_LANES as readonly string[]).includes(value);
}

/** 运行时窄化：值是否为 license 三档之一。 */
export function isLicenseGate(value: unknown): value is LicenseGate {
  return typeof value === 'string' && (MARKET_LICENSE_GATES as readonly string[]).includes(value);
}

/** 运行时窄化：值是否为合规结论之一。 */
export function isMarketCompliance(value: unknown): value is MarketCompliance {
  return typeof value === 'string' && (MARKET_COMPLIANCES as readonly string[]).includes(value);
}

/** 运行时窄化：值是否为安全审计结论之一。 */
export function isMarketSecurityLevel(value: unknown): value is MarketSecurityLevel {
  return typeof value === 'string' && (MARKET_SECURITY_LEVELS as readonly string[]).includes(value);
}

/** 运行时窄化：值是否为 license 细档之一。 */
export function isMarketLicenseTier(value: unknown): value is MarketLicenseTier {
  return typeof value === 'string' && (MARKET_LICENSE_TIERS as readonly string[]).includes(value);
}
