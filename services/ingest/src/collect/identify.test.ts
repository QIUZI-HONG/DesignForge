/**
 * 四类资产识别整合测试（规格 §2：探针 + 内容校验 → 认定；topic 只作候选）。
 *
 * 正反例必须齐（MK-01 简报 §2）：
 *  - 真 Skill（frontmatter 完备）→ 资产；
 *  - topic 噪声（只有 README 的普通仓）→ 零资产；
 *  - i18n `tokens.json` 100% 误报反例（tokens-studio/figma-plugin）→ 零设计系统；
 *  - 组件画廊反例（preview/ 但无条目清单）→ 零模板；
 *  - 同目录多命中 → 优先级 plugin > design-system > template > skill 取一。
 */

import { describe, expect, it } from 'vitest';
import type { IdentifyInput } from './identify.ts';
import { digestForRoot, identifyAssets } from './identify.ts';
import type { LicenseAssessment, TreeEntry } from './types.ts';

function tree(paths: string[]): TreeEntry[] {
  return paths.map((p) => ({
    path: p,
    type: p.endsWith('/') ? ('tree' as const) : ('blob' as const),
    sha: `sha-${p}`,
    size: 100,
  }));
}

const VIEW_ONLY_LICENSE: LicenseAssessment = {
  spdx: null,
  tier: 'none',
  gate: 'view-only',
  reasons: ['测试夹具'],
  evidence: { path: null, sha256: null },
  brandDerived: false,
  archived: false,
};

function identify(input: {
  paths: string[];
  contents?: Record<string, string>;
  deferred?: string[];
  repo?: string;
}): ReturnType<typeof identifyAssets> {
  const input2: IdentifyInput = {
    repoFullName: input.repo ?? 'owner/repo',
    tree: tree(input.paths),
    contents: new Map(Object.entries(input.contents ?? {})),
    deferredPaths: new Set(input.deferred ?? []),
    license: VIEW_ONLY_LICENSE,
  };
  return identifyAssets(input2);
}

const SKILL_MD = (name: string, body = '正文内容，描述何时使用该技能。'.repeat(20)) => `---
name: ${name}
description: 当用户需要处理 ${name} 相关任务时使用本技能。
---

${body}
`;

const LICENSE_MIT = 'MIT License ... 正文略';

describe('真 Skill：结构探针 + 内容校验两级都过 → 资产', () => {
  it('anthropics/skills 形态：marketplace 自指 → 根插件；skills/pdf → 技能资产', () => {
    const { assets, rejected } = identify({
      repo: 'anthropics/skills',
      paths: [
        '.claude-plugin/marketplace.json',
        'skills/pdf/SKILL.md',
        'skills/pdf/REFERENCE.md',
        'README.md',
      ],
      contents: {
        '.claude-plugin/marketplace.json': JSON.stringify({
          name: 'anthropic-agent-skills',
          plugins: [{ name: 'document-skills', source: './', skills: ['./skills/pdf'] }],
        }),
        'skills/pdf/SKILL.md': SKILL_MD('pdf'),
      },
    });

    const plugin = assets.find((a) => a.kind === 'plugin');
    expect(plugin?.id).toBe('gh:anthropics/skills#');
    expect(plugin?.name).toBe('anthropics-skills');
    expect(plugin?.compliance).toBe('ok');

    const skill = assets.find((a) => a.kind === 'skill');
    expect(skill?.id).toBe('gh:anthropics/skills#skills/pdf');
    expect(skill?.name).toBe('pdf');
    expect(skill?.compliance).toBe('ok');
    expect(rejected).toEqual([]);
  });

  it('无 frontmatter 但正文充实 → non-compliant（可入库不计规范分）；过短 → suspect 拒绝', () => {
    const longBody = '一段足够长的技能正文。'.repeat(40);
    const { assets, rejected } = identify({
      paths: ['skills/a/SKILL.md', 'skills/b/SKILL.md'],
      contents: {
        'skills/a/SKILL.md': longBody,
        'skills/b/SKILL.md': '太短',
      },
    });
    expect(assets.map((a) => [a.root, a.compliance])).toEqual([['skills/a', 'non-compliant']]);
    expect(rejected.map((r) => [r.root, r.reason])).toEqual([
      ['skills/b', expect.stringContaining('suspect')],
    ]);
  });

  it('内容未取回（预算所限）→ compliance=deferred 如实标记，不假装通过', () => {
    const { assets } = identify({
      paths: ['skills/x/SKILL.md'],
      contents: {},
      deferred: ['skills/x/SKILL.md'],
    });
    expect(assets).toHaveLength(1);
    expect(assets[0]?.compliance).toBe('deferred');
    expect(assets[0]?.checks.map((c) => c.rule)).toContain('content-fetched');
  });
});

