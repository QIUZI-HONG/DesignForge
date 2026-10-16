/**
 * 安全性（`security`，权重 .20）单测（MK-03）。
 *
 * 断言口径来自规格 §5.2「安全性」（隐藏安装脚本 / 权限声明 / 出站域名声明 /
 * 敏感路径访问）、§5.3（X1–X4 + L1）与 §5.4（无 license / NOASSERTION **不从安全性扣分**，
 * 许可走守门——本用例专门守住这条）。
 */

import { describe, expect, it } from 'vitest';
import { file, makeDwd } from './__fixtures__/dwd.ts';
import { scoreSecurity } from './dim-security.ts';
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

/** 记账不变量：Σ扣分 = 1 − 维度分（L1 恒 0 不影响）。 */
function expectLossInvariant(result: DimensionResult): void {
  const lost = result.deductions.reduce((sum, d) => sum + d.delta, 0);
  expect(Math.abs(lost - (1 - (result.score ?? 0)))).toBeLessThan(1e-3);
}

describe('scoreSecurity：健康资产（规格 §5.2 全信号满足）', () => {
  it('四条信号齐、分值 1.00、无扣分（许可可装载 → 无 L1）', () => {
    const result = scoreSecurity(makeDwd());
    expect(result.signals.map((s) => s.code)).toEqual([
      'security.install-scripts',
      'security.permissions',
      'security.outbound',
      'security.sensitive-paths',
    ]);
    expect(result.score).toBe(1);
    expect(result.deductions).toEqual([]);
  });
});

describe('scoreSecurity：安装脚本（规格 §5.2 / X1）', () => {
  it('package.json 生命周期钩子 → X1，分值 0.65', () => {
    const result = scoreSecurity(
      makeDwd({ text: { packageJson: { name: 'x', scripts: { postinstall: 'node setup.js' } } } }),
    );
    expect(signal(result, 'security.install-scripts').value).toBe('lifecycle:postinstall');
    expect(codes(result)).toEqual(['X1']);
    expect(result.score).toBe(0.65); // 1 − .35
    expectLossInvariant(result);
  });

  it('仅有 shell 脚本 → X1 半分（0.79）', () => {
    const result = scoreSecurity(
      makeDwd({
        files: {
          truncated: false,
          entries: [...makeDwd().files.entries, file('scripts/setup.sh')],
        },
      }),
    );
    expect(signal(result, 'security.install-scripts').value).toBe('shell-only');
    expect(codes(result)).toEqual(['X1']);
    expect(result.score).toBe(0.79); // 1 − .35 × .6
    expectLossInvariant(result);
  });

  it('Trees 截断时 shell 脚本不可证伪 → 该信号不可得、不扣分', () => {
    const result = scoreSecurity(
      makeDwd({ files: { truncated: true, entries: [file('SKILL.md')] } }),
    );
    expect(signal(result, 'security.install-scripts').score).toBeNull();
    expect(result.score).toBe(1);
  });
});

describe('scoreSecurity：权限声明（规格 §5.2 / X2）', () => {
  it('未声明能力 → X2，分值 0.70', () => {
    const result = scoreSecurity(
      makeDwd({
        asset: { capabilitiesDeclared: false, capabilities: ['prompt:inject'] },
        text: { frontmatter: { name: 'x', description: 'Use when needed' } },
      }),
    );
    expect(codes(result)).toEqual(['X2']);
    expect(result.score).toBe(0.7); // 1 − .30
    expectLossInvariant(result);
  });

  it('frontmatter allowedTools 或清单能力字段任一算已声明', () => {
    const byFrontmatter = scoreSecurity(
      makeDwd({
        asset: { capabilitiesDeclared: false },
        text: {
          frontmatter: { name: 'x', description: 'Use when needed', allowedTools: ['Read'] },
        },
      }),
    );
    expect(codes(byFrontmatter)).toEqual([]);

    const byManifest = scoreSecurity(
      makeDwd({
        asset: { kind: 'plugin', capabilitiesDeclared: false },
        text: { manifest: { name: 'p', skills: ['a'], capabilities: ['fs:read'] } },
      }),
    );
    expect(codes(byManifest)).toEqual([]);
  });
});

describe('scoreSecurity：出站域名（规格 §5.2 / X3）', () => {
  it('清单含 URL 且未声明域名 → X3，分值 0.80', () => {
    const result = scoreSecurity(
      makeDwd({
        text: { manifest: { name: 'x', skills: ['a'], homepage: 'https://api.acme.dev/v1' } },
      }),
    );
    expect(signal(result, 'security.outbound').value).toBe('api.acme.dev');
    expect(codes(result)).toEqual(['X3']);
    expect(result.score).toBe(0.8); // 1 − .20
  });

  it('域名已声明（frontmatter / 清单）→ 不扣分', () => {
    const result = scoreSecurity(
      makeDwd({
        text: {
          manifest: { name: 'x', skills: ['a'], endpoint: 'https://api.acme.dev/v1' },
          frontmatter: {
            name: 'x',
            description: 'Use when needed',
            outboundDomains: ['api.acme.dev'],
          },
        },
      }),
    );
    expect(codes(result)).toEqual([]);
  });

  it('出站域名为空 → 1（无声明义务）', () => {
    const result = scoreSecurity(makeDwd({ text: { mcpJson: null, manifest: null } }));
    expect(signal(result, 'security.outbound').value).toBe('none');
    expect(signal(result, 'security.outbound').score).toBe(1);
  });
});

describe('scoreSecurity：敏感路径（规格 §5.2 / X4）', () => {
  it('正文写家目录外读写 → X4，分值 0.85', () => {
    const result = scoreSecurity(
      makeDwd({ text: { body: '# x\n\n```bash\ncp -r skill ~/.claude/skills\n```' } }),
    );
    expect(codes(result)).toEqual(['X4']);
    expect(result.deductions[0]?.reason).toContain('~/');
    expect(result.score).toBe(0.85); // 1 − .15
    expectLossInvariant(result);
  });
});

describe('scoreSecurity：许可不扣分（规格 §5.4 硬口径）', () => {
  it('无 license / NOASSERTION → security 分不受影响，仅记 L1（delta 0）', () => {
    for (const license of [
      { spdx: null, gate: 'blocked' as const, evidence: { path: null, sha256: null } },
      {
        spdx: 'NOASSERTION',
        gate: 'view-only' as const,
        evidence: { path: 'LICENSE', sha256: 'e'.repeat(64) },
      },
    ]) {
      const result = scoreSecurity(makeDwd({ license }));
      expect(result.score).toBe(1);
      expect(codes(result)).toEqual(['L1']);
      expect(result.deductions[0]?.delta).toBe(0);
      expectLossInvariant(result);
    }
  });
});
