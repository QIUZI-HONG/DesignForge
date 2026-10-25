/**
 * 对抗性验证 · 风险 7：代码生成确定性 + 令牌反查冲突
 *
 * 验证口径：
 * - 同输入两次生成**逐字节一致**（快照稳定；含 JSON 往返后仍一致）；
 * - 令牌反查在大小写 / 单位 / 别名 / 同值多令牌下**确定性选择**（字典序最小路径）；
 * - 未命中一律回退原始值并给「未绑定令牌」说明（不得静默丢掉提示）。
 */
import {
  createDocument,
  createPage,
  createRect,
  createText,
  type DesignDocument,
  type NodeId,
  solidPaint,
  type TokenSet,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { generateCode, generateCss, generateReact } from '@/features/inspect-export/model/codegen';
import { bindTokenValue, designTokenCssVar } from '@/features/inspect-export/model/tokens-bridge';

/** 颜色 + 尺寸 + 文本的矩形与文本节点。 */
function makePage() {
  const rect = createRect({
    id: 'n_card',
    name: '卡片',
    x: 24,
    y: 32,
    width: 240,
    height: 160,
    cornerRadius: 8,
    rotation: 15,
    opacity: 0.9,
    fills: [solidPaint('#0D99FF')],
    strokes: [{ paint: solidPaint('#0d99ff'), width: 1, align: 'inside' }],
  });
  const text = createText({
    id: 'n_title',
    name: '标题',
    x: 24,
    y: 32,
    width: 240,
    height: 24,
    text: {
      characters: '标题',
      fontFamily: 'Noto Sans SC',
      fontSize: 16,
      fontWeight: 500,
      lineHeight: 1.4,
      letterSpacing: 0.5,
      align: 'left',
      autoResize: 'none',
    },
  });
  const page = createPage({
    id: 'page_1',
    rootIds: ['n_card', 'n_title'],
    nodes: { n_card: rect, n_title: text },
  });
  const first = createDocument({ id: 'doc_1', pages: [page] }).pages[0];
  if (first === undefined) throw new Error('fixture: page_1 must exist');
}

/** 令牌集：含别名、同值多条、大小写差异、单位差异。 */
const TOKENS: TokenSet = {
  color: {
    $type: 'color',
    brand: { $value: '#0D99FF' },
    brandAlias: { $value: '{color.brand}' },
    brandLower: { $value: '#0d99ff' },
  },
  size: {
    $type: 'dimension',
    radius: { $value: '8px' },
    radiusNoUnit: { $value: '8' },
  },
  spacingUnitless: { $value: '16' },
  notMatching: { $value: '0.5rem' },
};

const page = makePage();

describe('代码生成 · 确定性', () => {
  it('CSS 档：同输入两次生成逐字节一致', () => {
    const first = generateCss(page, 'n_card', { tokens: TOKENS }).code;
    const second = generateCss(page, 'n_card', { tokens: TOKENS }).code;
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it('React 档：同输入两次生成逐字节一致', () => {
    const first = generateReact(page, 'n_card', { tokens: TOKENS }).code;
    const second = generateReact(page, 'n_card', { tokens: TOKENS }).code;
    expect(second).toBe(first);
  });

  it('属性顺序稳定：两次生成的属性行序列相同（无对象键序漂移）', () => {
    const a = generateCss(page, 'n_card', { tokens: TOKENS }).code.split('\n');
    const b = generateCss(page, 'n_card', { tokens: TOKENS }).code.split('\n');
    expect(a).toEqual(b);
  });

  it('JSON 往返（序列化 → 解析）后生成结果仍逐字节一致', () => {
    const roundTripped = JSON.parse(JSON.stringify(page)) as typeof page;
    expect(generateCss(roundTripped, 'n_card', { tokens: TOKENS }).code).toBe(
      generateCss(page, 'n_card', { tokens: TOKENS }).code,
    );
    expect(generateReact(roundTripped, 'n_card', { tokens: TOKENS }).code).toBe(
      generateReact(page, 'n_card', { tokens: TOKENS }).code,
    );
  });

  it('令牌集顺序不影响结果（同值多令牌按路径字典序选，而非出现顺序）', () => {
    const reversed: TokenSet = {
      size: {
        $type: 'dimension',
        radiusNoUnit: { $value: '8' },
        radius: { $value: '8px' },
      },
      color: {
        $type: 'color',
        brandLower: { $value: '#0d99ff' },
        brandAlias: { $value: '{color.brand}' },
        brand: { $value: '#0D99FF' },
      },
      spacingUnitless: { $value: '16' },
      notMatching: { $value: '0.5rem' },
    };
    expect(generateCss(page, 'n_card', { tokens: reversed }).code).toBe(
      generateCss(page, 'n_card', { tokens: TOKENS }).code,
    );
  });

  it('快照级：同页多节点、两档生成的 notes 顺序稳定（与属性顺序一致）', () => {
    for (const id of ['n_card', 'n_title'] as NodeId[]) {
      const css = generateCode(page, id, 'css', { tokens: TOKENS });
      const react = generateCode(page, id, 'react', { tokens: TOKENS });
      expect(react.notes.map((note) => note.id)).toEqual(css.notes.map((note) => note.id));
      expect(react.unbound).toBe(css.unbound);
    }
  });
});

describe('代码生成 · 令牌反查冲突', () => {
  it('大小写不同视为同值：命中令牌并输出 var()（不是原始值）', () => {
    const binding = bindTokenValue(TOKENS, '#0d99ff');
    expect(binding.tokenPath).not.toBeNull();
    expect(binding.cssVar).toBe(designTokenCssVar(binding.tokenPath as string));
  });

  it('同值多令牌 + 别名链：恒取字典序最小路径（两次调用一致）', () => {
    const first = bindTokenValue(TOKENS, '#0D99FF');
    const second = bindTokenValue(TOKENS, '#0D99FF');
    expect(second.tokenPath).toBe(first.tokenPath);
    // 候选：color.brand / color.brandAlias / color.brandLower → 字典序最小 = color.brand
    expect(first.tokenPath).toBe('color.brand');
    expect(first.expression).toBe(`var(--dfg-design-color-brand, #0D99FF)`);
  });

  it('单位归一：`8px` ↔ 令牌 `8` 命中（尺寸令牌不带单位也能对上）', () => {
    expect(bindTokenValue(TOKENS, '8px').tokenPath).toBe('size.radius');
    expect(bindTokenValue(TOKENS, '8').tokenPath).toBe('size.radius');
  });

  it('非 px 单位不归一（`0.5rem` 不匹配任何像素值；不得误命中）', () => {
    expect(bindTokenValue(TOKENS, '8px').tokenPath).not.toBe('notMatching');
    expect(bindTokenValue(TOKENS, '0.5rem').tokenPath).toBe('notMatching');
    expect(bindTokenValue(TOKENS, '0.5').tokenPath).toBeNull();
  });

  it('未命中：回退原始值 + 「未绑定令牌」说明（提示不得静默消失）', () => {
    const css = generateCss(page, 'n_card', { tokens: {} });
    const background = css.notes.find((note) => note.id === 'background');
    expect(background?.binding.tokenPath).toBeNull();
    expect(css.code).toContain('background: #0D99FF');
    expect(css.unbound).toBeGreaterThan(0);
  });

  it('命中时两档输出同一变量（CSS var() 与 React 字符串表达式同源）', () => {
    const css = generateCss(page, 'n_card', { tokens: TOKENS });
    const react = generateReact(page, 'n_card', { tokens: TOKENS });
    expect(css.code).toContain('var(--dfg-design-color-brand, #0D99FF)');
    expect(react.code).toContain("'var(--dfg-design-color-brand, #0D99FF)'");
  });

  it('节点不存在：两档都返回空结果（面板走空态，不抛错）', () => {
    expect(generateCss(page, '不存在', {}).code).toBe('');
    expect(generateReact(page, '不存在', {}).code).toBe('');
    expect(generateCss(page, '不存在', {}).notes).toEqual([]);
  });

  it('文本节点：React 档把内容嵌进 span 且不注入结束标签（转义面）', () => {
    const html = generateReact(page, 'n_title', { tokens: TOKENS }).code;
    expect(html).toContain('<span');
    expect(html).toContain('标题');
    expect(html).toContain('</span>');
  });
});

describe('代码生成 · 数值格式化边界', () => {
  it('浮点去尾零 + 整数原样（0.50 → 0.5；1.0 → 1）', () => {
    const withFloat = createRect({
      id: 'n_f',
      name: 'F',
      x: 0.5,
      y: 1.0,
      width: 10.25,
      height: 10,
    });
    const pageWithFloat = createDocument({
      id: 'doc_2' as DesignDocument['id'],
      pages: [createPage({ id: 'page_2', rootIds: ['n_f'], nodes: { n_f: withFloat } })],
    }).pages[0];
    if (pageWithFloat === undefined) throw new Error('fixture: page_2 must exist');
    const code = generateCss(pageWithFloat, 'n_f', {}).code;
    expect(code).toContain('left: 0.5px');
    expect(code).toContain('top: 1px');
    expect(code).toContain('width: 10.25px');
  });
});