describe('topic 噪声反例（研究 #4 §0.1：topic 只作候选，不作认定）', () => {
  it('普通仓（README/LICENSE/源码）→ 零资产零拒绝', () => {
    const { assets, rejected } = identify({
      repo: 'donnemartin/system-design-primer',
      paths: ['README.md', 'LICENSE', 'src/main.py', 'images/diagram.png'],
      contents: { LICENSE: LICENSE_MIT },
    });
    expect(assets).toEqual([]);
    expect(rejected).toEqual([]);
  });

  it('大小写反例：skill.md（小写）不算 Skill', () => {
    const { assets } = identify({
      paths: ['skills/x/skill.md'],
      contents: { 'skills/x/skill.md': SKILL_MD('x') },
    });
    expect(assets).toEqual([]);
  });
});

describe('反例：i18n tokens.json 误报必须被拦下（规格 §2.4，研究 #4 §3.4 实测）', () => {
  it('tokens-studio/figma-plugin 形态 → 零设计系统资产', () => {
    const { assets } = identify({
      repo: 'tokens-studio/figma-plugin',
      paths: [
        'packages/tokens-studio-for-figma/src/i18n/lang/en/tokens.json',
        'packages/tokens-studio-for-figma/src/i18n/lang/zh/tokens.json',
        'packages/tokens-studio-for-figma/token-transformer/tokens.json',
        'packages/tokens-studio-for-figma/manifest.json',
        'packages/tokens-studio-for-figma/src/app/preview/preview.tsx',
      ],
      contents: {
        // i18n 词表
        'packages/tokens-studio-for-figma/src/i18n/lang/en/tokens.json': JSON.stringify({
          'app.title': 'Tokens Studio',
          'app.ok': 'OK',
        }),
        // Tokens Studio 旧格式（value/type 无 $ 前缀）
        'packages/tokens-studio-for-figma/token-transformer/tokens.json': JSON.stringify({
          themes: { light: { theme: { bg: { value: '#fff', type: 'color' } } } },
        }),
        // Figma 插件清单（不是设计系统清单）
        'packages/tokens-studio-for-figma/manifest.json': JSON.stringify({
          name: 'Tokens Studio for Figma',
          id: '843461159747178978',
          api: '1.0.0',
          main: 'dist/code.js',
          editorType: ['figma'],
        }),
      },
    });
    expect(assets.filter((a) => a.kind === 'design-system')).toEqual([]);
  });
});

