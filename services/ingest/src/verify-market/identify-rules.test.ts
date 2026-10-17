/**
 * 验证线 · 风险点 3：识别规则对抗（topic 噪声 / .mcp.json / i18n tokens / 组件画廊 /
 * 同目录多命中优先级 plugin > design-system > template > skill）。
 *
 * 全部为纯函数（`identifyAssets`）+ 夹具目录树，不触网。
 */

import { describe, expect, it } from 'vitest';
import { defaultViewOnlyLicense, identifyAssets } from '../collect/identify.ts';
import type { TreeEntry } from '../collect/types.ts';
import { isI18nPath } from '../collect/validate.ts';

const blob = (path: string, size = 200): TreeEntry => ({
  path,
  type: 'blob',
  sha: `sha-${path}`.padEnd(40, '0').slice(0, 40),
  size,
});
const dir = (path: string): TreeEntry => ({ path, type: 'tree', sha: 't'.repeat(40) });

const SKILL_DOC = `---\nname: demo-skill\ndescription: 演示用技能\n---\n\n${'正文段落。'.repeat(60)}`;
const TOKENS_CSS = ':root { --color-bg: #fff; --color-fg: #111; }';
const DESIGN_MD = '# Design System\n\n色彩与排版规范。';
const PLUGIN_JSON = JSON.stringify({ name: 'demo-plugin', version: '1.0.0' });
const TEMPLATE_JSON = JSON.stringify({ name: 'demo-template', templates: ['page.html'] });
const PAGE_HTML = '<html><body>t</body></html>';

interface Case {
  tree: TreeEntry[];
  contents: Record<string, string>;
  name?: string;
}

function identify(c: Case) {
  return identifyAssets({
    repoFullName: 'acme/valley',
    tree: c.tree,
    contents: new Map(Object.entries(c.contents)),
    deferredPaths: new Set(),
    license: defaultViewOnlyLicense(),
  });
}

describe('识别规则：负例（不得误认）', () => {
  it('.mcp.json 单独存在：不升类、不产出资产、也不进 rejected 噪声', () => {
    const r = identify({
      tree: [blob('.mcp.json')],
      contents: { '.mcp.json': '{"mcpServers":{"x":{}}}' },
    });
    expect(r.assets).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it('i18n tokens.json（i18n//langs//locale/ 三种路径）：直接丢弃并给出理由', () => {
    for (const path of ['i18n/tokens.json', 'langs/tokens.json', 'locale/zh/tokens.json']) {
      expect(isI18nPath(path)).toBe(true);
      const r = identify({
        tree: [blob(path), blob(path.replace('tokens.json', 'DESIGN.md'))],
        contents: {
          [path]: '{"hello":"你好"}',
          [path.replace('tokens.json', 'DESIGN.md')]: DESIGN_MD,
        },
      });
      expect(r.assets).toEqual([]);
      expect(r.rejected.some((x) => x.reason.includes('i18n'))).toBe(true);
    }
  });

  it('组件画廊（tokens.css + components/ 目录，无支持件）：硬门槛 ② 拦住，不认定', () => {
    const r = identify({
      tree: [blob('tokens.css'), dir('components'), blob('components/Button.tsx')],
      contents: { 'tokens.css': TOKENS_CSS },
    });
    expect(r.assets).toEqual([]);
    expect(r.rejected.some((x) => x.kind === 'design-system' && x.reason.includes('支持件'))).toBe(
      true,
    );
  });

  it('有 topic 无结构（token 文件未取回且无可信支持件时不得凭名字认定）', () => {
    // tokens.json 未取回（deferred）但无支持件 → supportPending 均 false → 硬门槛 ② 拒绝
    const r = identify({
      tree: [blob('tokens.json')],
      contents: {},
    });
    expect(r.assets).toEqual([]);
  });
});

describe('识别规则：正例（应认定，且优先级正确）', () => {
  it('tokens.css + preview/ 目录：设计系统成立（preview 为支持件）', () => {
    const r = identify({
      tree: [blob('tokens.css'), dir('preview')],
      contents: { 'tokens.css': TOKENS_CSS },
    });
    expect(r.assets.map((a) => [a.kind, a.compliance])).toEqual([['design-system', 'ok']]);
  });

  it('skill + .mcp.json 同根：skill 成立且 capabilities 追加 mcp', () => {
    const r = identify({
      tree: [blob('s/SKILL.md'), blob('s/.mcp.json')],
      contents: { 's/SKILL.md': SKILL_DOC, 's/.mcp.json': '{"mcpServers":{}}' },
    });
    expect(r.assets.map((a) => [a.kind, a.capabilities])).toEqual([['skill', ['mcp']]]);
  });

  it('同目录四命中共存：优先级 plugin > design-system > template > skill', () => {
    const TOKENS = blob('p/tokens.css');
    const DESIGN = blob('p/DESIGN.md');
    const TEMPLATE = blob('p/template.json');
    const HTML = blob('p/page.html');
    const SKILL = blob('p/SKILL.md');
    const tree = [blob('p/plugin.json'), TOKENS, DESIGN, TEMPLATE, HTML, SKILL];
    const contents = {
      'p/plugin.json': PLUGIN_JSON,
      'p/tokens.css': TOKENS_CSS,
      'p/DESIGN.md': DESIGN_MD,
      'p/template.json': TEMPLATE_JSON,
      'p/page.html': PAGE_HTML,
      'p/SKILL.md': SKILL_DOC,
    };
    const all = identify({ tree, contents });
    expect(all.assets.map((a) => a.kind)).toEqual(['plugin']);
    expect(new Set(all.rejected.map((x) => x.kind))).toEqual(
      new Set(['design-system', 'template', 'skill']),
    );

    const noPlugin = identify({ tree: [TOKENS, DESIGN, TEMPLATE, HTML, SKILL], contents });
    expect(noPlugin.assets.map((a) => a.kind)).toEqual(['design-system']);

    const noPluginNoDs = identify({ tree: [TEMPLATE, HTML, SKILL], contents });
    expect(noPluginNoDs.assets.map((a) => a.kind)).toEqual(['template']);
    expect(noPluginNoDs.rejected.map((x) => x.kind)).toEqual(['skill']);
  });

  it('template 条目文件在 Trees 中不存在 → 拒选（存在性校验，不臆造）', () => {
    const r = identify({
      tree: [blob('p/template.json'), blob('p/page.html')],
      contents: {
        'p/template.json': JSON.stringify({ name: 't', templates: ['missing.html'] }),
        'p/page.html': PAGE_HTML,
      },
    });
    expect(r.assets).toEqual([]);
    expect(r.rejected.some((x) => x.reason.includes('不存在'))).toBe(true);
  });
});
