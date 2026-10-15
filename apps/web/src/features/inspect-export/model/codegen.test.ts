/**
 * F6 代码生成器规格（C15 检查态与 F6 同源）。
 *
 * 断言：
 * - 固定节点夹具的两档输出**逐字符稳定**（内联快照可评审，确定性 = 无随机/无时间）；
 * - 令牌命中 → `var(--dfg-design-…)` + 原始值回退；未命中 → 原始值 + 回退提示；
 * - 令牌反查按「同值取字典序最小路径」（别名链不改变结果，结果可复现）。
 */

import type { ScenePage, TokenSet } from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import {
  INSPECT_IDS,
  inspectPage,
  inspectTokens,
  TOKEN_VALUES,
  UNBOUND_FILL,
} from '../testing/fixtures';
import { generateCode, generateCss, generateReact } from './codegen';
import { bindTokenValue, designTokenCssVar } from './tokens-bridge';

describe('designTokenCssVar（令牌路径 → CSS 变量）', () => {
  it('点分路径转连字符并带 --dfg-design- 前缀（不与 @dforge/ui 令牌撞名）', () => {
    expect(designTokenCssVar('color.brand')).toBe('--dfg-design-color-brand');
    expect(designTokenCssVar('radius.card')).toBe('--dfg-design-radius-card');
    expect(designTokenCssVar('space.gap.large')).toBe('--dfg-design-space-gap-large');
  });
});

describe('bindTokenValue（值 → 令牌反查）', () => {
  const tokens: TokenSet = inspectTokens();

  it('颜色命中：给出令牌路径 + CSS 变量 + var() 表达式（带原始值回退）', () => {
    const binding = bindTokenValue(tokens, TOKEN_VALUES.brand);
    expect(binding.tokenPath).toBe('color.brand');
    expect(binding.cssVar).toBe('--dfg-design-color-brand');
    expect(binding.expression).toBe(`var(--dfg-design-color-brand, ${TOKEN_VALUES.brand})`);
  });

  it('尺寸命中：带单位的字面值可与无单位令牌值对上（8px ↔ radius.card=8）', () => {
    const binding = bindTokenValue(tokens, '8px');
    expect(binding.tokenPath).toBe('radius.card');
    expect(binding.expression).toBe('var(--dfg-design-radius-card, 8px)');
  });

  it('大小写不敏感（#0D99FF 命中 #0d99ff 令牌）', () => {
    expect(bindTokenValue(tokens, '#0D99FF').tokenPath).toBe('color.brand');
  });

  it('同值多令牌：取字典序最小路径（别名不改变结果）', () => {
    // color.brand 与 color.brandAlias 同值（别名链）→ 取 color.brand
    expect(bindTokenValue(tokens, TOKEN_VALUES.brand).tokenPath).toBe('color.brand');
  });

  it('未命中：表达式即原始值，tokenPath 为 null', () => {
    const binding = bindTokenValue(tokens, UNBOUND_FILL);
    expect(binding.tokenPath).toBeNull();
    expect(binding.cssVar).toBeNull();
    expect(binding.expression).toBe(UNBOUND_FILL);
  });
});

