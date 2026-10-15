/**
 * 生态热度（`ecosystem`，权重 .15）单测（MK-03）。
 *
 * 断言口径来自规格 §5.2「生态热度」（星标 + **星标增速** / fork 数 / 被引用数）、
 * 「防马太：用增速与分位，不用绝对星标排名」（v1.1 §4.4.3）、§5.4 冷启动托底
 * （<90 天或零采纳 → 用 spec + maintenance 托底，本条只负责把本维置空）。
 */

import { describe, expect, it } from 'vitest';
import { AS_OF, daysAgo, makeDwd } from './__fixtures__/dwd.ts';
import { buildEcosystemContext, isColdStart, scoreEcosystem } from './dim-ecosystem.ts';
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

/** 记账不变量：Σ扣分 = 1 − 维度分。 */
function expectLossInvariant(result: DimensionResult): void {
  const lost = result.deductions.reduce((sum, d) => sum + d.delta, 0);
  expect(Math.abs(lost - (1 - (result.score ?? 0)))).toBeLessThan(1e-3);
}

describe('scoreEcosystem：分位口径（规格 §5.2 防马太）', () => {
  it('单资产批次（n=1）→ 三轴 1.00、无扣分', () => {
    const dwd = makeDwd();
    const ctx = buildEcosystemContext([dwd], AS_OF);
    const result = scoreEcosystem(dwd, ctx, AS_OF);
    expect(result.signals.map((s) => s.code)).toEqual([
      'ecosystem.stars-growth',
      'ecosystem.forks',
      'ecosystem.referenced',
    ]);
    expect(result.score).toBe(1);
    expect(result.deductions).toEqual([]);
  });

  it('增速垫底 → E1，分值为手算的 0.775', () => {
    const hot = makeDwd({ asset: { id: 'gh:acme/a#skills/a' }, repo: { stars: 240 } });
    const cold = makeDwd({ asset: { id: 'gh:acme/b#skills/b' }, repo: { stars: 200 } });
    const ctx = buildEcosystemContext([hot, cold], AS_OF);

    const hotResult = scoreEcosystem(hot, ctx, AS_OF);
    expect(hotResult.score).toBe(1); // 增速分位 1.0（并列以上）
    expect(codes(hotResult)).toEqual([]);

    const coldResult = scoreEcosystem(cold, ctx, AS_OF);
    expect(signal(coldResult, 'ecosystem.stars-growth').value).toBe(0); // 增速 0
    expect(codes(coldResult)).toEqual(['E1']);
    expect(coldResult.score).toBe(0.775); // 1 − .45 × (1 − .5)
    expectLossInvariant(coldResult);
  });

  it('全员并列 → 全 1.00（不产生幽灵扣分）', () => {
    const a = makeDwd({ asset: { id: 'gh:x/a#a' } });
    const b = makeDwd({ asset: { id: 'gh:x/b#b' } });
    const ctx = buildEcosystemContext([a, b], AS_OF);
    expect(scoreEcosystem(a, ctx, AS_OF).score).toBe(1);
    expect(scoreEcosystem(b, ctx, AS_OF).deductions).toEqual([]);
  });

  it('被引用垫底 → E3；fork 垫底 → E2', () => {
    const top = makeDwd({
      asset: { id: 'gh:x/top#a' },
      repo: { forks: 30 },
      trend: { referencedBy: 4 },
    });
    const bottom = makeDwd({
      asset: { id: 'gh:x/low#b' },
      repo: { forks: 1 },
      trend: { referencedBy: 0 },
    });
    const ctx = buildEcosystemContext([top, bottom], AS_OF);
    const result = scoreEcosystem(bottom, ctx, AS_OF);
    expect(codes(result)).toEqual(['E3', 'E2']); // 被引用权重 .35 > fork .20
    expectLossInvariant(result);
  });
});

describe('scoreEcosystem：无数据与冷启动（规格 §5.4）', () => {
  it('无历史星标 → 增速信号不可得、不参与加权', () => {
    const dwd = makeDwd({ trend: { stars90dAgo: null } });
    const ctx = buildEcosystemContext([dwd], AS_OF);
    const result = scoreEcosystem(dwd, ctx, AS_OF);
    expect(signal(result, 'ecosystem.stars-growth').score).toBeNull();
    expect(signal(result, 'ecosystem.stars-growth').value).toBeNull();
    expect(result.score).toBe(1); // 其余两轴 n=1 → 1.00
    expect(result.deductions).toEqual([]);
  });

  it('新资产（<90 天）→ 本维置空（空心），观测值保留、无扣分', () => {
    const dwd = makeDwd({ repo: { createdAt: daysAgo(30) } });
    expect(isColdStart(dwd, AS_OF)).toBe(true);
    const ctx = buildEcosystemContext([dwd], AS_OF);
    const result = scoreEcosystem(dwd, ctx, AS_OF);
    expect(result.score).toBeNull();
    expect(result.signals.every((s) => s.score === null)).toBe(true);
    expect(signal(result, 'ecosystem.stars-growth').value).toBe(0.2); // 观测仍在（可解释）
    expect(result.deductions).toEqual([]);
  });

  it('零采纳老仓（无星无 fork 无引用）→ 同走冷启动托底', () => {
    const dwd = makeDwd({
      repo: { createdAt: daysAgo(700), stars: 0, forks: 0 },
      trend: { stars90dAgo: null, referencedBy: 0 },
    });
    expect(isColdStart(dwd, AS_OF)).toBe(true);
  });

  it('老仓但有星 → 不属冷启动', () => {
    expect(isColdStart(makeDwd(), AS_OF)).toBe(false);
  });
});
