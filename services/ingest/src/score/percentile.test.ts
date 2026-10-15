/**
 * 批内分位与增速单测（MK-03）。
 *
 * 规格依据：§5.2「生态热度」——**防马太：用增速与分位，不用绝对星标排名**（v1.1 §4.4.3 明示）。
 * 分位定义（口径写死在实现注释里，改则同步改测试）：
 *   `p = 批内 ≤ 本值的样本占比` → 最高值 1.00；并列同分位；全员并列 → 全员 1.00；n=1 → 1.00。
 * 「全员并列 == 1.00」是硬要求：不能对并列数据造出幽灵扣分。
 */

import { describe, expect, it } from 'vitest';
import { batchPercentile, starsGrowthRate } from './percentile.ts';

describe('batchPercentile（批内分位，防马太口径）', () => {
  it('单样本批次 → 1.00', () => {
    expect(batchPercentile(5, [5])).toBe(1);
  });

  it('全员并列 → 全员 1.00（不产生幽灵扣分）', () => {
    expect(batchPercentile(0, [0, 0, 0])).toBe(1);
    expect(batchPercentile(7, [7, 7, 7, 7])).toBe(1);
  });

  it('互异样本 → ≤ 占比', () => {
    const values = [10, 20, 30, 40];
    expect(batchPercentile(10, values)).toBe(0.25);
    expect(batchPercentile(30, values)).toBe(0.75);
    expect(batchPercentile(40, values)).toBe(1);
  });

  it('并列样本同分位（算上并列自身）', () => {
    expect(batchPercentile(0, [0, 0, 1])).toBeCloseTo(2 / 3, 10);
    expect(batchPercentile(1, [0, 0, 1])).toBe(1);
  });

  it('空批 → null', () => {
    expect(batchPercentile(3, [])).toBeNull();
  });
});

describe('starsGrowthRate（星标增速）', () => {
  it('常规增速 = 增量 / 上期', () => {
    expect(starsGrowthRate(240, 200)).toBe(0.2);
    expect(starsGrowthRate(200, 200)).toBe(0);
  });

  it('上期为 0：以 1 为分母（新仓暴增不吃无穷）', () => {
    expect(starsGrowthRate(10, 0)).toBe(10);
  });

  it('星标下跌为负增速', () => {
    expect(starsGrowthRate(180, 200)).toBe(-0.1);
  });
});
