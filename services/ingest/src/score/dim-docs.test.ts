/**
 * 文档完备度（`docs`，权重 .20）单测（MK-03）。
 *
 * 断言口径来自规格 §5.2「文档完备度」（README 安装与使用示例 / 预览资产 /
 * changelog / 许可说明含上游署名）与 §5.3 扣分码（D1–D5）。
 * 许可清晰度在 **docs** 扣分属规格明文；无 license 不扣 **security** 分（§5.4）另测。
 */

import { describe, expect, it } from 'vitest';
import { file, makeDwd } from './__fixtures__/dwd.ts';
import { scoreDocs } from './dim-docs.ts';
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

/** 无预览、无 changelog 的最小文件清单（只留 SKILL.md 与 LICENSE）。 */
const MINIMAL_FILES = [file('SKILL.md'), file('LICENSE')];

describe('scoreDocs：健康资产（规格 §5.2 全信号满足）', () => {
  it('五条信号齐、分值 1.00、无扣分', () => {
    const result = scoreDocs(makeDwd());
    expect(result.signals.map((s) => s.code)).toEqual([
      'docs.readme',
      'docs.usage',
      'docs.preview',
      'docs.changelog',
      'docs.license-clarity',
    ]);
    expect(result.score).toBe(1);
    expect(result.deductions).toEqual([]);
    expectLossInvariant(result);
  });
});

describe('scoreDocs：README 与示例（规格 §5.2）', () => {
  it('无 README → D1 且示例信号同步为 0（D2）', () => {
    const result = scoreDocs(
      makeDwd({ text: { readme: null }, files: { truncated: false, entries: MINIMAL_FILES } }),
    );
    // 丢 .30(README) + .30(示例) + .15(预览) = .75；changelog 由 text 提供不受影响。
    expect(codes(result)).toEqual(['D1', 'D2', 'D3']);
    expect(result.score).toBe(0.25);
    expect(result.deductions.find((d) => d.code === 'D2')?.reason).toContain('README');
    expectLossInvariant(result);
  });

  it('有安装说明、无使用示例 → D2 半分（0.85）', () => {
    const result = scoreDocs(
      makeDwd({ text: { readme: '# x\n\n## Install\n\n```bash\nnpm i x\n```' } }),
    );
    expect(signal(result, 'docs.usage').score).toBe(0.5);
    expect(codes(result)).toEqual(['D2']);
    expect(result.score).toBe(0.85);
    expect(result.deductions[0]?.reason).toContain('未含使用示例');
    expectLossInvariant(result);
  });

  it('有使用示例、无安装说明 → D2 半分', () => {
    const result = scoreDocs(makeDwd({ text: { readme: '## 示例\n\n拖进来就能用。' } }));
    expect(signal(result, 'docs.usage').score).toBe(0.5);
    expect(result.deductions[0]?.reason).toContain('未含安装说明');
  });
});

describe('scoreDocs：预览资产与 changelog（规格 §5.2）', () => {
  it('无预览 → D3（0.85）', () => {
    const result = scoreDocs(makeDwd({ files: { truncated: false, entries: MINIMAL_FILES } }));
    expect(codes(result)).toEqual(['D3']);
    expect(result.score).toBe(0.85); // 丢 .15
    expectLossInvariant(result);
  });

  it('Trees 截断且未见预览 → 该信号不可得、不扣分', () => {
    const result = scoreDocs(makeDwd({ files: { truncated: true, entries: MINIMAL_FILES } }));
    expect(signal(result, 'docs.preview').score).toBeNull();
    expect(result.score).toBe(1);
    expect(result.deductions).toEqual([]);
  });

  it('changelog 落在文件（text 无正文）也认', () => {
    const result = scoreDocs(
      makeDwd({
        text: { changelog: null },
        files: {
          truncated: false,
          entries: [...MINIMAL_FILES, file('preview/a.png'), file('CHANGELOG.md')],
        },
      }),
    );
    expect(signal(result, 'docs.changelog').score).toBe(1);
    expect(codes(result)).toEqual([]);
  });
});

describe('scoreDocs：许可说明清晰度（规格 §5.2「含上游署名」）', () => {
  it('NOASSERTION 且无许可原文 → D5 缺许可原文（0.91）', () => {
    const result = scoreDocs(
      makeDwd({
        license: { spdx: 'NOASSERTION', gate: 'view-only', evidence: { path: null, sha256: null } },
        files: {
          truncated: false,
          entries: [file('SKILL.md'), file('preview/a.png'), file('CHANGELOG.md')],
        },
      }),
    );
    expect(codes(result)).toEqual(['D5']);
    expect(result.score).toBe(0.91); // 丢 .15 × .6
    expect(result.deductions[0]?.reason).toContain('缺许可原文');
    expectLossInvariant(result);
  });

  it('声明上游但正文无署名 → D5 缺上游署名（0.94）', () => {
    const result = scoreDocs(makeDwd({ repo: { upstream: 'acme/original' } }));
    const d5 = result.deductions.find((d) => d.code === 'D5');
    expect(d5?.reason).toContain('缺上游署名');
    expect(result.score).toBe(0.94); // 丢 .15 × .4
    expectLossInvariant(result);
  });
});
