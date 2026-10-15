/**
 * 汇总层单测（MK-03）。
 *
 * 断言口径来自规格 §5.1（每维 [0,1]、总分 = Σ(权重 × 维度分)、两位小数）、
 * §5.3（每维可解释输出齐备）、§5.4（冷启动托底 / 归档 / 合规样本 confidence=low）。
 * 期望总分均为**手算**（不照抄实现）并逐项验收。
 */

import { describe, expect, it } from 'vitest';
import { AS_OF, daysAgo, file, makeDwd } from './__fixtures__/dwd.ts';
import { scoreAsset } from './aggregate.ts';
import { buildEcosystemContext } from './dim-ecosystem.ts';
import type { DwdAsset } from './types.ts';
import { DIM_LABELS, DIM_WEIGHTS, DIMENSIONS } from './types.ts';

/** 单资产评分（自动建 n=1 分位语境）。 */
function scoreOne(input: DwdAsset) {
  return scoreAsset(input, buildEcosystemContext([input], AS_OF), { asOf: AS_OF });
}

describe('scoreAsset：五维合成（规格 §5.1）', () => {
  it('权重表与维度键 = 规格定稿（.25/.20/.20/.20/.15）', () => {
    expect(DIMENSIONS).toEqual(['spec', 'maintenance', 'docs', 'security', 'ecosystem']);
    expect(DIM_WEIGHTS).toEqual({
      spec: 0.25,
      maintenance: 0.2,
      docs: 0.2,
      security: 0.2,
      ecosystem: 0.15,
    });
    const sum = DIMENSIONS.reduce((acc, key) => acc + DIM_WEIGHTS[key], 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    expect(DIM_LABELS.spec).toBe('规范符合度');
    expect(DIM_LABELS.ecosystem).toBe('生态热度');
  });

  it('健康资产：五维全 1 → 总分 1.00，flags 全 false，confidence high', () => {
    const record = scoreOne(makeDwd());
    expect(record.schema).toBe('df.market.dws.asset_quality/v1');
    expect(record.dims).toEqual({
      spec: 1,
      maintenance: 1,
      docs: 1,
      security: 1,
      ecosystem: 1,
    });
    expect(record.score).toBe(1);
    expect(record.confidence).toBe('high');
    expect(record.flags).toEqual({
      archived: false,
      coldStart: false,
      nonCompliant: false,
      filesTruncated: false,
    });
  });

  it('混合案例：总分 = 手算 0.80（每维分值可逐项验收）', () => {
    const record = scoreOne(
      makeDwd({
        asset: { capabilitiesDeclared: false },
        repo: { pushedAt: daysAgo(200) },
        text: {
          frontmatter: { name: 'x', description: '把设计稿导出为分页 PDF。' },
          changelog: null,
        },
        files: {
          truncated: false,
          entries: [
            file('SKILL.md'),
            file('references/api.md'),
            file('LICENSE'),
            file('.github/workflows/ci.yml'),
          ],
        },
      }),
    );
    expect(record.dims.spec).toBe(0.8125); // 缺「何时使用」
    expect(record.dims.maintenance).toBe(0.8); // 200 天未更新
    expect(record.dims.docs).toBe(0.75); // 无预览(.15) + 无 changelog(.10)
    expect(record.dims.security).toBe(0.7); // 未声明权限
    expect(record.dims.ecosystem).toBe(1); // n=1 分位
    // 手算：.25×.8125 + .20×.8 + .20×.75 + .20×.7 + .15×1 = .803125 → 两位小数 0.80
    expect(record.score).toBe(0.8);
  });

  it('可解释输出齐备（规格 §5.3：每维 signals + deductions）', () => {
    const record = scoreOne(makeDwd());
    for (const key of DIMENSIONS) {
      expect(record.explain[key].signals.length).toBeGreaterThan(0);
      expect(Array.isArray(record.explain[key].deductions)).toBe(true);
    }
    // 每维分值域：null（空心）或 [0,1]
    for (const key of DIMENSIONS) {
      const value = record.dims[key];
      if (value !== null) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('scoreAsset：冷启动托底（规格 §5.4）', () => {
  it('新资产且文档有欠账：生态热度置空、总分按可用权重重归一化', () => {
    const record = scoreOne(
      makeDwd({
        repo: { createdAt: daysAgo(30) },
        text: { readme: null },
        files: {
          truncated: false,
          entries: [
            file('SKILL.md'),
            file('references/api.md'),
            file('LICENSE'),
            file('.github/workflows/ci.yml'),
          ],
        },
      }),
    );
    expect(record.flags.coldStart).toBe(true);
    expect(record.dims.ecosystem).toBeNull();
    expect(record.dims.docs).toBe(0.25); // 丢 .30(README) + .30(示例) + .15(预览) = .75
    // 手算：(.25×1 + .20×1 + .20×.25 + .20×1) / .85 = .70/.85 = 0.8235… → 0.82
    expect(record.score).toBe(0.82);
  });
});

describe('scoreAsset：归档与合规样本（规格 §5.4）', () => {
  it('归档仓：maintenance 封顶 0.30、flags.archived', () => {
    const record = scoreOne(makeDwd({ repo: { archived: true } }));
    expect(record.dims.maintenance).toBe(0.3);
    expect(record.flags.archived).toBe(true);
    // 手算：(.25×1 + .20×.3 + .20×1 + .20×1 + .15×1) = .25+.06+.2+.2+.15 = .86
    expect(record.score).toBe(0.86);
  });

  it('不合规样本（无 frontmatter）：confidence=low、flags.nonCompliant', () => {
    const record = scoreOne(
      makeDwd({ asset: { compliance: 'non-compliant' }, text: { frontmatter: null } }),
    );
    expect(record.confidence).toBe('low');
    expect(record.flags.nonCompliant).toBe(true);
  });

  it('deferred（未全量校验）：同样如实降置信', () => {
    const record = scoreOne(makeDwd({ asset: { compliance: 'deferred' } }));
    expect(record.confidence).toBe('low');
    expect(record.flags.nonCompliant).toBe(false);
  });
});
