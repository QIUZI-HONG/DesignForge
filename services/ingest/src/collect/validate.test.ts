/**
 * 内容校验测试（规格 §2：防纯文件名误报的第二级）。
 *
 * 正反例均取自真实世界形态（研究 #4 实测）：
 *  - 真 Skill frontmatter（含 `od:` 命名空间与 license 字段）；
 *  - `tokens-studio/figma-plugin` 的 8 个 i18n `tokens.json` 反例；
 *  - open-design 设计系统 manifest 与 Figma 插件 manifest 的区分；
 *  - `beautiful-html-templates` 的 template.json（身份型清单，无条目字段）。
 */

import { describe, expect, it } from 'vitest';

import {
  inspectTokensCss,
  inspectTokensJson,
  isI18nPath,
  parseFrontmatter,
  validateDesignSystemManifest,
  validateMarketplaceManifest,
  validatePluginManifest,
  validateSkillDoc,
  validateTemplateManifest,
} from './validate.ts';

/** 真实 SKILL.md 样本（anthropics/skills·skills/pdf，公开描述性文本）。 */
const REAL_SKILL_MD = `---
name: pdf
description: Use this skill whenever the user wants to do anything with PDF files. This includes reading or extracting text/tables from PDFs, combining or merging multiple PDFs into one, splitting PDFs apart, rotating pages, adding watermarks, creating new PDFs, filling PDF forms, encrypting/decrypting PDFs, extracting images, and OCR on scanned PDFs to make them searchable. If the user mentions a .pdf file or asks to produce one, use this skill.
license: Proprietary. LICENSE.txt has complete terms
---

# PDF Processing Guide

## Overview

This guide covers essential PDF processing operations using Python libraries and command-line tools.
For advanced features, JavaScript libraries, and detailed examples, see REFERENCE.md.

## Quick Start

\`\`\`python
from pypdf import PdfReader, PdfWriter
reader = PdfReader("document.pdf")
\`\`\`
`;

describe('parseFrontmatter 最小 YAML 子集', () => {
  it('解析真实 SKILL.md：name/description/license 齐全', () => {
    const fm = parseFrontmatter(REAL_SKILL_MD);
    expect(fm.parsed).toBe(true);
    expect(fm.data.name).toBe('pdf');
    expect(fm.data.license).toBe('Proprietary. LICENSE.txt has complete terms');
    expect(String(fm.data.description)).toContain('PDF files');
    expect(fm.body.trimStart().startsWith('# PDF Processing Guide')).toBe(true);
  });

  it('解析嵌套 `od:` 块与列表、引号、块标量、注释', () => {
    const fm = parseFrontmatter(`---
name: "web-artifacts-builder"
description: >
  多行折叠描述
  第二行
tags:
  - 设计
  - 前端
od:
  mode: design-system
  upstream: "https://github.com/coreyhaines31/marketingskills"
# 这是注释
version: 1.2.0
---

正文内容足够长以通过校验。
`);
    expect(fm.parsed).toBe(true);
    expect(fm.data.name).toBe('web-artifacts-builder');
    expect(fm.data.description).toBe('多行折叠描述 第二行');
    expect(fm.data.tags).toEqual(['设计', '前端']);
    expect(fm.data.od).toEqual({
      mode: 'design-system',
      upstream: 'https://github.com/coreyhaines31/marketingskills',
    });
    expect(fm.data.version).toBe('1.2.0');
  });

  it('反例：无 frontmatter / 未闭合 frontmatter 均判 false', () => {
    expect(parseFrontmatter('# 标题\n正文').parsed).toBe(false);
    expect(parseFrontmatter('---\nname: x\n没有闭合').parsed).toBe(false);
  });

  it('支持 BOM 开头（正文规范化：去 BOM）', () => {
    const fm = parseFrontmatter(`\uFEFF---\nname: x\ndescription: y\n---\n\n正文`);
    expect(fm.parsed).toBe(true);
    expect(fm.data.name).toBe('x');
  });
});

