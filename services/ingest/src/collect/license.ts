/**
 * license 三档守门（规格 §7.2 + 研究 #4 §2 实测）。
 *
 * 三档：
 *  - **可装载 `loadable`**：宽松许可（MIT/Apache-2.0/BSD/CC0/Unlicense 一族）且仓库有许可原文；
 *  - **仅看 `view-only`**：`NOASSERTION`（≠无许可，需人工复核）· 无 license（默认全保留权利）·
 *    强/弱 copyleft · 自定义条款 · 归档仓 · 宽松 SPDX 但许可原文缺失；
 *  - **禁 `blocked`**：下架（yank）· 品牌复刻（brandDerived）。
 *
 * v1 口径说明：`blocked` 只覆盖**机器可判定**的两个触发（下架/品牌复刻）；
 * 「许可明确禁止再分发」类文本判断留人工复核（规格 §7.2 工程口径，非法务结论，§9.4）。
 * 工程侧倾向保守：不确定一律 `view-only`，绝不乐观默认装载。
 */

import type { LicenseAssessment, LicenseEvidence, LicenseGate, LicenseTier } from './types.ts';

/** 宽松许可白名单（规格 §7.2 明列 5 个 + 同族无歧义宽松许可）。 */
export const PERMISSIVE_SPDX: ReadonlySet<string> = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
]);

/** 强 copyleft（再分发义务重，需人工/法务复核）。 */
const STRONG_COPYLEFT = new Set(['AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'SSPL-1.0']);

/** 弱 copyleft（文件级义务，同样不自动装载）。 */
const WEAK_COPYLEFT_PREFIXES = ['LGPL-', 'MPL-', 'EPL-', 'CDDL-'];

/** GPL 系（无后缀/带后缀都归强 copyleft 处理）。 */
const GPL_RE = /^GPL-[23]\.0/;

export interface LicenseInput {
  /** GitHub `license.spdx_id` 原样（null = 无许可）。 */
  spdx: string | null;
  /** Trees 清单中是否定位到许可原文。 */
  hasLicenseFile: boolean;
  archived: boolean;
  brandDerived: boolean;
  yanked?: boolean;
  /** 许可原文路径（Trees 定位结果）。 */
  licensePath?: string | null;
  /** 许可原文 sha256（正文已取回时填入）。 */
  licenseSha256?: string | null;
}

/** 三档守门判定（纯函数：同输入同输出，规格 §4.3 确定性要求）。 */
export function assessLicense(input: LicenseInput): LicenseAssessment {
  const reasons: string[] = [];
  const evidence: LicenseEvidence = {
    path: input.licensePath ?? null,
    sha256: input.licenseSha256 ?? null,
  };

  let tier: LicenseTier;
  const spdx = input.spdx === undefined ? null : input.spdx;

  if (input.yanked === true) {
    reasons.push('已下架（yank）：不进市场列表（规格 §8.2）');
    return {
      spdx,
      tier: 'custom',
      gate: 'blocked',
      reasons,
      evidence,
      brandDerived: input.brandDerived,
      archived: input.archived,
    };
  }
  if (input.brandDerived) {
    reasons.push('品牌复刻（brandDerived）：商标风险，禁止入市（规格 §2.4/§7.2）');
    return {
      spdx,
      tier: 'custom',
      gate: 'blocked',
      reasons,
      evidence,
      brandDerived: true,
      archived: input.archived,
    };
  }

  if (spdx === null) {
    tier = 'none';
    reasons.push('无 license：默认全保留权利，仅可查看不可装载（研究 #4 §2）');
  } else if (spdx === 'NOASSERTION') {
    tier = 'noassertion';
    reasons.push(
      'NOASSERTION（有许可原文但非标准/未被 GitHub 识别）≠无许可：仅可查看，人工复核后可改判（研究 #4 §2.2）',
    );
  } else if (PERMISSIVE_SPDX.has(spdx)) {
    tier = 'permissive';
  } else if (STRONG_COPYLEFT.has(spdx) || GPL_RE.test(spdx)) {
    tier = 'strong-copyleft';
    reasons.push(`${spdx}：强 copyleft，再分发义务需人工/法务复核（规格 §7.2/§9.4）`);
  } else if (WEAK_COPYLEFT_PREFIXES.some((prefix) => spdx.startsWith(prefix))) {
    tier = 'weak-copyleft';
    reasons.push(`${spdx}：copyleft，需人工复核后决定（规格 §7.2）`);
  } else {
    tier = 'custom';
    reasons.push(`${spdx}：自定义/未归类条款，仅可查看（保守处理）`);
  }

  let gate: LicenseGate;
  if (tier === 'permissive') {
    if (!input.hasLicenseFile) {
      gate = 'view-only';
      reasons.push('检出宽松 SPDX 但仓库内未定位到许可原文：证据缺失，不乐观默认装载');
    } else if (input.archived) {
      gate = 'view-only';
      reasons.push('归档仓：仅可查看（规格 §7.2）');
    } else {
      gate = 'loadable';
      reasons.push('宽松许可 + 许可原文在仓：可装载（随包携带许可原文与上游署名）');
    }
  } else {
    gate = 'view-only';
  }

  return {
    spdx,
    tier,
    gate,
    reasons,
    evidence,
    brandDerived: input.brandDerived,
    archived: input.archived,
  };
}

/**
 * 品牌复刻信号（规格 §2.4）：`source.type=bundled`，或名称等于/以「品牌名-」开头。
 * 只做整名与前缀匹配（不做子串）——`not-apple`/`pineapple` 不得误判为品牌复刻
 * （研究 #4 §6.7：误判会把合法资产挡在市场外，代价高于漏判）。
 */
const BRAND_NAMES: ReadonlySet<string> = new Set([
  // open-design 种子实测的品牌复刻名（研究 #4 §4.3）
  'apple',
  'bugatti',
  'binance',
  'raycast',
  'sanity',
  'superhuman',
  'webex',
  // 常见品牌设计语言（工程保守清单，命中即 blocked，需人工复核后可改判）
  'google',
  'microsoft',
  'meta',
  'amazon',
  'netflix',
  'airbnb',
  'spotify',
  'stripe',
  'figma',
  'vercel',
  'shopify',
  'notion',
  'slack',
  'discord',
  'github',
  'adobe',
  'nvidia',
  'tesla',
  'samsung',
  'sony',
  'xiaomi',
  'huawei',
]);

export function detectBrandDerived(input: {
  name: string | null;
  manifestSourceType: string | null;
}): boolean {
  if (input.manifestSourceType === 'bundled') return true;
  if (input.name === null) return false;
  const normalized = input.name.toLowerCase().trim();
  if (BRAND_NAMES.has(normalized)) return true;
  for (const brand of BRAND_NAMES) {
    if (normalized.startsWith(`${brand}-`) || normalized.startsWith(`${brand}_`)) return true;
  }
  return false;
}
