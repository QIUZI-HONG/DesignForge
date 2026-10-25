/**
 * 双基准令牌测试（FE-01 · 令牌模块）。
 *
 * 断言四类不变量：
 * 1. 规格硬值——浅色（首页族）/ 深色（编辑器族）的关键色与控件高直接对齐
 *    《前端实现规格 v1》§一.3 与清单 §1.0 两套基准规范；
 * 2. 结构不变量——两套主题键集一致、间距刻度为 4 的倍数（8px 栅格）、圆角/字号/动效档位齐备；
 * 3. 落地同步——`tokens.css` 的 CSS 变量集合与值与 TS 展平结果逐项一致（含两套主题），
 *    且组件样式表引用的每个 `--dfg-*` 变量都真实存在（防改名漂移）；
 * 4. 单位合法（F-1 回归守卫，RW-01 起）与语义档登记（令牌 v2：海拔/焦点环/动效
 *    是既有刻度上的别名层，值只能是 none 或 var 引用）。
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

describe('令牌 · 单位合法性（F-1 缺陷回归守卫）', () => {
  // 病灶（总纲 §1 F-1）：序列化器对数字默认补 px，时长档落盘成 `150px`，
  // components.css 引用它的 transition/animation 整条非法被浏览器静默丢弃。
  // 一致性测试两边一致地错拦不住它——单位必须对独立预期源（规格硬值字面量）断言。

  it('时长档序列化为 ms（历史缺陷现场：150px → 必须为 150ms）', () => {
    const shared = flattenPrimitives();
    expect(shared['--dfg-duration-fast']).toBe('150ms');
    expect(shared['--dfg-duration-base']).toBe('200ms');
    expect(shared['--dfg-duration-slow']).toBe('300ms');
  });

  it('tokens.css 时长变量落盘为 ms（落盘件与序列化分支同步修正）', () => {
    const shared = parseBlock(tokensCss, /:root\s*\{([^}]*)\}/);
    expect(shared['--dfg-duration-fast']).toBe('150ms');
    expect(shared['--dfg-duration-base']).toBe('200ms');
    expect(shared['--dfg-duration-slow']).toBe('300ms');
  });

  it('序列化分支各归各位：长度族 px、字重/行高/层级无单位（修 ms 不得伤及他族）', () => {
    const shared = flattenPrimitives();
    expect(shared['--dfg-space-4']).toBe('16px');
    expect(shared['--dfg-radius-md']).toBe('6px');
    expect(shared['--dfg-font-size-13']).toBe('13px');
    expect(shared['--dfg-font-weight-regular']).toBe('400');
    expect(shared['--dfg-line-height-base']).toBe('1.4');
    expect(shared['--dfg-z-modal']).toBe('1200');
    expect(shared['--dfg-letter-spacing-wide']).toBe('0.04em');
  });

  it('全部数值令牌单位合法：时长 ms / 长度 px / 无单位族裸数字 / 字距 em（两套主题含密度几何）', () => {
    // 分类表是测试侧对规格口径的独立表达（不 import 实现），防「按实现的写法复述实现」。
    const familyUnits: Array<[prefix: string, unit: 'ms' | 'px' | 'em' | 'none'>] = [
      ['--dfg-duration-', 'ms'],
      ['--dfg-font-weight-', 'none'],
      ['--dfg-line-height-', 'none'],
      ['--dfg-z-', 'none'],
      ['--dfg-letter-spacing-', 'em'],
      ['--dfg-radius-', 'px'],
      ['--dfg-space-', 'px'],
      ['--dfg-font-size-', 'px'],
      ['--dfg-icon-size-', 'px'],
      ['--dfg-icon-gap', 'px'],
      ['--dfg-size-', 'px'],
      ['--dfg-border-width-', 'px'],
      ['--dfg-control-height-', 'px'],
      ['--dfg-control-padding-x-', 'px'],
      ['--dfg-row-height-', 'px'],
      // 令牌 v2 动效语义档的时长子令牌（值当前是别名引用，见语义档断言；
      // 一旦被改成裸数字，本表按 ms 接住——与 guard R4 的单位登记同口径）
      ['--dfg-motion-enter-duration', 'ms'],
      ['--dfg-motion-exit-duration', 'ms'],
      ['--dfg-motion-emphasized-duration', 'ms'],
    ];
    const all: TokenVars = {
      ...flattenPrimitives(),
      ...flattenTheme(light),
      ...flattenTheme(dark),
    };
    for (const [name, value] of Object.entries(all)) {
      // 语义别名（none / var(--dfg-…) 引用）不参与单位断言——别名纪律由语义档
      // 断言（上方 describe）与 guard R5 把关；非数值令牌（色/影/缓动/字体栈）同理。
      if (value === 'none' || value.startsWith('var(')) continue;
      const family = familyUnits.find(([prefix]) => name.startsWith(prefix));
      if (family === undefined) continue;
      const suffix = { ms: 'ms', px: 'px', em: 'em', none: '' }[family[1]];
      const pattern = suffix === '' ? /^\d+(?:\.\d+)?$/ : new RegExp(`${suffix}$`);
      expect(`${name}=${value}`).toMatch(pattern);
    }
  });
});

describe('令牌 · 结构不变量', () => {
  it('两套主题键集完全一致（颜色/阴影/海拔/焦点环结构可互换）', () => {
    expect(collectPaths(light.colors).sort()).toEqual(collectPaths(dark.colors).sort());
    expect(collectPaths(light.shadows).sort()).toEqual(collectPaths(dark.shadows).sort());
    expect(collectPaths(light.elevation).sort()).toEqual(collectPaths(dark.elevation).sort());
    expect(collectPaths(light.focusRing).sort()).toEqual(collectPaths(dark.focusRing).sort());
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

describe('令牌 · 语义档 v2（海拔/焦点环/动效，R-5 增量层）', () => {
  // 语义档 = 既有物理刻度之上的**别名层**：语义名 → 实际令牌引用，不重造值
  // （R-5 口径：「词汇已有一半，先修 F-1 再扩」；计划 §5.2：浮层统一 shadow-popover、
  // 弹层 shadow-lg）。登记制在 guard 侧（guard-tokens-core.mjs 的
  // SEMANTIC_TOKEN_FAMILIES，R5），本块断言映射关系、引用可达与词汇铺满；
  // 组件迁移不在本票（后续票消费本档，既有 19 组件继续用物理刻度）。

  /** 从别名值里取出被引用的 `--dfg-*` 变量名（`none` 无引用）。 */
  function aliasRef(value: string): string | undefined {
    return /^var\((--dfg-[a-z0-9-]+)\)$/.exec(value)?.[1];
  }

  it('海拔三档：页面无影 / 浮层→shadow-popover / 弹层→shadow-lg（两主题同构）', () => {
    const expected = {
      page: 'none',
      overlay: 'var(--dfg-shadow-popover)',
      modal: 'var(--dfg-shadow-lg)',
    };
    expect(light.elevation).toEqual(expected);
    expect(dark.elevation).toEqual(expected);
  });

  it('海拔引用的阴影令牌真实存在，且只有 page 档允许 none（别名不得悬空）', () => {
    // 引用可达的全集 = 原语(:root) + 两主题块——别名可能指向任一层
    const known = new Set([
      ...Object.keys(flattenPrimitives()),
      ...Object.keys(flattenTheme(light)),
      ...Object.keys(flattenTheme(dark)),
    ]);
    for (const theme of [light, dark] as Theme[]) {
      for (const [tier, value] of Object.entries(theme.elevation)) {
        if (value === 'none') {
          expect(tier).toBe('page');
          continue;
        }
        const ref = aliasRef(value);
        expect(ref).toBeDefined();
        expect(known.has(ref as string)).toBe(true);
      }
    }
  });

  it('焦点环令牌：色/宽/偏移三键双主题齐备，引用既有颜色与描边宽刻度', () => {
    for (const theme of [light, dark] as Theme[]) {
      expect(Object.keys(theme.focusRing).sort()).toEqual(['color', 'offset', 'width']);
      expect(theme.focusRing.color).toBe('var(--dfg-color-focus-ring)');
      expect(theme.focusRing.width).toBe('var(--dfg-border-width-focus)');
      expect(theme.focusRing.offset).toBe('var(--dfg-border-width-focus)');
    }
  });

  it('焦点环引用的物理令牌真实存在（别名不得悬空）', () => {
    // width/offset 引用的是 :root 原语（--dfg-border-width-focus），全集须含原语层
    const known = new Set([
      ...Object.keys(flattenPrimitives()),
      ...Object.keys(flattenTheme(light)),
      ...Object.keys(flattenTheme(dark)),
    ]);
    for (const theme of [light, dark] as Theme[]) {
      for (const value of Object.values(theme.focusRing)) {
        const ref = aliasRef(value);
        expect(ref).toBeDefined();
        expect(known.has(ref as string)).toBe(true);
      }
    }
  });

  it('动效三档：进入/退出/强调 = 时长+缓动组合，落在既有 duration/easing 刻度上', () => {
    const { motion } = PRIMITIVES;
    expect(motion.enter).toEqual({
      duration: 'var(--dfg-duration-base)',
      easing: 'var(--dfg-easing-standard)',
    });
    expect(motion.exit).toEqual({
      duration: 'var(--dfg-duration-fast)',
      easing: 'var(--dfg-easing-exit)',
    });
    expect(motion.emphasized).toEqual({
      duration: 'var(--dfg-duration-slow)',
      easing: 'var(--dfg-easing-emphasized)',
    });
  });

  it('动效三档铺满既有词汇：时长 fast/base/slow 各用一次，缓动 standard/exit/emphasized 各用一次', () => {
    const tiers = [PRIMITIVES.motion.enter, PRIMITIVES.motion.exit, PRIMITIVES.motion.emphasized];
    expect(tiers.map((tier) => tier.duration).sort()).toEqual([
      'var(--dfg-duration-base)',
      'var(--dfg-duration-fast)',
      'var(--dfg-duration-slow)',
    ]);
    expect(tiers.map((tier) => tier.easing).sort()).toEqual([
      'var(--dfg-easing-emphasized)',
      'var(--dfg-easing-exit)',
      'var(--dfg-easing-standard)',
    ]);
  });

  it('语义档值形登记制：值只能是 none 或单个 var(--dfg-…) 别名引用（不重造值）', () => {
    const values = [
      ...Object.values(PRIMITIVES.motion).flatMap((tier) => Object.values(tier)),
      ...([light, dark] as Theme[]).flatMap((theme) => [
        ...Object.values(theme.elevation),
        ...Object.values(theme.focusRing),
      ]),
    ];
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value === 'none' || aliasRef(value) !== undefined).toBe(true);
    }
  });

  it('tokens.css 落盘新档：:root 含动效六变量，主题块含海拔/焦点环变量（同步显式锚点）', () => {
    const shared = parseBlock(tokensCss, /:root\s*\{([^}]*)\}/);
    expect(
      Object.keys(shared)
        .filter((name) => name.startsWith('--dfg-motion-'))
        .sort(),
    ).toEqual([
      '--dfg-motion-emphasized-duration',
      '--dfg-motion-emphasized-easing',
      '--dfg-motion-enter-duration',
      '--dfg-motion-enter-easing',
      '--dfg-motion-exit-duration',
      '--dfg-motion-exit-easing',
    ]);
    for (const theme of ['light', 'dark'] as const) {
      const block = parseBlock(
        tokensCss,
        new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`),
      );
      expect(
        Object.keys(block)
          .filter((name) => name.startsWith('--dfg-elevation-'))
          .sort(),
      ).toEqual(['--dfg-elevation-modal', '--dfg-elevation-overlay', '--dfg-elevation-page']);
      expect(
        Object.keys(block)
          .filter((name) => name.startsWith('--dfg-focus-ring-'))
          .sort(),
      ).toEqual(['--dfg-focus-ring-color', '--dfg-focus-ring-offset', '--dfg-focus-ring-width']);
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
