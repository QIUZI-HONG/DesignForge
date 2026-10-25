/**
 * [独立验证 · ui] 令牌与 guard-tokens 对抗测试。
 *
 * 覆盖风险点：两套 theme 键集完备性（含密度几何）、密度映射、以及
 * `guard-tokens` 的**真违规 vs 误报**边界（注释 / 字符串 / CSS 变量引用 / 文档数据 / 形近绕过）。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DENSITY, flattenPrimitives, flattenTheme, PRIMITIVES, THEMES } from '../tokens';
import { ALLOWLIST, allowlistFor, RULES, scanText } from '../tools/guard-tokens-core.mjs';

const tokensCss = readFileSync(resolve(process.cwd(), 'src/tokens.css'), 'utf8');
const componentsCss = readFileSync(resolve(process.cwd(), 'src/components.css'), 'utf8');

/** 解析单个规则块的声明（与 tokens.test.ts 同口径的独立实现）。 */
function parseBlock(css: string, selector: RegExp): Record<string, string> {
  const body = selector.exec(css)?.[1];
  if (body === undefined) throw new Error(`缺少规则块 ${String(selector)}`);
  const vars: Record<string, string> = {};
  for (const decl of body.replaceAll(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const trimmed = decl.trim();
    if (trimmed === '') continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    vars[trimmed.slice(0, colon).trim()] = trimmed
      .slice(colon + 1)
      .trim()
      .replaceAll(/\s+/g, ' ');
  }
  return vars;
}

const lightBlock = parseBlock(tokensCss, /:root\[data-theme="light"\]\s*\{([^}]*)\}/);
const darkBlock = parseBlock(tokensCss, /:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
const rootBlock = parseBlock(tokensCss, /:root\s*\{([^}]*)\}/);

