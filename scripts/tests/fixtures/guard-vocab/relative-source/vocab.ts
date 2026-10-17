/**
 * 真源夹具（guard-vocab「同包相对导入」判据）：结构与 `packages/contracts/src/market/vocab.ts`
 * 同形（全部登记导出齐全、数组 as const、权重对象字面量），供「层文件用**相对路径**引真源」
 * 的正/负例判读——真源文件自身在同包层树内时，`./vocab.ts` 就是真源，不该判 foreign。
 */
export const MARKET_ASSET_KINDS = ['skill', 'plugin', 'design-system', 'template'] as const;
export type MarketAssetKind = (typeof MARKET_ASSET_KINDS)[number];

export const MARKET_LANES = ['create', 'refine', 'deliver'] as const;
export type MarketLane = (typeof MARKET_LANES)[number];

export const MARKET_LICENSE_GATES = ['loadable', 'view-only', 'blocked'] as const;
export type LicenseGate = (typeof MARKET_LICENSE_GATES)[number];

export const MARKET_COMPLIANCES = ['ok', 'non-compliant', 'deferred'] as const;
export type MarketCompliance = (typeof MARKET_COMPLIANCES)[number];

export const MARKET_SECURITY_LEVELS = ['pass', 'warn', 'fail'] as const;
export type MarketSecurityLevel = (typeof MARKET_SECURITY_LEVELS)[number];

export const MARKET_LICENSE_TIERS = [
  'permissive',
  'noassertion',
  'none',
  'strong-copyleft',
  'weak-copyleft',
  'custom',
] as const;
export type MarketLicenseTier = (typeof MARKET_LICENSE_TIERS)[number];

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
export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

export const MARKET_MODES = [
  'template',
  'design-system',
  'prototype',
  'components',
  'tokens',
  'utility',
  'other',
] as const;
export type MarketMode = (typeof MARKET_MODES)[number];

export const MARKET_QUALITY_DIMENSIONS = [
  'spec',
  'maintenance',
  'docs',
  'security',
  'ecosystem',
] as const;
export type MarketQualityDim = (typeof MARKET_QUALITY_DIMENSIONS)[number];

export const MARKET_QUALITY_WEIGHTS: Readonly<Record<MarketQualityDim, number>> = Object.freeze({
  spec: 0.25,
  maintenance: 0.2,
  docs: 0.2,
  security: 0.2,
  ecosystem: 0.15,
});
