/**
 * license 三档守门测试（规格 §7.2 + 研究 #4 §2 实测分布）。
 *
 * 核心口径：**NOASSERTION ≠ 无许可**——前者是「有许可原文但 GitHub 未能识别」，
 * 后者是「默认全保留权利」；两者都不可自动装载，但理由与后续动作不同。
 */

import { describe, expect, it } from 'vitest';

import { assessLicense, detectBrandDerived, PERMISSIVE_SPDX } from './license.ts';

describe('assessLicense 三档守门（规格 §7.2）', () => {
  it('宽松许可（MIT/Apache-2.0/BSD/CC0/Unlicense）+ 有许可原文 → loadable', () => {
    for (const spdx of ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'CC0-1.0', 'Unlicense']) {
      const v = assessLicense({ spdx, hasLicenseFile: true, archived: false, brandDerived: false });
      expect(v.gate, spdx).toBe('loadable');
      expect(v.tier, spdx).toBe('permissive');
      expect(PERMISSIVE_SPDX.has(spdx)).toBe(true);
    }
  });

  it('NOASSERTION → view-only，且理由点明「≠ 无许可」（研究 #4 §2.2 核心发现）', () => {
    const v = assessLicense({
      spdx: 'NOASSERTION',
      hasLicenseFile: true,
      archived: false,
      brandDerived: false,
    });
    expect(v.gate).toBe('view-only');
    expect(v.tier).toBe('noassertion');
    expect(v.reasons.join()).toContain('NOASSERTION');
    expect(v.reasons.join()).toContain('≠无许可');
  });

  it('无 license（null）→ view-only，理由为「默认全保留权利」', () => {
    const v = assessLicense({
      spdx: null,
      hasLicenseFile: false,
      archived: false,
      brandDerived: false,
    });
    expect(v.gate).toBe('view-only');
    expect(v.tier).toBe('none');
    expect(v.reasons.join()).toContain('保留权利');
  });

  it('AGPL-3.0 → view-only（强 copyleft，再分发待法务）', () => {
    const v = assessLicense({
      spdx: 'AGPL-3.0',
      hasLicenseFile: true,
      archived: false,
      brandDerived: false,
    });
    expect(v.gate).toBe('view-only');
    expect(v.tier).toBe('strong-copyleft');
  });

  it('MPL-2.0 / CC-BY-4.0 / BUSL-1.1 → view-only（弱 copyleft 与自定义条款）', () => {
    for (const spdx of ['MPL-2.0', 'CC-BY-4.0', 'BUSL-1.1', 'LGPL-3.0']) {
      const v = assessLicense({ spdx, hasLicenseFile: true, archived: false, brandDerived: false });
      expect(v.gate, spdx).toBe('view-only');
      expect(v.tier, spdx).not.toBe('permissive');
    }
  });

  it('宽松 SPDX 但仓库无许可原文 → view-only（证据缺失不乐观默认）', () => {
    const v = assessLicense({
      spdx: 'MIT',
      hasLicenseFile: false,
      archived: false,
      brandDerived: false,
    });
    expect(v.gate).toBe('view-only');
    expect(v.reasons.join()).toContain('许可原文');
  });

  it('归档仓 → view-only（即使宽松许可；规格 §7.2）', () => {
    const v = assessLicense({
      spdx: 'MIT',
      hasLicenseFile: true,
      archived: true,
      brandDerived: false,
    });
    expect(v.gate).toBe('view-only');
    expect(v.archived).toBe(true);
  });

  it('品牌复刻 / 下架 → blocked（不进市场列表）', () => {
    const brand = assessLicense({
      spdx: 'MIT',
      hasLicenseFile: true,
      archived: false,
      brandDerived: true,
    });
    expect(brand.gate).toBe('blocked');

    const yanked = assessLicense({
      spdx: 'MIT',
      hasLicenseFile: true,
      archived: false,
      brandDerived: false,
      yanked: true,
    });
    expect(yanked.gate).toBe('blocked');
  });

  it('判定携带证据位（spdx 原样 + reasons 可解释）', () => {
    const v = assessLicense({
      spdx: 'NOASSERTION',
      hasLicenseFile: true,
      archived: false,
      brandDerived: false,
      licensePath: 'LICENSE',
    });
    expect(v.spdx).toBe('NOASSERTION');
    expect(v.evidence.path).toBe('LICENSE');
    expect(v.evidence.sha256).toBeNull(); // 正文未取回时如实留空
    expect(v.reasons.length).toBeGreaterThan(0);
  });
});

describe('detectBrandDerived 品牌复刻判定（规格 §2.4）', () => {
  it('`source.type=bundled` → 品牌复刻信号（open-design 种子证据）', () => {
    expect(detectBrandDerived({ name: 'agentic', manifestSourceType: 'bundled' })).toBe(true);
  });

  it('名称等于/前缀命中品牌名 → 品牌复刻', () => {
    expect(detectBrandDerived({ name: 'apple-design-system', manifestSourceType: null })).toBe(
      true,
    );
    expect(detectBrandDerived({ name: 'Bugatti', manifestSourceType: null })).toBe(true);
    expect(detectBrandDerived({ name: 'raycast', manifestSourceType: null })).toBe(true);
  });

  it('反例：普通名称不误判（不做子串匹配，避免 not-apple 之类假阳性）', () => {
    expect(detectBrandDerived({ name: 'not-apple', manifestSourceType: null })).toBe(false);
    expect(detectBrandDerived({ name: 'pineapple', manifestSourceType: null })).toBe(false);
    expect(detectBrandDerived({ name: 'agentic', manifestSourceType: 'curated' })).toBe(false);
    expect(detectBrandDerived({ name: null, manifestSourceType: null })).toBe(false);
  });
});