describe('validateSkillDoc Skill 内容校验（规格 §2.2）', () => {
  it('真 Skill：合规 ok，附声明许可', () => {
    const v = validateSkillDoc(REAL_SKILL_MD);
    expect(v.compliance).toBe('ok');
    expect(v.name).toBe('pdf');
    expect(v.declaredLicense).toBe('Proprietary. LICENSE.txt has complete terms');
  });

  it('无 frontmatter 但正文充实 → non-compliant（可入库、不计规范分）', () => {
    const body = '这是一段足够长的技能正文。'.repeat(30);
    const v = validateSkillDoc(body);
    expect(v.compliance).toBe('non-compliant');
    expect(v.reasons.join()).toContain('frontmatter');
  });

  it('反例：无 frontmatter 且正文 <144 字节 → suspect（种子最小值口径）', () => {
    const v = validateSkillDoc('太短了');
    expect(v.compliance).toBe('suspect');
  });

  it('反例：纯链接清单正文（redirect 型）→ rejected', () => {
    const v = validateSkillDoc(`---
name: redirect
description: see elsewhere
---

- [A](https://example.com/a)
- [B](https://example.com/b)
- [C](https://example.com/c)
`);
    expect(v.compliance).toBe('rejected');
    expect(v.reasons.join()).toContain('链接清单');
  });

  it('缺 name 或缺 description → non-compliant', () => {
    const noName = validateSkillDoc(`---\ndescription: 只有描述\n---\n\n${'正文'.repeat(100)}`);
    expect(noName.compliance).toBe('non-compliant');
    const noDesc = validateSkillDoc(`---\nname: x\n---\n\n${'正文'.repeat(100)}`);
    expect(noDesc.compliance).toBe('non-compliant');
  });

  it('字节数按 UTF-8 计（中文字符 3 字节）', () => {
    const v = validateSkillDoc('中文正文：字节数按 UTF-8 计算。'.repeat(10));
    expect(v.bodyBytes).toBe(
      Buffer.byteLength('中文正文：字节数按 UTF-8 计算。'.repeat(10), 'utf8'),
    );
  });
});

describe('tokens 形态校验（规格 §2.4 反例必须实现）', () => {
  it('DTCG 形态（$value/$type）→ 通过', () => {
    const v = inspectTokensJson(
      JSON.stringify({ color: { primary: { $value: '#0F1B3D', $type: 'color' } } }),
    );
    expect(v.shape).toBe('dtcg');
    expect(v.ok).toBe(true);
  });

  it('反例：i18n 词表形态（纯字符串映射）→ 丢弃', () => {
    const v = inspectTokensJson(JSON.stringify({ 'app.title': '标题', 'app.ok': '确定' }));
    expect(v.shape).toBe('wordlist');
    expect(v.ok).toBe(false);
  });

  it('反例：Tokens Studio 旧格式（value/type 无 $ 前缀）→ 不按 DTCG 通过', () => {
    const v = inspectTokensJson(
      JSON.stringify({ themes: { light: { theme: { bg: { value: '#fff', type: 'color' } } } } }),
    );
    expect(v.shape).toBe('legacy-studio');
    expect(v.ok).toBe(false);
  });

  it('反例：非法 JSON → invalid', () => {
    expect(inspectTokensJson('{not json').shape).toBe('invalid');
  });

  it('i18n 路径识别（规格 §2.4：i18n/langs/locale 直接丢弃）', () => {
    expect(isI18nPath('src/i18n/lang/en/tokens.json')).toBe(true);
    expect(isI18nPath('packages/x/locale/zh/tokens.json')).toBe(true);
    expect(isI18nPath('a/langs/de/tokens.json')).toBe(true);
    expect(isI18nPath('design-systems/agentic/design-tokens.json')).toBe(false);
    expect(isI18nPath('token-transformer/tokens.json')).toBe(false);
  });

  it('tokens.css / tailwind-v4.css：CSS 变量或 @theme 主题块 → 通过', () => {
    expect(inspectTokensCss(':root {\n  --color-bg: #fff;\n  --space-4: 16px;\n}').ok).toBe(true);
    expect(inspectTokensCss('@theme {\n  --color-brand: oklch(0.7 0.1 200);\n}').ok).toBe(true);
    expect(inspectTokensCss('body { color: red; }').ok).toBe(false);
  });
});

describe('validatePluginManifest 插件清单校验（规格 §2.3）', () => {
  it('含 name 且声明 skills 条目 → 通过', () => {
    const v = validatePluginManifest(
      JSON.stringify({ name: 'document-skills', source: './', skills: ['./skills/pdf'] }),
      '.claude-plugin/plugin.json',
    );
    expect(v.ok).toBe(true);
    expect(v.name).toBe('document-skills');
    expect(v.declares).toContain('skills');
  });

  it('仅有 name、无条目字段 → 依赖同目录/同仓 Skill 佐证（此处判 notDeclared，由识别层合并）', () => {
    const v = validatePluginManifest(JSON.stringify({ name: 'bare' }), 'plugin.json');
    expect(v.ok).toBe(false);
    expect(v.declares).toEqual([]);
  });

  it('反例：非法 JSON / 缺 name → 不通过', () => {
    expect(validatePluginManifest('{', 'plugin.json').ok).toBe(false);
    expect(validatePluginManifest(JSON.stringify({ skills: [] }), 'plugin.json').ok).toBe(false);
  });
});

