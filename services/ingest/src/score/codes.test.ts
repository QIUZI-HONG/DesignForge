/**
 * 原因码与信号码词表稳定性单测（MK-03 · issue 判据「原因码枚举稳定（快照）」）。
 *
 * 纪律（规格 §1.5.2：v1 内只许新增码，不许删/改名）：
 *   - 规格 §5.3 词表明示的码必须逐字在表内；
 *   - 全表以字面量冻结——删码/改名必红，逼一次显式复核；
 *   - `L1` 恒不扣分（delta 0）由实现与边界测试双守。
 */

import { describe, expect, it } from 'vitest';
import { REASON_TEXT, SIGNAL_TEXT, SPEC_VOCABULARY_CODES } from './codes.ts';

describe('REASON_TEXT：扣分码词表（规格 §5.3 冻结）', () => {
  it('规格词表明示码逐字在表内（不许删/改名）', () => {
    for (const code of SPEC_VOCABULARY_CODES) {
      expect(Object.hasOwn(REASON_TEXT, code)).toBe(true);
      expect(REASON_TEXT[code]).toBeTruthy();
    }
  });

  it('全表键序与文案冻结（新增码必须显式改这里并复核）', () => {
    expect(Object.keys(REASON_TEXT)).toEqual([
      'S0',
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
      'M1',
      'M2',
      'M3',
      'M4',
      'M5',
      'M6',
      'M7',
      'D1',
      'D2',
      'D3',
      'D4',
      'D5',
      'X1',
      'X2',
      'X3',
      'X4',
      'E1',
      'E2',
      'E3',
      'L1',
    ]);
    expect(REASON_TEXT.S1).toBe('缺 description');
    expect(REASON_TEXT.M2).toBe('僵尸仓（>540 天且 <50★）');
    expect(REASON_TEXT.L1).toBe('许可档非可装载（不扣分，走守门，§7.2）');
  });

  it('码位分组自洽（S/M/D/X/E/L 前缀与维度对应）', () => {
    const groups: Record<string, number> = { S: 0, M: 0, D: 0, X: 0, E: 0, L: 0 };
    for (const code of Object.keys(REASON_TEXT)) {
      const prefix = code.slice(0, 1);
      expect(Object.hasOwn(groups, prefix)).toBe(true);
      groups[prefix] = (groups[prefix] ?? 0) + 1;
    }
    expect(groups).toEqual({ S: 7, M: 7, D: 5, X: 4, E: 3, L: 1 });
  });
});

describe('SIGNAL_TEXT：信号码词表（每维信号清单冻结）', () => {
  it('22 条信号按维度前缀齐备（spec 6 / maintenance 4 / docs 5 / security 4 / ecosystem 3）', () => {
    const keys = Object.keys(SIGNAL_TEXT);
    expect(keys).toHaveLength(22);
    for (const prefix of ['spec.', 'maintenance.', 'docs.', 'security.', 'ecosystem.']) {
      expect(keys.some((k) => k.startsWith(prefix))).toBe(true);
    }
    expect(SIGNAL_TEXT['ecosystem.stars-growth']).toContain('批内分位');
  });
});
