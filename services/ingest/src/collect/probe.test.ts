/**
 * 结构探针测试（规格 §2：识别 = 结构探针 + 内容校验）。
 *
 * 探针只回答「结构件在不在、归属哪个资产根」，不回答「是不是资产」——
 * 判定交给内容校验（validate.ts）与识别整合（identify.ts）。
 * 用例覆盖：真实 Skill 布局 / 大小写反例 / manifest 双语义 / `.claude-plugin` 归父目录。
 */

import { describe, expect, it } from 'vitest';

import { parentDir, probeTree } from './probe.ts';
import type { TreeEntry } from './types.ts';

function entries(paths: Array<string | [string, 'blob' | 'tree']>): TreeEntry[] {
  return paths.map((p) =>
    typeof p === 'string'
      ? { path: p, type: 'blob' as const, sha: `sha-${p}` }
      : { path: p[0], type: p[1], sha: `sha-${p[0]}` },
  );
}

describe('probeTree 结构探针', () => {
  it('真实 Skill 布局：`<dir>/SKILL.md` → skill-doc，根为所在目录', () => {
    const pieces = probeTree(entries(['skills/pdf/SKILL.md', 'README.md']));
    expect(pieces).toEqual([
      { piece: 'skill-doc', path: 'skills/pdf/SKILL.md', root: 'skills/pdf' },
    ]);
  });

  it('反例：小写 `skill.md` 不算（规格 §2.2 大小写敏感）；`.MD` 变体同样不算', () => {
    const pieces = probeTree(entries(['skills/x/skill.md', 'skills/y/Skill.md', 'a/DESIGN.MD']));
    expect(pieces).toEqual([]);
  });

  it('仓根 SKILL.md → 资产根为空串', () => {
    expect(probeTree(entries(['SKILL.md']))).toEqual([
      { piece: 'skill-doc', path: 'SKILL.md', root: '' },
    ]);
  });

  it('tokens 结构件：design-tokens.json / tokens.json / tokens.css / tailwind-v4.css / tailwind.config.*', () => {
    const pieces = probeTree(
      entries([
        'design-systems/a/design-tokens.json',
        'src/i18n/lang/en/tokens.json',
        'design-systems/a/tokens.css',
        'design-systems/a/tailwind-v4.css',
        'design-systems/b/tailwind.config.ts',
        'design-systems/b/tailwind.config.cjs',
      ]),
    );
    expect(pieces.map((p) => [p.piece, p.path, p.root])).toEqual([
      ['tokens-file', 'design-systems/a/design-tokens.json', 'design-systems/a'],
      ['tokens-file', 'design-systems/a/tailwind-v4.css', 'design-systems/a'],
      ['tokens-file', 'design-systems/a/tokens.css', 'design-systems/a'],
      ['tokens-file', 'design-systems/b/tailwind.config.cjs', 'design-systems/b'],
      ['tokens-file', 'design-systems/b/tailwind.config.ts', 'design-systems/b'],
      ['tokens-file', 'src/i18n/lang/en/tokens.json', 'src/i18n/lang/en'],
    ]);
  });

  it('plugin 清单：`.claude-plugin/plugin.json` 归其父目录；`plugin.json` 归所在目录', () => {
    const pieces = probeTree(
      entries([
        '.claude-plugin/plugin.json',
        'plugins/foo/plugin.json',
        'plugins/foo/.claude-plugin/plugin.json',
      ]),
    );
    expect(pieces).toEqual([
      { piece: 'plugin-manifest', path: '.claude-plugin/plugin.json', root: '' },
      {
        piece: 'plugin-manifest',
        path: 'plugins/foo/.claude-plugin/plugin.json',
        root: 'plugins/foo',
      },
      { piece: 'plugin-manifest', path: 'plugins/foo/plugin.json', root: 'plugins/foo' },
    ]);
  });

  it('marketplace.json / package.json / template.json / manifest.json / .mcp.json 各归其类', () => {
    const pieces = probeTree(
      entries([
        '.claude-plugin/marketplace.json',
        'package.json',
        'templates/x/template.json',
        'design-systems/a/manifest.json',
        'plugins/foo/.mcp.json',
      ]),
    );
    expect(pieces.map((p) => [p.piece, p.root])).toEqual([
      ['marketplace-manifest', ''],
      ['manifest-json', 'design-systems/a'],
      ['package-json', ''],
      ['mcp-json', 'plugins/foo'],
      ['template-manifest', 'templates/x'],
    ]);
  });

  it('preview/examples 目录（type=tree）→ 根为父目录', () => {
    const pieces = probeTree(
      entries([
        ['design-systems/a/preview', 'tree'],
        ['design-systems/a/preview/colors.html', 'blob'],
        ['templates/x/examples', 'tree'],
      ]),
    );
    expect(pieces).toEqual([
      { piece: 'preview-dir', path: 'design-systems/a/preview', root: 'design-systems/a' },
      { piece: 'examples-dir', path: 'templates/x/examples', root: 'templates/x' },
    ]);
  });

  it('输出按路径字典序稳定（ODS 可复现前提）', () => {
    const a = probeTree(entries(['b/SKILL.md', 'a/SKILL.md', 'c/plugin.json']));
    const b = probeTree(entries(['c/plugin.json', 'a/SKILL.md', 'b/SKILL.md']));
    expect(a).toEqual(b);
    expect(a.map((p) => p.path)).toEqual(['a/SKILL.md', 'b/SKILL.md', 'c/plugin.json']);
  });

  it('同名目录不算文件命中（目录不能当 SKILL.md 用）', () => {
    expect(probeTree(entries([['skills/SKILL.md', 'tree']]))).toEqual([]);
  });
});

describe('parentDir', () => {
  it('取父目录（仓根为空串）', () => {
    expect(parentDir('a/b/c.txt')).toBe('a/b');
    expect(parentDir('c.txt')).toBe('');
    expect(parentDir('a/b/')).toBe('a');
  });
});