/** 引用到的 CSS 变量（按类别归口）。 */
function referenced(css: string, prefix: string): string[] {
  const out = new Set<string>();
  for (const match of css.matchAll(/var\(\s*(--dfg-[a-z0-9-]+)/g)) {
    const name = match[1] as string;
    if (name.startsWith(prefix)) out.add(name);
  }
  return [...out].sort();
}

describe('[verify] 令牌 · 两套 theme 键集完备性（含密度）', () => {
  it('light / dark 的 CSS 变量集合逐名一致（切换主题不换键）', () => {
    expect(Object.keys(lightBlock).length).toBeGreaterThan(50);
    expect(Object.keys(lightBlock).sort()).toEqual(Object.keys(darkBlock).sort());
  });

  it('两套主题块都自带密度几何（控件高/行高/字号），且值与 DENSITY 映射一致', () => {
    for (const [name, density] of [
      ['light', 'comfortable'],
      ['dark', 'compact'],
    ] as const) {
      const block = name === 'light' ? lightBlock : darkBlock;
      expect(block['--dfg-control-height-md']).toBe(`${DENSITY[density].controlHeight.md}px`);
      expect(block['--dfg-row-height-md']).toBe(`${DENSITY[density].rowHeight.md}px`);
      expect(block['--dfg-font-size-control']).toBe(`${DENSITY[density].fontSizeControl}px`);
      expect(block['--dfg-icon-gap']).toBe(`${DENSITY[density].iconGap}px`);
    }
    // 舒适 32 / 紧凑 28 是两套基准的关键差异
    expect(lightBlock['--dfg-control-height-md']).toBe('32px');
    expect(darkBlock['--dfg-control-height-md']).toBe('28px');
  });

  it('密度键集在两档之间完全一致（同一套几何口子）', () => {
    const keys = (scale: object): string[] =>
      Object.entries(scale)
        .flatMap(([key, value]) =>
          value !== null && typeof value === 'object'
            ? Object.keys(value as object).map((child) => `${key}.${child}`)
            : [key],
        )
        .sort();
    expect(keys(DENSITY.comfortable)).toEqual(keys(DENSITY.compact));
  });

  it('主题块不泄漏原语/非主题键（:root 与主题块键集不相交）', () => {
    const themeKeys = new Set(Object.keys(flattenTheme(THEMES.light)));
    const rootKeys = new Set(Object.keys(rootBlock));
    const overlap = [...themeKeys].filter((key) => rootKeys.has(key));
    // 允许 --dfg-z-* 等之外的少量共享（当前实现：无重叠）
    expect(overlap).toEqual([]);
    expect(Object.keys(rootBlock).sort()).toEqual(Object.keys(flattenPrimitives()).sort());
  });

  it('components.css 引用的颜色变量在**两套主题块**里都存在（不是只有一套有）', () => {
    const colorRefs = referenced(componentsCss, '--dfg-color-');
    expect(colorRefs.length).toBeGreaterThan(20);
    const missingInLight = colorRefs.filter((name) => lightBlock[name] === undefined);
    const missingInDark = colorRefs.filter((name) => darkBlock[name] === undefined);
    expect({ missingInLight, missingInDark }).toEqual({ missingInLight: [], missingInDark: [] });
  });

  it('components.css 不引用未定义的 --dfg-* 变量（含非颜色族）', () => {
    const known = new Set([
      ...Object.keys(rootBlock),
      ...Object.keys(lightBlock),
      ...Object.keys(darkBlock),
    ]);
    const all = [
      ...new Set(
        [...componentsCss.matchAll(/var\(\s*(--dfg-[a-z0-9-]+)/g)].map((m) => m[1] as string),
      ),
    ];
    expect(all.filter((name) => !known.has(name))).toEqual([]);
  });

  it('密度轴与主题轴解耦：换主题只换密度默认值，不改原语刻度', () => {
    expect(THEMES.light.density).toBe('comfortable');
    expect(THEMES.dark.density).toBe('compact');
    // 原语（间距/圆角/字号档）在两套主题下完全相同
    expect(flattenPrimitives()['--dfg-space-2']).toBe('8px');
    expect(PRIMITIVES.radius.xl).toBe(13);
  });
});

describe('[verify] guard-tokens · 真违规（必须抓到）', () => {
  it('R1：3/4/6/8 位 hex、rgb/rgba/hsl/hsla 全抓', () => {
    const text = [
      "const a = '#fff';",
      "const b = '#abcd';",
      "const c = '#0D99FF';",
      "const d = '#0d99ffcc';",
      'const e = `rgb(0,0,0)`;',
      "const f = 'hsla(1,2%,3%,.4)';",
    ].join('\n');
    const rules = scanText('apps/web/src/a.ts', text).map((item) => item.rule);
    expect(rules).toEqual(['R1', 'R1', 'R1', 'R1', 'R1', 'R1']);
  });

  it('R2：px/rem/em 长度抓，零值放行', () => {
    const violations = scanText(
      'apps/web/src/a.css',
      ['padding: 12px;', 'margin: 0;', 'border: 0px;', 'font-size: 1em;', 'width: 5.5rem;'].join(
        '\n',
      ),
    );
    expect(violations.map((item) => item.text)).toEqual(['12px', '1em', '5.5rem']);
  });

  it('R3：间距族属性赋裸数字抓（含负值与小数），零值放行', () => {
    const violations = scanText(
      'apps/web/src/a.tsx',
      [
        'const s = { marginTop: 8, gap: -4, padding: 1.5, rowGap: 0, borderRadius: 12 };',
        'const ok = { width: 240, zIndex: 10, flex: 1 };',
      ].join('\n'),
    );
    expect(violations.map((item) => item.rule)).toEqual(['R3', 'R3', 'R3', 'R3']);
    expect(violations.map((item) => item.text)).toEqual([
      'marginTop: 8',
      'gap: -4',
      'padding: 1.5',
      'borderRadius: 12',
    ]);
  });

  it('行内豁免的边界：标记必须**同行**且带理由（上一行不豁免下一行）', () => {
    const sameLine = scanText(
      'apps/web/src/a.ts',
      "const a = '#fff'; // guard-tokens:allow 品牌色",
    );
    expect(sameLine).toEqual([]);
    // 旧实现「本行或上一行」会把带标记的下一行真实违规静默豁免（实测 #ff0000 漏抓）
    const prevLine = scanText(
      'apps/web/src/a.ts',
      ['// guard-tokens:allow 规格硬值', "const a = '#ff0000';"].join('\n'),
    );
    expect(prevLine.map((item) => `${item.rule}:${item.text}`)).toEqual(['R1:#ff0000']);
    const twoLinesAbove = scanText(
      'apps/web/src/a.ts',
      ['// guard-tokens:allow 规格硬值', 'const other = 1;', "const a = '#fff';"].join('\n'),
    );
    expect(twoLinesAbove).toHaveLength(1); // 隔行更不生效
    const noReason = scanText('apps/web/src/a.ts', "const a = '#fff'; // guard-tokens:allow");
    expect(noReason).toHaveLength(1);
  });
});

describe('[verify] guard-tokens · 误报与漏报边界', () => {
  it('注释与字符串里的令牌引用示例不误报（var(--dfg-) / 样式对象文本）', () => {
    const violations = scanText(
      'apps/web/src/a.ts',
      [
        '// 示例：{ marginTop: var(--dfg-space-2), gap: var(--dfg-icon-gap) }',
        "const note = '样式：{ padding: var(--dfg-space-2) }';",
        '/* 取色走 var(--dfg-color-primary) */',
      ].join('\n'),
    );
    expect(violations).toEqual([]);
  });

  it('字符串里的自然语言文案不判（纯文案里的取值样例不再误报）', () => {
    const violations = scanText(
      'apps/web/src/a.ts',
      ["const hint = '请把 marginTop: 8 改成令牌';", "const doc = '规范：内边距 12px';"].join('\n'),
    );
    // 文案（含中日韩文字）不是样式取值：整体跳过；取值写法串仍照抓（见「字符串 CSS」用例）
    expect(violations).toEqual([]);
  });

  it('带小数单位的合法取值只报 R2（长度裸值），不再被 R3 误判为裸数字', () => {
    const violations = scanText('apps/web/src/a.css', 'gap: 1.5rem;');
    expect(violations.map((item) => `${item.rule}:${item.text}`)).toEqual(['R2:1.5rem']);
    // 计算表达式里的字面量仍按裸数字报（0.5 是取值文本，不是文案）
    const px = scanText('apps/web/src/a.tsx', 'const s = { marginTop: 0.5 + 1 };');
    expect(px.map((item) => item.rule)).toContain('R3');
  });

  it('形近写法不再绕过：rgb 与括号间空格、大写单位、省略前导 0、负号长度值全抓', () => {
    const spacedRgb = scanText('apps/web/src/a.ts', "const c = 'rgba (0, 0, 0, .5)';");
    expect(spacedRgb.map((item) => item.rule)).toEqual(['R1']);
    const upperUnit = scanText('apps/web/src/a.css', 'padding: 12PX;');
    expect(upperUnit.map((item) => item.rule)).toEqual(['R2']);
    // 旧版前置断言 (?<![\w.-]) 把「省略前导 0」与「负号」两种写法一起放过
    const leadingDot = scanText('apps/web/src/a.css', 'gap: .5rem;');
    expect(leadingDot.map((item) => item.rule)).toEqual(['R2']);
    const negative = scanText('apps/web/src/a.css', 'margin-left: -12px;');
    expect(negative.map((item) => item.rule)).toEqual(['R2']);
    // 对照：紧邻非词字符的 hex 仍然抓，说明不是「一律漏」
    const emoji = scanText('apps/web/src/a.tsx', "const c = '🎨#0d99ff';");
    expect(emoji).toHaveLength(1);
  });

  it('【漏报】注释里裸写 hex 或 px 照抓（口径：注释仅屏蔽「样式语法文本」）', () => {
    const caught = scanText('apps/web/src/a.ts', '// 这里曾经写过 #0d99ff');
    expect(caught.map((item) => item.rule)).toEqual(['R1']);
    const pxInComment = scanText('apps/web/src/a.ts', '// 内边距 12px');
    expect(pxInComment.map((item) => item.rule)).toEqual(['R2']);
  });

  it('白名单：只放行声明的路径；.spec 测试文件不在白名单内（口径缺口）', () => {
    expect(allowlistFor('packages/ui/src/tokens.ts').allowed).toBe(true);
    expect(allowlistFor('packages/ui/src/tokens.css').allowed).toBe(true);
    expect(allowlistFor('apps/web/src/features/x/y.test.tsx').allowed).toBe(true);
    expect(allowlistFor('apps/web/src/features/x/y.tsx').allowed).toBe(false);
    // 白名单理由是逐条声明的（不得空reason）
    for (const entry of ALLOWLIST) expect(entry.reason.length).toBeGreaterThan(0);
    // .spec.tsx 命名不在白名单：测试里写硬值会被判违规（命名口径二义）
    expect(allowlistFor('apps/web/src/features/x/y.spec.tsx').allowed).toBe(false);
  });

  it('规则表：各规则的 id/文案齐备（CLI 输出依赖；R4=RW-01 单位守卫、R5=令牌 v2 语义档登记）', () => {
    expect(RULES.map((rule) => rule.id)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5']);
  });
});

// ---------------------------------------------------------------------------
// 「样式语法上下文才判」四类样例 × 各变体
// ---------------------------------------------------------------------------

describe('[verify] guard-tokens · 四类样例（真违规 / 注释样例 / 字符串 CSS / 数据型数值）', () => {
  it('真违规（代码取值）：四类变体逐条全抓', () => {
    const violations = scanText(
      'apps/web/src/a.tsx',
      [
        "const a = '#ff0000';",
        "const b = 'rgba (0, 0, 0, .5)';",
        'const c = { gap: .5rem, marginLeft: -12px };',
        'padding: 12PX;',
      ].join('\n'),
    );
    expect(violations.map((item) => `${item.rule}:${item.text}`)).toEqual([
      'R1:#ff0000',
      'R1:rgba (',
      'R2:.5rem',
      'R2:-12px',
      'R2:12PX',
    ]);
  });

  it('注释样例（说明文本）：整行跳过；注释里的裸泄漏记录仍照抓', () => {
    const violations = scanText(
      'apps/web/src/a.ts',
      [
        '// 示例：{ gap: var(--dfg-icon-gap), marginTop: var(--dfg-space-2) }',
        '/* 取色走 var(--dfg-color-primary)；间距一律 var(--dfg-space-2) */',
        '// 取色：rgb(13, 153, 255)',
        'const leaked = 1; // 这里曾经写过 #0d99ff（规范泄漏记录，仍应被抓）',
      ].join('\n'),
    );
    // 前两行的样式语法示例与第三行的取色说明（注释里的 rgb() 属说明）跳过；第四行的泄漏记录照抓
    expect(violations.map((item) => `${item.rule}@${String(item.line)}`)).toEqual(['R1@4']);
  });

  it('字符串 CSS（取值写法）：CSS 函数与 `key: 数值` 取值串照抓', () => {
    const violations = scanText(
      'apps/web/src/a.ts',
      [
        "const color = 'rgba (0, 0, 0, .5)';",
        "const size = 'padding: 12px; gap: 1.5rem';",
        "const raw = 'marginTop: 8';",
      ].join('\n'),
    );
    expect(violations.map((item) => `${item.rule}:${item.text}`)).toEqual([
      'R1:rgba (',
      'R2:12px',
      'R2:1.5rem',
      'R3:marginTop: 8',
    ]);
  });

  it('数据型数值：文档数据里的 lineHeight/inset 不判；字号族 fontSize 仍是真违规', () => {
    const violations = scanText(
      'apps/web/src/a.ts',
      [
        'const doc = { lineHeight: 1.5, inset: 24, fontSize: 16 };',
        "const hint = '请把 marginTop: 8 改成令牌';",
      ].join('\n'),
    );
    // lineHeight 无单位值是乘数、inset 是定位几何（规格豁免「几何计算」）→ 不判；
    // fontSize 属字号族 → 仍报（文档数据场景用同行 allow 注释登记理由）；
    // 第二行是自然语言文案（非取值写法）→ 跳过
    expect(violations.map((item) => `${item.rule}:${item.text}`)).toEqual(['R3:fontSize: 16']);
  });

  it('自然语言文案里的各变体一律不判（纯文案非样式取值）', () => {
    const violations = scanText(
      'apps/web/src/a.ts',
      [
        "const hint = '请把 gap: 1.5rem 改成 var(--dfg-icon-gap)';",
        "const doc = '规范：12PX / .5rem / -12px / rgba (0,0,0,.5) 都不是取值写法';",
      ].join('\n'),
    );
    expect(violations).toEqual([]);
  });
});
