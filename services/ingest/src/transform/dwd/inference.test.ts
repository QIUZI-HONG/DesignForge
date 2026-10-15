/**
 * 构建期启发式的单元测试（两处真实数据上暴露过的坑，作为回归护栏）。
 *
 * 1. `isStructuralFile`：资产身份解析只认「资产根处的结构件」——仓根 Plugin 不得被
 *    深层 `template/SKILL.md` 顶掉名字（实测发生）；
 * 2. `inferUpstream`：单文件里的一次外链不足以认定同源，需 ≥2 个不同文件指向同一仓。
 */

import { describe, expect, it } from 'vitest';

import { inferUpstream, isStructuralFile } from './build.ts';

describe('isStructuralFile（位置敏感的结构件白名单）', () => {
  it('技能：只认资产根处的 SKILL.md（深层同名文件不算）', () => {
    expect(isStructuralFile('skill', 'SKILL.md')).toBe(true);
    expect(isStructuralFile('skill', 'template/SKILL.md')).toBe(false);
    expect(isStructuralFile('skill', 'skills/pdf/SKILL.md')).toBe(false);
  });

  it('插件：仓根与其 .claude-plugin/ 下的清单都算', () => {
    expect(isStructuralFile('plugin', '.claude-plugin/marketplace.json')).toBe(true);
    expect(isStructuralFile('plugin', 'plugin.json')).toBe(true);
    expect(isStructuralFile('plugin', 'packages/x/plugin.json')).toBe(false);
  });

  it('设计系统：token 件与 DESIGN.md；模板：template.json/manifest.json', () => {
    expect(isStructuralFile('design-system', 'tokens.css')).toBe(true);
    expect(isStructuralFile('design-system', 'src/i18n/lang/en/tokens.json')).toBe(false);
    expect(isStructuralFile('template', 'template.json')).toBe(true);
    expect(isStructuralFile('template', 'design-templates/a/template.json')).toBe(false);
  });
});

describe('inferUpstream（保守同源推断）', () => {
  it('两个不同文件指向同一仓 → 强同源（可作同簇依据）', () => {
    const result = inferUpstream('acme/fork', [
      { path: 'README.md', text: '基于 https://github.com/up/stream 二次创作' },
      { path: 'template.json', text: 'upstream: github.com/up/stream' },
    ]);
    expect(result.upstream).toBe('up/stream');
    expect(result.fileCount).toBe(2);
    expect(result.strong).toBe(true);
  });

  it('单文件里的一次外链 → 弱推断（不强制同簇）', () => {
    const result = inferUpstream('anthropics/skills', [
      {
        path: 'skills/claude-api/SKILL.md',
        text: 'See github.com/anthropics/anthropic-sdk-go for details.',
      },
    ]);
    expect(result.upstream).toBe('anthropics/anthropic-sdk-go');
    expect(result.strong).toBe(false);
  });

  it('自指链接被忽略；无外链 → null', () => {
    expect(
      inferUpstream('acme/self', [{ path: 'README.md', text: 'github.com/acme/self is me' }])
        .upstream,
    ).toBeNull();
    expect(inferUpstream('acme/self', []).upstream).toBeNull();
  });

  it('平票取字典序最小（确定性）', () => {
    const bodies = [
      { path: 'a.md', text: 'github.com/z/zeta github.com/a/alpha' },
      { path: 'b.md', text: 'github.com/z/zeta github.com/a/alpha' },
    ];
    expect(inferUpstream('acme/x', bodies).upstream).toBe('a/alpha');
  });
});