describe('validateMarketplaceManifest 市场清单（规格 §2.3：source 指向本仓才算）', () => {
  it('相对 source（./…）→ 指向本仓，计入 selfReferencing', () => {
    const v = validateMarketplaceManifest(
      JSON.stringify({
        name: 'anthropic-agent-skills',
        plugins: [
          { name: 'document-skills', source: './', skills: ['./skills/pdf'] },
          { name: 'example-skills', source: './' },
        ],
      }),
      'anthropics/skills',
    );
    expect(v.ok).toBe(true);
    expect(v.entries).toBe(2);
    expect(v.selfReferencing).toBe(2);
  });

  it('反例：github: 指向他仓 → 不构成本仓插件', () => {
    const v = validateMarketplaceManifest(
      JSON.stringify({ plugins: [{ name: 'x', source: 'github:other/repo@main/path' }] }),
      'anthropics/skills',
    );
    expect(v.selfReferencing).toBe(0);
    expect(v.ok).toBe(false);
  });

  it('github:<本仓> 视为自指', () => {
    const v = validateMarketplaceManifest(
      JSON.stringify({ plugins: [{ name: 'x', source: 'github:anthropics/skills@main' }] }),
      'anthropics/skills',
    );
    expect(v.selfReferencing).toBe(1);
    expect(v.ok).toBe(true);
  });
});

describe('validateDesignSystemManifest（manifest.json 双语义分流）', () => {
  it('open-design 设计系统 manifest → 是设计系统清单，读 source.type', () => {
    const v = validateDesignSystemManifest(
      JSON.stringify({
        schemaVersion: 'od-design-system-project/v1',
        id: 'agentic',
        name: 'Agentic',
        source: { type: 'bundled', origin: 'OpenDesign curated bundled fixture' },
        files: { design: 'DESIGN.md', tokens: 'tokens.css', designTokens: 'design-tokens.json' },
        importMode: 'normalized',
      }),
    );
    expect(v.ok).toBe(true);
    expect(v.sourceType).toBe('bundled');
    expect(v.name).toBe('Agentic');
  });

  it('反例：Figma 插件 manifest（api/main/editorType）不是设计系统清单', () => {
    const v = validateDesignSystemManifest(
      JSON.stringify({
        name: 'Tokens Studio for Figma',
        id: '843461159747178978',
        api: '1.0.0',
        main: 'dist/code.js',
        ui: 'dist/index.html',
        editorType: ['figma'],
        networkAccess: { allowedDomains: ['*'] },
      }),
    );
    expect(v.ok).toBe(false);
  });
});

describe('validateTemplateManifest 模板清单', () => {
  it('显式条目清单（entries/files/templates）→ kind=entries，条目路径可用', () => {
    const v = validateTemplateManifest(
      JSON.stringify({ name: 'deck', templates: ['templates/a/template.html'] }),
    );
    expect(v.ok).toBe(true);
    expect(v.kind).toBe('entries');
    expect(v.entryPaths).toEqual(['templates/a/template.html']);
  });

  it('身份型清单（beautiful-html-templates 形态：slug/name/tagline/palette，无条目字段）→ kind=identity', () => {
    const v = validateTemplateManifest(
      JSON.stringify({
        slug: '8-bit-orbit',
        name: '8-Bit Orbit',
        tagline: 'Pixel-art neon arcade aesthetic on a deep navy void.',
        palette: { neon_pink: '#F0A6CA', void: '#0A0E27' },
        typography: { display: 'Tektur' },
        slide_count: 10,
      }),
    );
    expect(v.ok).toBe(true);
    expect(v.kind).toBe('identity');
    expect(v.name).toBe('8-Bit Orbit');
  });

  it('反例：既不声明身份也无条目（普通 JSON）→ 不通过', () => {
    expect(validateTemplateManifest(JSON.stringify({ hello: 'world' })).ok).toBe(false);
    expect(validateTemplateManifest('{').ok).toBe(false);
  });
});
