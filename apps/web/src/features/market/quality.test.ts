/**
 * 五维评分可解释性测试（接缝：`@/features/market/quality`）。
 *
 * 断言：权重与维度键按 §5.1、explain 防御式解析（§5.3 形状 + 前向兼容）、
 * **无信号 ≠ 0 分**、扣分原因按维度汇总且可截断、雷达几何对称且值域夹紧。
 */

import { describe, expect, it } from 'vitest';

import {
  buildRadarDims,
  clampDim,
  deductionLabelKey,
  QUALITY_DIMS,
  radarPolygon,
  readDimExplain,
  summarizeDeductions,
  toPointsAttr,
} from './quality';

describe('quality · 维度与权重（§5.1）', () => {
  it('五维齐、权重冻结（.25/.20/.20/.20/.15）且和为 1', () => {
    expect(QUALITY_DIMS.map((dim) => dim.key)).toEqual([
      'spec',
      'maintenance',
      'docs',
      'security',
      'ecosystem',
    ]);
    expect(QUALITY_DIMS.map((dim) => dim.weight)).toEqual([0.25, 0.2, 0.2, 0.2, 0.15]);
    expect(QUALITY_DIMS.reduce((sum, dim) => sum + dim.weight, 0)).toBeCloseTo(1, 10);
  });
});

describe('quality · explain 防御式解析（§5.3 / §1.5）', () => {
  it('解析 signals 与 deductions（认得的字段照规格）', () => {
    const parsed = readDimExplain(
      {
        docs: {
          signals: [{ code: 'readme', value: 1, weight: 0.5 }],
          deductions: [{ code: 'D2', reason: '无使用示例', delta: -0.2 }],
        },
      },
      'docs',
    );
    expect(parsed.signals).toEqual([{ code: 'readme', value: 1, weight: 0.5 }]);
    expect(parsed.deductions).toEqual([{ code: 'D2', reason: '无使用示例', delta: -0.2 }]);
    expect(parsed.hasSignal).toBe(true);
  });

  it('signals 为空数组 = 无信号（雷达画空心点，区别于 0 分）', () => {
    expect(
      readDimExplain({ ecosystem: { signals: [], deductions: [] } }, 'ecosystem').hasSignal,
    ).toBe(false);
  });

  it('完全没有 explain / 结构奇怪 → 按「有值无解释」处理（不假装无信号）', () => {
    expect(readDimExplain(undefined, 'spec').hasSignal).toBe(true);
    expect(readDimExplain('boom', 'spec').signals).toEqual([]);
    expect(readDimExplain({ spec: 'not-an-object' }, 'spec').hasSignal).toBe(true);
    expect(readDimExplain({ spec: { deductions: [] } }, 'spec').hasSignal).toBe(true);
    expect(readDimExplain({ spec: { signals: [{ code: 1 }, 'x'] } }, 'spec').signals[0]).toEqual({
      code: '',
      value: null,
      weight: null,
    });
  });

  it('未知原因码回落数据自带 reason（词表外的码不报错）', () => {
    expect(deductionLabelKey('S1')).toBe('market.deduct.s1');
    expect(deductionLabelKey('ZZ9')).toBeNull();
  });
});

describe('quality · 扣分原因汇总（§5.3 每维前 2–3 条）', () => {
  it('按维度顺序汇总，每维截断到 3 条；无扣分的维度不出现', () => {
    const groups = summarizeDeductions({
      spec: {
        signals: [{ code: 'a' }],
        deductions: [{ code: 'S1' }, { code: 'S2' }, { code: 'S3' }, { code: 'S4' }],
      },
      security: { signals: [], deductions: [{ code: 'X1' }] },
    });
    expect(groups.map((group) => group.dim)).toEqual(['spec', 'security']);
    expect(groups[0]?.deductions).toHaveLength(3);
    expect(groups[0]?.labelKey).toBe('market.dim.spec');
  });
});

describe('quality · 雷达（D2）', () => {
  it('五维值夹到 [0,1]（越界/NaN 不画到雷达外）', () => {
    expect(clampDim(1.5)).toBe(1);
    expect(clampDim(-2)).toBe(0);
    expect(clampDim(Number.NaN)).toBe(0);
  });

  it('雷达数据点保留无信号标记', () => {
    const dims = buildRadarDims(
      { spec: 0.9, maintenance: 0, docs: 0.5, security: 1, ecosystem: 0.2 },
      { maintenance: { signals: [] } },
    );
    expect(dims).toHaveLength(5);
    expect(dims[1]).toMatchObject({ key: 'maintenance', value: 0, hasSignal: false });
    expect(dims[0]?.hasSignal).toBe(true);
  });

  it('几何：满值点落在半径上、零值点在圆心、五轴对称（首点正上方）', () => {
    const full = radarPolygon([1, 1, 1, 1, 1], 50, 40);
    expect(full[0]?.x).toBeCloseTo(50, 6);
    expect(full[0]?.y).toBeCloseTo(10, 6);
    expect(toPointsAttr(full).split(' ')).toHaveLength(5);
    const zero = radarPolygon([0, 0, 0, 0, 0], 50, 40);
    for (const point of zero) {
      expect(point.x).toBeCloseTo(50, 6);
      expect(point.y).toBeCloseTo(50, 6);
    }
  });
});
