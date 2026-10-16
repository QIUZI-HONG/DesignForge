/**
 * 双基准令牌测试（FE-01 · 令牌模块）。
 *
 * 断言三类不变量：
 * 1. 规格硬值——浅色（首页族）/ 深色（编辑器族）的关键色与控件高直接对齐
 *    《前端实现规格 v1》§一.3 与清单 §1.0 两套基准规范；
 * 2. 结构不变量——两套主题键集一致、间距刻度为 4 的倍数（8px 栅格）、圆角/字号/动效档位齐备；
 * 3. 落地同步——`tokens.css` 的 CSS 变量集合与值与 TS 展平结果逐项一致（含两套主题），
 *    且组件样式表引用的每个 `--dfg-*` 变量都真实存在（防改名漂移）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  applyDocumentTheme,
  cssVar,
  DENSITY,
  flattenPrimitives,
  flattenTheme,
  PRIMITIVES,
  THEMES,
  type Theme,
  type TokenVars,
} from './tokens';

// Vitest 下 `import.meta.url` 非 file: 协议，改用包根相对路径（vitest 的 cwd = 包目录）。
const tokensCss = readFileSync(resolve(process.cwd(), 'src/tokens.css'), 'utf8');
const componentsCss = readFileSync(resolve(process.cwd(), 'src/components.css'), 'utf8');

/** 解析 CSS 单个规则块的声明（忽略注释，容忍换行/空格）。 */
function parseBlock(css: string, selectorPattern: RegExp): TokenVars {
  const body = selectorPattern.exec(css)?.[1];
  if (body === undefined) {
    throw new Error(`tokens.css 缺少规则块：${String(selectorPattern)}`);
  }
  const vars: TokenVars = {};
  for (const decl of body.replaceAll(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const trimmed = decl.trim();
    if (trimmed === '') continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const name = trimmed.slice(0, colon).trim();
    const value = trimmed
      .slice(colon + 1)
      .trim()
      .replaceAll(/\s+/g, ' ');
    vars[name] = value;
  }
  return vars;
}

/** 深收集对象路径（用于两套主题键集一致性断言）。 */
function collectPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectPaths(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

/** 从任意 CSS 文本里收集被引用的 `--dfg-*` 变量名。 */
function referencedVars(css: string): string[] {
  const out = new Set<string>();
  for (const match of css.matchAll(/var\(\s*(--dfg-[a-z0-9-]+)/g)) {
    if (match[1] !== undefined) out.add(match[1]);
  }
  return [...out].sort();
}

const { light, dark } = THEMES;

/**
 * 色值断言：规格文档用大写 hex（`#0D99FF`），令牌存储用小写（Biome CSS 规范形），
 * 两者等价——比较大小写无关，避免「规格写法」与「落盘写法」互相打架。
 */
function expectColor(actual: string, spec: string): void {
  expect(actual.toLowerCase()).toBe(spec.toLowerCase());
}

describe('令牌 · 规格硬值（浅色首页族 / 深色编辑器族）', () => {
  it('浅色基准：主色/选中底/描边/文字三级对齐规格', () => {
    expectColor(light.colors.primary, '#0D99FF');
    expectColor(light.colors.selection, '#E5F4FF');
    expectColor(light.colors.border, '#E6E6E6');
    expectColor(light.colors.text.primary, '#1E1E1E');
    expectColor(light.colors.text.secondary, '#757575');
    expectColor(light.colors.text.disabled, '#B3B3B3');
  });

  it('深色基准：画布/面板/描边/组件紫对齐规格', () => {
    expectColor(dark.colors.canvas, '#1E1E1E');
    expectColor(dark.colors.surface, '#2C2C2C');
    expectColor(dark.colors.border, '#3E3E3E');
    expectColor(dark.colors.component, '#9747FF');
    expectColor(dark.colors.primary, '#0D99FF');
  });

  it('控件高：浅色 32 / 深色 28（密度映射）', () => {
    expect(THEMES.light.density).toBe('comfortable');
    expect(THEMES.dark.density).toBe('compact');
    expect(DENSITY[THEMES.light.density].controlHeight.md).toBe(32);
    expect(DENSITY[THEMES.dark.density].controlHeight.md).toBe(28);
  });

  it('圆角档位 3 / 6 / 8 / 13 / 999', () => {
    expect(PRIMITIVES.radius).toEqual({ sm: 3, md: 6, lg: 8, xl: 13, pill: 999 });
  });

  it('字号档含 11 / 12 / 13 / 15 / 18', () => {
    for (const size of [11, 12, 13, 15, 18]) {
      expect(Object.values(PRIMITIVES.fontSize)).toContain(size);
    }
  });

  it('动效时长档含 150 / 200 / 300ms', () => {
    expect(PRIMITIVES.duration.fast).toBe(150);
    expect(PRIMITIVES.duration.base).toBe(200);
    expect(PRIMITIVES.duration.slow).toBe(300);
  });
});

describe('令牌 · 结构不变量', () => {
  it('两套主题键集完全一致（颜色/阴影结构可互换）', () => {
    expect(collectPaths(light.colors).sort()).toEqual(collectPaths(dark.colors).sort());
    expect(collectPaths(light.shadows).sort()).toEqual(collectPaths(dark.shadows).sort());
  });

  it('间距刻度全部为 4 的倍数，且含 8px 栅格档', () => {
    for (const value of Object.values(PRIMITIVES.space)) {
      expect(value % 4).toBe(0);
    }
    expect(Object.values(PRIMITIVES.space)).toContain(8);
    expect(Object.values(PRIMITIVES.space)).toContain(16);
  });

  it('密度映射：舒适 32 与 紧凑 28 两档控件高可互换', () => {
    expect(DENSITY.comfortable.controlHeight.md).toBe(32);
    expect(DENSITY.compact.controlHeight.md).toBe(28);
    expect(DENSITY.comfortable.controlHeight.md - DENSITY.compact.controlHeight.md).toBe(4);
  });

  it('cssVar 生成 `--dfg-` 前缀的变量引用', () => {
    expect(cssVar('color.text.primary')).toBe('var(--dfg-color-text-primary)');
    expect(cssVar('space.2')).toBe('var(--dfg-space-2)');
    expect(cssVar('radius.lg')).toBe('var(--dfg-radius-lg)');
    expect(cssVar('controlHeight.md')).toBe('var(--dfg-control-height-md)');
  });

  it('令牌值无 3 位简写 hex（避免色彩口径分叉）', () => {
    for (const theme of [light, dark] as Theme[]) {
      for (const [name, value] of Object.entries(flattenTheme(theme))) {
        if (!value.startsWith('#')) continue;
        expect(name.startsWith('--dfg-')).toBe(true);
        expect(value).toMatch(/^#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/);
      }
    }
  });
});

describe('令牌 · tokens.css 与 TS 单一真源同步', () => {
  it(':root 共享原语与 TS 展平结果逐项一致', () => {
    const shared = parseBlock(tokensCss, /:root\s*\{([^}]*)\}/);
    expect(shared).toEqual(flattenPrimitives());
  });

  it(':root[data-theme="light"] 与浅色主题展平结果逐项一致', () => {
    const block = parseBlock(tokensCss, /:root\[data-theme="light"\]\s*\{([^}]*)\}/);
    expect(block).toEqual(flattenTheme(light));
  });

  it(':root[data-theme="dark"] 与深色主题展平结果逐项一致', () => {
    const block = parseBlock(tokensCss, /:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
    expect(block).toEqual(flattenTheme(dark));
  });

  it('两套主题块的 CSS 变量名集合一致（切换主题不换键）', () => {
    const lightVars = parseBlock(tokensCss, /:root\[data-theme="light"\]\s*\{([^}]*)\}/);
    const darkVars = parseBlock(tokensCss, /:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
    expect(Object.keys(lightVars).sort()).toEqual(Object.keys(darkVars).sort());
  });

  it('主题选择器只认根元素（口径钉子：主题是文档级属性，嵌套切换不在口径内）', () => {
    // 原因：验收标准 §3「主题逐页对齐 Figma 本体」= 一个页面一套基准；
    // 且门户浮层（Modal/Drawer/Toast）挂在 body，必须靠根主题继承才能拿到令牌。
    const themeSelectors = [...tokensCss.matchAll(/([^{}]*\[data-theme[^{}]*)\{/g)].map((match) =>
      (match[1] ?? '').trim(),
    );
    expect(themeSelectors).toEqual([':root[data-theme="light"]', ':root[data-theme="dark"]']);
  });

  it('applyDocumentTheme 落到 <html> 上（消费方切主题的唯一入口）', () => {
    applyDocumentTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyDocumentTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('组件样式表引用的每个 --dfg-* 变量都存在于令牌（防改名漂移）', () => {
    const known = new Set([
      ...Object.keys(flattenPrimitives()),
      ...Object.keys(flattenTheme(light)),
      ...Object.keys(flattenTheme(dark)),
    ]);
    const missing = referencedVars(componentsCss).filter((name) => !known.has(name));
    expect(missing).toEqual([]);
  });

  it('组件样式表引用令牌而非裸值（色值/px 全走 var）', () => {
    expect(componentsCss).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(componentsCss).not.toMatch(/\d+(?:\.\d+)?px/);
  });
});