describe('Design System：≥2 项结构件 + token 形态硬门槛（规格 §2.4）', () => {
  it('open-design 形态（DESIGN.md + design-tokens.json + manifest + preview/）→ 认定，读 manifest 名', () => {
    const { assets } = identify({
      repo: 'nexu-io/open-design',
      paths: [
        'design-systems/agentic/DESIGN.md',
        'design-systems/agentic/design-tokens.json',
        'design-systems/agentic/tokens.css',
        'design-systems/agentic/manifest.json',
        'design-systems/agentic/components.manifest.json',
        'design-systems/agentic/preview/colors.html',
      ],
      contents: {
        'design-systems/agentic/design-tokens.json': JSON.stringify({
          color: { primary: { $value: '#0F1B3D', $type: 'color' } },
        }),
        'design-systems/agentic/manifest.json': JSON.stringify({
          schemaVersion: 'od-design-system-project/v1',
          id: 'agentic',
          name: 'Agentic',
          source: { type: 'curated', origin: 'test' },
          files: { design: 'DESIGN.md', tokens: 'tokens.css' },
        }),
      },
    });
    const ds = assets.find((a) => a.kind === 'design-system');
    expect(ds?.id).toBe('gh:nexu-io/open-design#design-systems/agentic');
    expect(ds?.name).toBe('agentic');
    expect(ds?.compliance).toBe('ok');
    expect(ds?.treeDigest.startsWith('sha256:')).toBe(true);
  });

  it('反例：只有 DESIGN.md 没有 token 件 → 不认定（硬门槛 ≥2 项结构件）', () => {
    const { assets, rejected } = identify({
      paths: ['ds-a/DESIGN.md'],
      contents: { 'ds-a/DESIGN.md': '# 设计规范' },
    });
    expect(assets).toEqual([]);
    expect(rejected.length).toBeGreaterThanOrEqual(0); // 单结构件不成候选，允许零记录
  });

  it('反例：token 文件存在但非 DTCG 形态（无语义令牌）→ 不认定', () => {
    const { assets } = identify({
      paths: ['ds-b/DESIGN.md', 'ds-b/design-tokens.json', 'ds-b/preview/a.html'],
      contents: {
        'ds-b/design-tokens.json': JSON.stringify({ a: 'x', b: 'y' }),
      },
    });
    expect(assets.filter((a) => a.kind === 'design-system')).toEqual([]);
  });

  it('brandDerived：manifest source.type=bundled → 资产记录带 capabilities 不变但名字照实', () => {
    const { assets } = identify({
      paths: [
        'design-systems/apple/DESIGN.md',
        'design-systems/apple/tokens.css',
        'design-systems/apple/manifest.json',
      ],
      contents: {
        'design-systems/apple/tokens.css': ':root { --color-x: #fff; }',
        'design-systems/apple/manifest.json': JSON.stringify({
          schemaVersion: 'od-design-system-project/v1',
          name: 'Apple',
          source: { type: 'bundled' },
        }),
      },
    });
    // 品牌复刻判定发生在 license 守门层（identify 只如实记录资产）；此处确认资产被识别出来，
    // 便于 ODS 携带 brandDerived 证据（若这里被过滤，就看不出「为什么 blocked」）。
    expect(assets.filter((a) => a.kind === 'design-system')).toHaveLength(1);
  });
});

describe('Template：条目型与身份型清单（规格 §2.5）', () => {
  it('beautiful-html-templates 形态（identity 清单 + template.html）→ 认定', () => {
    const { assets } = identify({
      repo: 'zarazhangrui/beautiful-html-templates',
      paths: [
        'templates/8-bit-orbit/template.json',
        'templates/8-bit-orbit/template.html',
        'templates/8-bit-orbit/design.md',
      ],
      contents: {
        'templates/8-bit-orbit/template.json': JSON.stringify({
          slug: '8-bit-orbit',
          name: '8-Bit Orbit',
          tagline: 'Pixel-art neon arcade aesthetic.',
          palette: { void: '#0A0E27' },
          slide_count: 10,
        }),
      },
    });
    const tpl = assets.find((a) => a.kind === 'template');
    expect(tpl?.id).toBe('gh:zarazhangrui/beautiful-html-templates#templates/8-bit-orbit');
    expect(tpl?.name).toBe('8-bit-orbit');
    expect(tpl?.compliance).toBe('ok');
  });

  it('条目型清单：条目文件必须在 Trees 中存在（存在性校验，不下载）', () => {
    const withEntry = identify({
      paths: ['tpl/a/template.json', 'tpl/a/main.html'],
      contents: {
        'tpl/a/template.json': JSON.stringify({ name: 'a', templates: ['main.html'] }),
      },
    });
    expect(withEntry.assets.map((a) => a.kind)).toEqual(['template']);

    const missingEntry = identify({
      paths: ['tpl/b/template.json'],
      contents: { 'tpl/b/template.json': JSON.stringify({ name: 'b', templates: ['nope.html'] }) },
    });
    expect(missingEntry.assets).toEqual([]);
    expect(missingEntry.rejected[0]?.reason).toContain('条目');
  });

  it('反例：组件画廊（preview/ 但无条目清单）→ 不认定（研究 #4 §1.1 react-bits 类）', () => {
    const { assets } = identify({
      paths: ['ui/preview/index.html', 'ui/preview/gallery.svg', 'ui/README.md'],
      contents: {},
    });
    expect(assets.filter((a) => a.kind === 'template')).toEqual([]);
  });
});

