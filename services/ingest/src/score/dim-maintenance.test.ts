/**
 * 维护活跃度（`maintenance`，权重 .20）单测（MK-03）。
 *
 * 断言口径来自规格 §5.2「维护活跃度」（90 天提交数 / release 距今 / CI 存在性 /
 * `pushed_at` 新鲜度；issue 响应中位数与提交数为 v1+ 增强信号，无数据不参与加权）、
 * §5.4（归档仓封顶 ≤0.3）与 §5.3 扣分码（M1/M2 + 扩展 M3–M7）。
 */

import { describe, expect, it } from 'vitest';
import { AS_OF, daysAgo, makeDwd } from './__fixtures__/dwd.ts';
import { scoreMaintenance } from './dim-maintenance.ts';
import type { DimensionResult } from './types.ts';

/** 按码取信号。 */
function signal(result: DimensionResult, code: string) {
  const found = result.signals.find((s) => s.code === code);
  if (found === undefined) throw new Error(`缺信号：${code}`);
  return found;
}

/** 扣分码序列。 */
function codes(result: DimensionResult): string[] {
  return result.deductions.map((d) => d.code);
}

/** 记账不变量（封顶/夹紧项除外，见各用例单独断言）。 */
function expectLossInvariant(result: DimensionResult): void {
  const lost = result.deductions.reduce((sum, d) => sum + d.delta, 0);
  expect(Math.abs(lost - (1 - (result.score ?? 0)))).toBeLessThan(1e-3);
}

describe('scoreMaintenance：健康仓（规格 §5.2 全信号满足）', () => {
  it('四条信号齐、分值 1.00、无扣分', () => {
    const result = scoreMaintenance(makeDwd(), AS_OF);
    expect(result.signals.map((s) => s.code)).toEqual([
      'maintenance.pushed-at',
      'maintenance.ci',
      'maintenance.commits-90d',
      'maintenance.last-release',
    ]);
    expect(result.score).toBe(1);
    expect(result.deductions).toEqual([]);
    expectLossInvariant(result);
  });

  it('v1 无增强信号（提交数/发布无数据）→ 不参与加权、不扣分', () => {
    const result = scoreMaintenance(
      makeDwd({ repo: { commits90d: null, lastReleaseAt: null } }),
      AS_OF,
    );
    expect(signal(result, 'maintenance.commits-90d').score).toBeNull();
    expect(signal(result, 'maintenance.last-release').score).toBeNull();
    expect(result.score).toBe(1);
    expect(result.deductions).toEqual([]);
  });
});

describe('scoreMaintenance：pushed_at 新鲜度梯度（规格 §5.2）', () => {
  it('91–365 天：半分 + M3', () => {
    const result = scoreMaintenance(makeDwd({ repo: { pushedAt: daysAgo(200) } }), AS_OF);
    expect(signal(result, 'maintenance.pushed-at').score).toBe(0.5);
    expect(codes(result)).toEqual(['M3']);
    expect(result.score).toBe(0.8); // 1 − .40×.5
    expectLossInvariant(result);
  });

  it('>365 天：0 分 + M1', () => {
    const result = scoreMaintenance(makeDwd({ repo: { pushedAt: daysAgo(400) } }), AS_OF);
    expect(codes(result)).toEqual(['M1']);
    expect(result.score).toBe(0.6); // 1 − .40
    expectLossInvariant(result);
  });

  it('恰在 90 天边界：不扣分', () => {
    const result = scoreMaintenance(makeDwd({ repo: { pushedAt: daysAgo(90) } }), AS_OF);
    expect(result.score).toBe(1);
    expect(result.deductions).toEqual([]);
  });
});

describe('scoreMaintenance：CI / 提交数 / 发布（规格 §5.2）', () => {
  it('无 CI → M4，分值 0.65', () => {
    const result = scoreMaintenance(
      makeDwd({
        files: {
          truncated: false,
          entries: [{ path: 'SKILL.md', size: 1, sha256: 'f'.repeat(64) }],
        },
      }),
      AS_OF,
    );
    expect(codes(result)).toEqual(['M4']);
    expect(result.score).toBe(0.65); // 1 − .35
    expectLossInvariant(result);
  });

  it('Trees 截断时无 CI 不可证明 → 该信号不可得、不扣分', () => {
    const result = scoreMaintenance(
      makeDwd({
        files: {
          truncated: true,
          entries: [{ path: 'SKILL.md', size: 1, sha256: 'f'.repeat(64) }],
        },
      }),
      AS_OF,
    );
    expect(signal(result, 'maintenance.ci').score).toBeNull();
    expect(signal(result, 'maintenance.ci').value).toBe('truncated');
    expect(result.score).toBe(1);
    expect(result.deductions).toEqual([]);
  });

  it('90 天提交数为 0 → M5，分值 0.85', () => {
    const result = scoreMaintenance(makeDwd({ repo: { commits90d: 0 } }), AS_OF);
    expect(codes(result)).toEqual(['M5']);
    expect(result.score).toBe(0.85); // 1 − .15
    expectLossInvariant(result);
  });

  it('>365 天无发布 → M6，分值 0.90', () => {
    const result = scoreMaintenance(makeDwd({ repo: { lastReleaseAt: daysAgo(500) } }), AS_OF);
    expect(codes(result)).toEqual(['M6']);
    expect(result.score).toBe(0.9); // 1 − .10
    expectLossInvariant(result);
  });
});

describe('scoreMaintenance：僵尸仓与归档（规格 §5.3 M2 / §5.4 封顶）', () => {
  it('>540 天且 <50★ → M1 之上再扣 M2', () => {
    const result = scoreMaintenance(
      makeDwd({ repo: { pushedAt: daysAgo(600), stars: 20 } }),
      AS_OF,
    );
    expect(codes(result)).toEqual(['M1', 'M2']);
    expect(result.score).toBe(0.5); // 1 − .40（M1）− .10（M2）
    // 夹紧不参与不变量：M1(.40) + M2(.10) = .50 = 1 − .50（本例恰好相等）。
    expectLossInvariant(result);
  });

  it('>540 天但 ≥50★ → 不算僵尸仓（只 M1）', () => {
    const result = scoreMaintenance(
      makeDwd({ repo: { pushedAt: daysAgo(600), stars: 80 } }),
      AS_OF,
    );
    expect(codes(result)).toEqual(['M1']);
  });

  it('归档仓：maintenance 封顶 0.30，M7 记录封顶差额', () => {
    const result = scoreMaintenance(makeDwd({ repo: { archived: true } }), AS_OF);
    expect(result.score).toBe(0.3);
    expect(codes(result)).toEqual(['M7']);
    expect(result.deductions[0]?.delta).toBe(0.7); // 1 − 0.30 的封顶差额
  });

  it('归档且本就低于封顶线：封顶不生效、不记 M7', () => {
    // 归档 + 400 天未更新 + 无 CI + 90 天零提交 → raw = 1 − .40 − .35 − .15 = .10 < 0.30。
    const result = scoreMaintenance(
      makeDwd({
        repo: { archived: true, pushedAt: daysAgo(400), commits90d: 0 },
        files: {
          truncated: false,
          entries: [{ path: 'SKILL.md', size: 1, sha256: 'f'.repeat(64) }],
        },
      }),
      AS_OF,
    );
    expect(result.score).toBe(0.1);
    expect(codes(result)).toEqual(['M1', 'M4', 'M5']);
    expectLossInvariant(result);
  });
});
