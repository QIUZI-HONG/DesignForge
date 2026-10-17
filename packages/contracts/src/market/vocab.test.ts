/**
 * 市场词表单真源（vocab.ts）的行为契约测试。
 *
 * 断言口径（先红后绿）：
 *  - **词表值**与《技能市场规格 v1》§1.2/§1.4/§5.1/§7.2 的规格字面一致（独立来源：规格文本，
 *    非「按实现抄一遍」）；词表变动必须走票面，此测试即冻结声明；
 *  - **类型守卫**：放行词表成员、拒绝近似拼写与异类型值（运行时窄化的唯一入口，
 *    各层读取器/校验器用它替代散落的 `includes` 链）。
 */

import { describe, expect, it } from 'vitest';

import {
  isLicenseGate,
  isMarketAssetKind,
  isMarketCompliance,
  isMarketLane,
  isMarketLicenseTier,
  isMarketSecurityLevel,
  MARKET_ASSET_KINDS,
  MARKET_CATEGORIES,
  MARKET_COMPLIANCES,
  MARKET_LANES,
  MARKET_LICENSE_GATES,
  MARKET_LICENSE_TIERS,
  MARKET_MODES,
  MARKET_QUALITY_DIMENSIONS,
  MARKET_QUALITY_WEIGHTS,
  MARKET_SECURITY_LEVELS,
} from './vocab.ts';

describe('vocab · 词表值（规格冻结）', () => {
  it('kind 四类资产（§1.2）', () => {
    expect([...MARKET_ASSET_KINDS]).toEqual(['skill', 'plugin', 'design-system', 'template']);
  });

  it('lane 三泳道（§1.4）', () => {
    expect([...MARKET_LANES]).toEqual(['create', 'refine', 'deliver']);
  });

  it('license 三档守门（§7.2）', () => {
    expect([...MARKET_LICENSE_GATES]).toEqual(['loadable', 'view-only', 'blocked']);
  });

  it('合规结论三值（§2.2）', () => {
    expect([...MARKET_COMPLIANCES]).toEqual(['ok', 'non-compliant', 'deferred']);
  });

  it('安全审计三值（§1.2 installGate.security）', () => {
    expect([...MARKET_SECURITY_LEVELS]).toEqual(['pass', 'warn', 'fail']);
  });

  it('license 细档六值（§7.2 判定依据）', () => {
    expect([...MARKET_LICENSE_TIERS]).toEqual([
      'permissive',
      'noassertion',
      'none',
      'strong-copyleft',
      'weak-copyleft',
      'custom',
    ]);
  });

  it('品类词表（§1.4：9 场景种子 + 兜底「其他」）', () => {
    expect([...MARKET_CATEGORIES]).toEqual([
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
    ]);
  });

  it('形态词表（§1.4：未知归 other）', () => {
    expect([...MARKET_MODES]).toEqual([
      'template',
      'design-system',
      'prototype',
      'components',
      'tokens',
      'utility',
      'other',
    ]);
  });

  it('五维与权重（§5.1：合计 1.00，数组顺序即雷达轴序）', () => {
    expect([...MARKET_QUALITY_DIMENSIONS]).toEqual([
      'spec',
      'maintenance',
      'docs',
      'security',
      'ecosystem',
    ]);
    expect(MARKET_QUALITY_WEIGHTS).toEqual({
      spec: 0.25,
      maintenance: 0.2,
      docs: 0.2,
      security: 0.2,
      ecosystem: 0.15,
    });
  });
});

describe('vocab · 类型守卫', () => {
  it('isMarketAssetKind：成员放行，近似拼写/大小写/异类型拒绝', () => {
    for (const kind of MARKET_ASSET_KINDS) expect(isMarketAssetKind(kind)).toBe(true);
    expect(isMarketAssetKind('design-systems')).toBe(false);
    expect(isMarketAssetKind('Skill')).toBe(false);
    expect(isMarketAssetKind('')).toBe(false);
    expect(isMarketAssetKind(null)).toBe(false);
    expect(isMarketAssetKind(42)).toBe(false);
  });

  it('isMarketLane：成员放行，未知泳道拒绝', () => {
    for (const lane of MARKET_LANES) expect(isMarketLane(lane)).toBe(true);
    expect(isMarketLane('other')).toBe(false);
    expect(isMarketLane('CREATE')).toBe(false);
    expect(isMarketLane(undefined)).toBe(false);
  });

  it('isLicenseGate：三档放行，未知档拒绝', () => {
    for (const gate of MARKET_LICENSE_GATES) expect(isLicenseGate(gate)).toBe(true);
    expect(isLicenseGate('gated')).toBe(false);
    expect(isLicenseGate('view_only')).toBe(false);
    expect(isLicenseGate(null)).toBe(false);
  });

  it('isMarketCompliance / isMarketSecurityLevel / isMarketLicenseTier', () => {
    for (const value of MARKET_COMPLIANCES) expect(isMarketCompliance(value)).toBe(true);
    expect(isMarketCompliance('compliant')).toBe(false);
    for (const value of MARKET_SECURITY_LEVELS) expect(isMarketSecurityLevel(value)).toBe(true);
    expect(isMarketSecurityLevel('warning')).toBe(false);
    for (const value of MARKET_LICENSE_TIERS) expect(isMarketLicenseTier(value)).toBe(true);
    expect(isMarketLicenseTier('copyleft')).toBe(false);
  });
});