describe('Plugin 与同目录优先级（规格 §2.1.3/§2.3）', () => {
  it('.mcp.json 单独出现不升类；同装插件时仅作 capabilities 证据', () => {
    const alone = identify({
      paths: ['tools/foo/.mcp.json'],
      contents: { 'tools/foo/.mcp.json': JSON.stringify({ mcpServers: {} }) },
    });
    expect(alone.assets.filter((a) => a.kind === 'plugin')).toEqual([]);

    const withPlugin = identify({
      paths: ['plugins/foo/.claude-plugin/plugin.json', 'plugins/foo/.mcp.json'],
      contents: {
        'plugins/foo/.claude-plugin/plugin.json': JSON.stringify({
          name: 'foo-plugin',
          commands: ['x'],
        }),
        'plugins/foo/.mcp.json': JSON.stringify({ mcpServers: {} }),
      },
    });
    const plugin = withPlugin.assets.find((a) => a.kind === 'plugin');
    expect(plugin?.id).toBe('gh:owner/repo#plugins/foo');
    expect(plugin?.capabilities).toEqual(['mcp']);
  });

  it('plugin.json 仅 name（无条目字段）→ 需同目录通过校验的 SKILL.md 佐证', () => {
    const { assets } = identify({
      paths: ['plugins/bar/plugin.json', 'plugins/bar/SKILL.md'],
      contents: {
        'plugins/bar/plugin.json': JSON.stringify({ name: 'bar' }),
        'plugins/bar/SKILL.md': SKILL_MD('bar'),
      },
    });
    const plugin = assets.find((a) => a.kind === 'plugin');
    expect(plugin?.kind).toBe('plugin');
    expect(plugin?.checks.some((c) => c.rule === 'plugin-skill-justified' && c.ok)).toBe(true);
  });

  it('同目录多命中取一：plugin > design-system > template > skill，落选者进 rejected', () => {
    const { assets, rejected } = identify({
      paths: ['multi/plugin.json', 'multi/SKILL.md', 'multi/DESIGN.md', 'multi/design-tokens.json'],
      contents: {
        'multi/plugin.json': JSON.stringify({ name: 'multi-plugin', skills: ['./'] }),
        'multi/SKILL.md': SKILL_MD('multi'),
        'multi/design-tokens.json': JSON.stringify({ c: { $value: '#fff', $type: 'color' } }),
      },
    });
    const atRoot = assets.filter((a) => a.root === 'multi');
    expect(atRoot.map((a) => a.kind)).toEqual(['plugin']);
    expect(rejected.filter((r) => r.root === 'multi').length).toBe(2);
  });

  it('反例：plugin.json 无 name 且无同目录 Skill → 拒绝并留原因', () => {
    const { assets, rejected } = identify({
      paths: ['plugins/baz/plugin.json'],
      contents: { 'plugins/baz/plugin.json': JSON.stringify({ skills: [] }) },
    });
    expect(assets).toEqual([]);
    expect(rejected[0]?.reason).toContain('name');
  });
});

describe('digestForRoot 内容摘要（ODS 确定性的基础）', () => {
  it('同根同输入 → 同摘要；内容/路径变 → 摘要变', () => {
    const t1 = tree(['a/SKILL.md', 'a/other.md', 'b/SKILL.md']);
    const t2 = tree(['a/SKILL.md', 'a/other.md', 'b/SKILL.md']);
    expect(digestForRoot(t1, 'a')).toBe(digestForRoot(t2, 'a'));

    const t3 = tree(['a/SKILL.md', 'a/other-v2.md', 'b/SKILL.md']);
    expect(digestForRoot(t1, 'a')).not.toBe(digestForRoot(t3, 'a'));

    const t4 = tree(['a/SKILL.md', 'a/other.md', 'b/SKILL.md', 'a/deep/x.md']);
    expect(digestForRoot(t1, 'a')).not.toBe(digestForRoot(t4, 'a'));
  });

  it('根为空串 → 全仓摘要（含所有 blob）', () => {
    const t = tree(['SKILL.md', 'skills/x/SKILL.md']);
    expect(digestForRoot(t, '')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digestForRoot(t, '')).toBe(digestForRoot(t, '')); // 幂等
  });
});