describe('generateCss（CSS 档）', () => {
  const page: ScenePage = inspectPage();
  const tokens = inspectTokens();

  it('固定夹具输出稳定快照（令牌命中走 var()）', () => {
    const generated = generateCss(page, INSPECT_IDS.card, { tokens });
    expect(generated.tier).toBe('css');
    expect(generated.language).toBe('css');
    expect(generated.code).toMatchInlineSnapshot(`
      "/* 卡片 (card) */
      .df-node-card {
        position: absolute;
        left: 24px;
        top: 32px;
        width: 240px;
        height: 160px;
        background: var(--dfg-design-color-brand, #0d99ff); /* color.brand */
        border-radius: var(--dfg-design-radius-card, 8px); /* radius.card */
      }
      "
    `);
    expect(generated.unbound).toBe(0);
    expect(generated.notes.map((note) => note.id)).toEqual(['background', 'border-radius']);
  });

  it('未绑定令牌：输出原始值 + 回退提示注释，notes 标记未绑定', () => {
    const generated = generateCss(page, INSPECT_IDS.plain, { tokens });
    expect(generated.code).toContain(`background: ${UNBOUND_FILL}; /* 未绑定令牌 */`);
    expect(generated.unbound).toBe(1);
    const note = generated.notes.find((item) => item.id === 'background');
    expect(note?.binding.tokenPath).toBeNull();
    expect(note?.binding.raw).toBe(UNBOUND_FILL);
  });

  it('文本节点：字号/字重/行高/对齐/字色进代码', () => {
    const generated = generateCss(page, INSPECT_IDS.title, { tokens });
    expect(generated.code).toContain('font-family: "Noto Sans SC";');
    expect(generated.code).toContain('font-size: 16px;');
    expect(generated.code).toContain('font-weight: 500;');
    expect(generated.code).toContain('line-height: 1.4;');
    expect(generated.code).toContain('text-align: left;');
    expect(generated.code).toContain('color: #000000; /* 未绑定令牌 */'); // guard-tokens:allow 引擎文本默认填充（文档真值）
  });

  it('确定性：同一输入两次生成逐字符相同', () => {
    const first = generateCss(page, INSPECT_IDS.card, { tokens });
    const second = generateCss(page, INSPECT_IDS.card, { tokens });
    expect(second.code).toBe(first.code);
    expect(second.notes).toEqual(first.notes);
  });

  it('节点不存在 → 空代码（不抛错，面板按空态渲染）', () => {
    const generated = generateCss(page, 'missing', { tokens });
    expect(generated.code).toBe('');
    expect(generated.notes).toEqual([]);
  });

  it('未给令牌集：一切走原始值（不误标命中）', () => {
    const generated = generateCss(page, INSPECT_IDS.card);
    expect(generated.code).toContain(`background: ${TOKEN_VALUES.brand};`);
    expect(generated.unbound).toBeGreaterThan(0);
  });
});

describe('generateReact（React 档）', () => {
  const page: ScenePage = inspectPage();
  const tokens = inspectTokens();

  it('固定夹具输出稳定快照（style 对象 + 令牌 var()）', () => {
    const generated = generateReact(page, INSPECT_IDS.card, { tokens });
    expect(generated.tier).toBe('react');
    expect(generated.language).toBe('tsx');
    expect(generated.code).toMatchInlineSnapshot(`
      "export function DesignNode() {
        return (
          <div
            style={{
              position: 'absolute',
              left: 24,
              top: 32,
              width: 240,
              height: 160,
              background: 'var(--dfg-design-color-brand, #0d99ff)', // color.brand
              borderRadius: 'var(--dfg-design-radius-card, 8px)', // radius.card
            }}
          />
        );
      }
      "
    `);
  });

  it('文本节点：渲染文本内容与排版样式', () => {
    const generated = generateReact(page, INSPECT_IDS.title, { tokens });
    expect(generated.code).toContain('<span');
    expect(generated.code).toContain('设界 DesignForge');
    expect(generated.code).toContain('fontSize: 16');
    expect(generated.code).toContain("fontFamily: 'Noto Sans SC'");
    expect(generated.code).toContain('// 未绑定令牌');
  });

  it('两档共享同一份属性投影（同一节点的令牌命中集合一致）', () => {
    const css = generateCss(page, INSPECT_IDS.card, { tokens });
    const react = generateReact(page, INSPECT_IDS.card, { tokens });
    expect(react.notes).toEqual(css.notes);
  });
});

describe('generateCode（档位分派）', () => {
  const page: ScenePage = inspectPage();

  it('按档位返回对应语言', () => {
    expect(generateCode(page, INSPECT_IDS.card, 'css', { tokens: inspectTokens() }).language).toBe(
      'css',
    );
    expect(
      generateCode(page, INSPECT_IDS.card, 'react', { tokens: inspectTokens() }).language,
    ).toBe('tsx');
  });
});
