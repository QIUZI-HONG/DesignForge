/**
 * SKILL.md frontmatter 解析测试（规格 §2.2 内容校验口径）。
 *
 * 夹具取自真实采集样本形态（折叠标量 `>`、行内/块式列表、带冒号的引号串、嵌套 metadata），
 * 断言「解析出的字段」这一外部行为，不断言内部实现。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from './frontmatter.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'parse');

describe('parseFrontmatter（YAML 子集，零依赖）', () => {
  it('真实样本：折叠标量 description + 引号串 + 行内列表', () => {
    const text = readFileSync(join(FIXTURES, 'SKILL.md'), 'utf8');
    const result = parseFrontmatter(text);
    expect(result.hasBlock).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.data.name).toBe('slides-helper');
    expect(result.data.description).toBe(
      'Build slide decks from a brief. Use when the user asks for PPT, deck, or slides.',
    );
    expect(result.data.version).toBe('0.3.0');
    expect(result.data.tags).toEqual(['slides', 'ppt']);
    expect(result.data.triggers).toEqual(['PPT', '幻灯片']);
    expect(result.data.license).toBe('MIT');
    expect(result.body.trimStart().startsWith('# Slides Helper')).toBe(true);
  });

  it('无 frontmatter：hasBlock=false，正文原样返回（不报假错）', () => {
    const result = parseFrontmatter('# 只有正文\n\n没有 frontmatter 的样本。\n');
    expect(result.hasBlock).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.data.name).toBeNull();
    expect(result.body).toBe('# 只有正文\n\n没有 frontmatter 的样本。\n');
    expect(result.issues.map((issue) => issue.code)).toEqual(['no-frontmatter']);
  });

  it('未闭合块 → unterminated-block（正文按全文处理，不吞内容）', () => {
    const result = parseFrontmatter('---\nname: broken\ndescription: 没有收尾分隔符\n');
    expect(result.hasBlock).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('unterminated-block');
  });

  it('块式列表与字面块标量 | 、行内注释、带冒号的值', () => {
    const text = [
      '---',
      'name: "quoted: name"',
      'description: |',
      '  第一行',
      '  第二行',
      'allowed-tools:',
      '  - Read',
      '  - Write # 行尾注释',
      'metadata:',
      '  author: acme',
      '  homepage: https://example.com',
      '---',
      'body',
      '',
    ].join('\n');
    const result = parseFrontmatter(text);
    expect(result.ok).toBe(true);
    expect(result.data.name).toBe('quoted: name');
    expect(result.data.description).toBe('第一行\n第二行');
    expect(result.data.allowedTools).toEqual(['Read', 'Write']);
    expect(result.data.extraKeys).toContain('metadata');
    expect(result.body.trim()).toBe('body');
  });

  it('BOM 与 CRLF 容忍（去 BOM、归一换行）', () => {
    const text = '\uFEFF---\r\nname: crlf-kit\r\ndescription: 换行符归一\r\n---\r\n正文\r\n';
    const result = parseFrontmatter(text);
    expect(result.data.name).toBe('crlf-kit');
    expect(result.data.description).toBe('换行符归一');
    expect(result.body).toContain('正文');
  });

  it('正文统计用于「纯清单（redirect）型」判定（规格 §2.2）', () => {
    const linkList =
      '---\nname: redirect\ndescription: 仅罗列链接\n---\n- [A](https://a.example)\n- [B](https://b.example)\n';
    const result = parseFrontmatter(linkList);
    expect(result.bodyStats.nonEmptyLines).toBe(2);
    expect(result.bodyStats.linkRatio).toBe(1);
    const real = '---\nname: real\ndescription: 真技能\n---\n步骤一：收集信息\n步骤二：产出结果\n';
    expect(parseFrontmatter(real).bodyStats.linkRatio).toBe(0);
  });

  it('空 frontmatter 块 → empty-frontmatter（可入库但不计规范分）', () => {
    const result = parseFrontmatter('---\n---\n正文\n');
    expect(result.ok).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toContain('empty-frontmatter');
    expect(result.data.name).toBeNull();
  });

  it('嵌套值不猜测：仅记录键名（extraKeys），不下发错误结构', () => {
    const text = '---\nname: nested\ndescription: 有嵌套\nmetadata:\n  a:\n    b: c\n---\n正文\n';
    const result = parseFrontmatter(text);
    expect(result.ok).toBe(true);
    expect(result.data.extraKeys).toEqual(['metadata']);
    expect(result.data.name).toBe('nested');
  });
});
