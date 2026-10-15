/**
 * DTCG token 解析测试（规格 §2.4：形态校验 + i18n 词表反例必须丢弃）。
 *
 * 反例取自真实样本 `tokens-studio/figma-plugin`（8 个 tokens.json 全是 i18n 词表）。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseTokensDocument } from './tokens.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'parse');
const read = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

describe('parseTokensDocument', () => {
  it('DTCG 形态：数 $value 节点，识别 $type', () => {
    const result = parseTokensDocument('tokens/color.json', read('dtcg-tokens.json'));
    expect(result.isDtcg).toBe(true);
    expect(result.isWordlist).toBe(false);
    expect(result.discardedByPath).toBe(false);
    expect(result.tokenCount).toBe(4);
    expect(result.types).toContain('color');
  });

  it('i18n 路径的 token 文件直接丢弃（规格 §2.4 反例，研究 #4 §3.4 实测）', () => {
    const result = parseTokensDocument(
      'packages/tokens-studio-for-figma/src/i18n/lang/en/tokens.json',
      read('i18n-tokens.json'),
    );
    expect(result.discardedByPath).toBe(true);
    expect(result.isWordlist).toBe(true);
    expect(result.isDtcg).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('i18n-path-discarded');
  });

  it('词表形态（纯字符串映射，无 $value/$type）→ 丢弃，即便路径不在 i18n 下', () => {
    const wordlist = JSON.stringify({ types: { Color: 'Color', Sizing: 'Sizing' } });
    const result = parseTokensDocument('tokens.json', wordlist);
    expect(result.isWordlist).toBe(true);
    expect(result.isDtcg).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('wordlist-shape-discarded');
  });

  it('tokens.css / tailwind-v4.css：CSS 变量/主题块形态', () => {
    const css = read('tokens.css');
    const result = parseTokensDocument('styles/tokens.css', css);
    expect(result.isCssTheme).toBe(true);
    expect(result.tokenCount).toBe(3);
    const tailwind = parseTokensDocument(
      'styles/tailwind-v4.css',
      '@import "tailwindcss";\n@theme {\n  --color-brand: #0af;\n  --radius-card: 12px;\n}\n',
    );
    expect(tailwind.isCssTheme).toBe(true);
    expect(tailwind.tokenCount).toBe(2);
  });

  it('普通 JSON（无 token 形态也无词表形态）→ 明确报 unknown-shape', () => {
    const result = parseTokensDocument('data/tokens.json', '{"version": 2, "count": 10}');
    expect(result.isDtcg).toBe(false);
    expect(result.isWordlist).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('unknown-shape');
  });

  it('非 JSON 非 CSS 文本（如 markdown）→ unknown-shape，不抛异常', () => {
    const result = parseTokensDocument('DESIGN.md', '# 设计说明\n\n正文。\n');
    expect(result.issues.map((issue) => issue.code)).toContain('unknown-shape');
  });
});
