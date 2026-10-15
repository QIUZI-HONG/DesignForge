/**
 * 规范符合度（`spec`，权重 .25）单测（MK-03）。
 *
 * 断言口径全部来自规格 §5.2「规范符合度」信号清单（frontmatter 完整度 / 何时使用 /
 * 显式工作流 / references、examples / 清单 schema / 正文非纯清单）与 §5.3 扣分码。
 * 期望值手算自规格权重（不照抄实现），并验证「Σ扣分 = 1 − 维度分」记账不变量。
 */

import { describe, expect, it } from 'vitest';
import { file, makeDwd } from './__fixtures__/dwd.ts';
import { scoreSpec } from './dim-spec.ts';
import type { DimensionResult } from './types.ts';

/** 按码取信号（缺则抛，测试读起来像规格条款）。 */
function signal(result: DimensionResult, code: string) {
  const found = result.signals.find((s) => s.code === code);
  if (found === undefined) throw new Error(`缺信号：${code}`);
  return found;
}

/** 扣分码序列。 */
function codes(result: DimensionResult): string[] {
  return result.deductions.map((d) => d.code);
}

/** 记账不变量：扣分之和 ≈ 1 − 维度分（四舍五入容差）。 */
function expectLossInvariant(result: DimensionResult): void {
  const lost = result.deductions.reduce((sum, d) => sum + d.delta, 0);
  expect(Math.abs(lost - (1 - (result.score ?? 0)))).toBeLessThan(1e-3);
}

describe('scoreSpec：健康 skill（规格 §5.2 全信号满足）', () => {
  it('六条信号齐、分值 1.00、无扣分', () => {
    const result = scoreSpec(makeDwd());
    expect(result.score).toBe(1);
    expect(result.signals.map((s) => s.code)).toEqual([
      'spec.frontmatter',
      'spec.description-usage',
      'spec.workflow',
      'spec.aux-dirs',
      'spec.manifest',
      'spec.body',
    ]);
    expect(result.deductions).toEqual([]);
    // skill 无清单要求：信号标 n/a 且不参与加权（权重归一化到其余信号）。
    expect(signal(result, 'spec.manifest').score).toBeNull();
    expect(signal(result, 'spec.manifest').value).toBe('n/a');
    expectLossInvariant(result);
  });
});

describe('scoreSpec：无 frontmatter 的不合规样本（规格 §2.2 / §5.4）', () => {
  it('S0+S1+S2+S4 四码齐，分值为手算的 0.375', () => {
    const result = scoreSpec(
      makeDwd({
        asset: { compliance: 'non-compliant' },
        text: { frontmatter: null, readme: null },
        files: { truncated: false, entries: [file('SKILL.md'), file('LICENSE')] },
      }),
    );
    // 有效权重 .80 = .25+.15+.20+.10(body)；满足的只有 workflow(.20)+body(.10) → .30/.80。
    expect(result.score).toBe(0.375);
    expect(codes(result)).toEqual(['S2', 'S0', 'S1', 'S4']);
    expect(signal(result, 'spec.frontmatter').value).toBe('none');
    expect(result.deductions[0]?.reason).toContain('description');
    expectLossInvariant(result);
  });
});

describe('scoreSpec：description 未写「何时使用」', () => {
  it('只扣 S2，分值为 0.8125', () => {
    const result = scoreSpec(
      makeDwd({
        text: { frontmatter: { name: 'pdf-export', description: '把设计稿导出为分页 PDF。' } },
      }),
    );
    // 满足 5/6 信号权重 .65（缺 .15）→ .65/.80。
    expect(result.score).toBe(0.8125);
    expect(codes(result)).toEqual(['S2']);
    expect(result.deductions[0]?.delta).toBe(0.1875); // .15/.80 归一化后的实际扣分
    expectLossInvariant(result);
  });
});

describe('scoreSpec：清单 schema（规格 §5.2「plugin.json / design-system manifest 字段齐」）', () => {
  it('plugin 清单字段齐 → 满分', () => {
    const result = scoreSpec(
      makeDwd({
        asset: { kind: 'plugin' },
        text: { manifest: { name: 'pdf-plugin', skills: ['pdf'], commands: ['export'] } },
      }),
    );
    expect(signal(result, 'spec.manifest').score).toBe(1);
  });

  it('plugin 清单缺字段 → S5 且理由列出缺失项', () => {
    const result = scoreSpec(
      makeDwd({ asset: { kind: 'plugin' }, text: { manifest: { name: 'pdf-plugin' } } }),
    );
    expect(signal(result, 'spec.manifest').score).toBe(0);
    expect(codes(result)).toEqual(['S5']);
    expect(result.deductions[0]?.reason).toContain('skills');
  });

  it('design-system 清单字段齐 → 满分；template 清单不齐 → S5', () => {
    const ds = scoreSpec(
      makeDwd({
        asset: { kind: 'design-system' },
        text: { manifest: { name: 'brand', tokens: 'tokens.json', components: ['button'] } },
      }),
    );
    expect(signal(ds, 'spec.manifest').score).toBe(1);

    const tpl = scoreSpec(
      makeDwd({ asset: { kind: 'template' }, text: { manifest: { name: 'deck' } } }),
    );
    expect(signal(tpl, 'spec.manifest').score).toBe(0);
    expect(codes(tpl)).toEqual(['S5']);
  });

  it('清单整体缺失（plugin 认定要求有清单）→ S5', () => {
    const result = scoreSpec(makeDwd({ asset: { kind: 'plugin' }, text: { manifest: null } }));
    expect(signal(result, 'spec.manifest').score).toBe(0);
    expect(codes(result)).toContain('S5');
  });
});

describe('scoreSpec：正文（规格 §2.2 内容校验③）', () => {
  it('正文缺失且无 README → S6', () => {
    const result = scoreSpec(makeDwd({ text: { body: null, readme: null } }));
    expect(signal(result, 'spec.body').score).toBe(0);
    expect(signal(result, 'spec.workflow').score).toBeNull(); // 无文本 → 工作流不可判（不冤枉扣分）
    expect(codes(result)).toEqual(['S6']);
  });

  it('纯链接清单（redirect 型）→ S6', () => {
    const result = scoreSpec(
      makeDwd({ text: { body: '# PDF\n\nSee https://github.com/anthropics/skills' } }),
    );
    expect(signal(result, 'spec.body').value).toBe('link-list');
    expect(codes(result)).toEqual(['S3', 'S6']);
  });
});

describe('scoreSpec：Trees 截断（超大仓口径）', () => {
  it('无法证明 references/ 不存在 → 该信号不可得、不扣分', () => {
    const result = scoreSpec(
      makeDwd({
        files: { truncated: true, entries: [file('SKILL.md')] },
      }),
    );
    expect(signal(result, 'spec.aux-dirs').score).toBeNull();
    expect(signal(result, 'spec.aux-dirs').value).toBe('truncated');
    expect(codes(result)).toEqual([]);
    expect(result.score).toBe(1); // 其余信号全满 → 归一化后仍为 1
  });
});
