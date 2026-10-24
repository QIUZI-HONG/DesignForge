/**
 * @dforge/ui · 双基准令牌（单一真源）。
 *
 * 口径（《前端实现规格 v1》§一.3 + 《对照页面清单 v1》§1.0 两套基准规范）：
 * - **浅色基准（首页族）**：主色 `#0D99FF`、选中底 `#E5F4FF`、描边 `#E6E6E6`、
 *   文字 `#1E1E1E`/`#757575`/`#B3B3B3`、控件高 32（舒适密度）；
 * - **深色基准（编辑器族 UI3）**：画布 `#1E1E1E`、面板 `#2C2C2C`、描边 `#3E3E3E`、
 *   组件紫/AI 紫 `#9747FF`、控件高 28（紧凑密度）；
 * - 主题与密度**是两条轴**：主题给语义色/阴影，密度给控件几何；每个主题声明默认密度，
 *   主题块里同时落「色 + 影 + 几何」，因此页面只需切 `data-theme` 即可整体换基准。
 *
 * 本文件是颜色/间距/圆角/字号的唯一定义处（`scripts/guard-tokens.mjs` 白名单）；
 * `tokens.css` 由 `flattenPrimitives()` / `flattenTheme()` 的同一套命名规则落盘，
 * `tokens.test.ts` 逐项断言两者一致——改令牌必须同时改 CSS，否则测试红。
 */

/** CSS 变量表（变量名 → 值）。 */
export type TokenVars = Record<string, string>;

/** 主题名：逐页对齐 Figma 本体（首页族浅色 / 编辑器深色），不做全站换肤。 */
export type ThemeName = 'light' | 'dark';

/** 密度名：舒适（首页族）↔ 紧凑（编辑器族）。 */
export type DensityName = 'comfortable' | 'compact';

/** kebab-case 转换：令牌路径段 → CSS 变量片段。 */
function kebab(segment: string): string {
  return segment.replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** CSS 变量名（`color.text.primary` → `--dfg-color-text-primary`）。 */
export function cssVarName(path: string): string {
  return `--dfg-${path.split('.').map(kebab).join('-')}`;
}

/** CSS 变量引用（组件样式统一走此函数，禁写裸变量名）。 */
export function cssVar(path: string): string {
  return `var(${cssVarName(path)})`;
}

// ---------------------------------------------------------------------------
// 一、原语刻度（主题无关；落 `:root`）
// ---------------------------------------------------------------------------

/** 圆角档位（3/6/8/13/999，清单 §1.0）。 */
export interface RadiusScale {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  pill: number;
}

/** 间距刻度（4 的倍数；含 8px 栅格档 2/4/6）。 */
export interface SpaceScale {
  0: number;
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
  6: number;
  8: number;
  10: number;
  12: number;
  16: number;
}

/** 字号档（浅色基准 11·12·13·15·18；20/24 供标题层级）。 */
export interface FontSizeScale {
  11: number;
  12: number;
  13: number;
  15: number;
  18: number;
  20: number;
  24: number;
}

/** 字重档（与离线捆绑的 Noto Sans SC 400/500/700 对齐）。 */
export interface FontWeightScale {
  regular: number;
  medium: number;
  bold: number;
}

/** 行高档（无单位比值）。 */
export interface LineHeightScale {
  tight: number;
  base: number;
  relaxed: number;
}

/** 动效时长档（≥150/200/300ms）。 */
export interface DurationScale {
  fast: number;
  base: number;
  slow: number;
}

/** 字距档（等宽数码/错误码用小间距拉开可读性）。 */
export interface LetterSpacingScale {
  tight: string;
  wide: string;
}

/** 动效曲线（标准进出 / 强调 / 退出）。 */
export interface EasingScale {
  standard: string;
  emphasized: string;
  exit: string;
}

/** 图标尺寸档（16px 线性为默认）。 */
export interface IconSizeScale {
  sm: number;
  md: number;
  lg: number;
}

/** 版面与浮层尺寸（侧栏 240 / 顶栏 56 取自浅色基准）。 */
export interface SizeScale {
  sidebar: number;
  topbar: number;
  toolbar: number;
  menuMinWidth: number;
  menuMaxHeight: number;
  drawerSm: number;
  drawerMd: number;
  drawerLg: number;
  modalSm: number;
  modalMd: number;
  modalLg: number;
  toastMaxWidth: number;
  tooltipMaxWidth: number;
  textareaMinHeight: number;
}

/** 层级（下拉 < 抽屉 < 模态 < Toast）。 */
export interface ZIndexScale {
  base: number;
  dropdown: number;
  drawer: number;
  modal: number;
  toast: number;
}

/** 描边宽档。 */
export interface BorderWidthScale {
  hairline: number;
  thick: number;
  focus: number;
}

/** 主题无关原语。 */
export interface Primitives {
  radius: RadiusScale;
  space: SpaceScale;
  fontSize: FontSizeScale;
  fontWeight: FontWeightScale;
  lineHeight: LineHeightScale;
  letterSpacing: LetterSpacingScale;
  duration: DurationScale;
  easing: EasingScale;
  iconSize: IconSizeScale;
  size: SizeScale;
  z: ZIndexScale;
  borderWidth: BorderWidthScale;
  /** 字体栈：与 apps/web `globals.css` 同名同值（Noto Sans SC 离线捆绑，禁止静默回退）。 */
  font: { sans: string };
}

/** 原语令牌。 */
export const PRIMITIVES: Primitives = {
  radius: { sm: 3, md: 6, lg: 8, xl: 13, pill: 999 },
  space: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 },
  fontSize: { 11: 11, 12: 12, 13: 13, 15: 15, 18: 18, 20: 20, 24: 24 },
  fontWeight: { regular: 400, medium: 500, bold: 700 },
  lineHeight: { tight: 1.2, base: 1.4, relaxed: 1.6 },
  letterSpacing: { tight: '-0.01em', wide: '0.04em' },
  duration: { fast: 150, base: 200, slow: 300 },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    emphasized: 'cubic-bezier(0.4, 0, 0.2, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
  },
  iconSize: { sm: 12, md: 16, lg: 24 },
  size: {
    sidebar: 240,
    topbar: 56,
    toolbar: 48,
    menuMinWidth: 160,
    menuMaxHeight: 320,
    drawerSm: 320,
    drawerMd: 420,
    drawerLg: 560,
    modalSm: 400,
    modalMd: 520,
    modalLg: 720,
    toastMaxWidth: 480,
    tooltipMaxWidth: 240,
    textareaMinHeight: 72,
  },
  z: { base: 0, dropdown: 1000, drawer: 1100, modal: 1200, toast: 1300 },
  borderWidth: { hairline: 1, thick: 2, focus: 2 },
  font: { sans: '"Noto Sans SC", ui-sans-serif, system-ui, sans-serif' },
};

// ---------------------------------------------------------------------------
// 二、密度映射（控件几何）
// ---------------------------------------------------------------------------

/** 密度刻度：只含随密度变化的控件几何，不含颜色。 */
export interface DensityScale {
  /** 控件高（按钮/输入/下拉触发器）。 */
  controlHeight: { sm: number; md: number; lg: number };
  /** 控件水平内边距。 */
  controlPaddingX: { sm: number; md: number; lg: number };
  /** 列表行 / 菜单条目高（F3 条目 32 高 = 舒适档 rowHeight.md）。 */
  rowHeight: { sm: number; md: number };
  /** 控件内图标与文字间距。 */
  iconGap: number;
  /** 控件内默认字号。 */
  fontSizeControl: number;
}

/** 密度映射：舒适（首页族，控件 32）↔ 紧凑（编辑器族，控件 28）。 */
export const DENSITY: Record<DensityName, DensityScale> = {
  comfortable: {
    controlHeight: { sm: 24, md: 32, lg: 40 },
    controlPaddingX: { sm: 8, md: 12, lg: 16 },
    rowHeight: { sm: 28, md: 32 },
    iconGap: 8,
    fontSizeControl: 13,
  },
  compact: {
    controlHeight: { sm: 20, md: 28, lg: 36 },
    controlPaddingX: { sm: 6, md: 10, lg: 14 },
    rowHeight: { sm: 24, md: 28 },
    iconGap: 6,
    fontSizeControl: 12,
  },
};

// ---------------------------------------------------------------------------
// 三、语义色与阴影（两套基准）
// ---------------------------------------------------------------------------

/** 语义色：键集在两套主题间必须一致（测试断言），占位语义而非具体色值。 */
export interface ThemeColors {
  /** 主色族（主色 = Figma 蓝 #0D99FF）。 */
  primary: string;
  primaryHover: string;
  primaryPressed: string;
  onPrimary: string;
  /** 选中底（浅色基准 #E5F4FF）与选中态前景。 */
  selection: string;
  selectionText: string;
  /** 面板/卡片底；浮层底；次级底（侧栏/内嵌区）。 */
  surface: string;
  surfaceRaised: string;
  surfaceSubtle: string;
  /** 画布/内容区底（深色基准 #1E1E1E）。 */
  canvas: string;
  /** 描边：常规 / 强调（聚焦、选中）。 */
  border: string;
  borderStrong: string;
  /** 文字三级（浅色基准 #1E1E1E/#757575/#B3B3B3）。 */
  text: { primary: string; secondary: string; disabled: string };
  /** 图标三级（可与文字分叉，默认同族）。 */
  icon: { primary: string; secondary: string; disabled: string };
  /** 半透明悬停/按下覆盖（叠在任何底上都可用）。 */
  hover: string;
  pressed: string;
  /** 骨架屏底色与高光。 */
  skeleton: string;
  skeletonHighlight: string;
  /** 语义族：危险（删除类）/ 成功 / 警告 / 信息。 */
  danger: string;
  dangerHover: string;
  dangerPressed: string;
  onDanger: string;
  dangerSubtle: string;
  success: string;
  onSuccess: string;
  successSubtle: string;
  warning: string;
  onWarning: string;
  warningSubtle: string;
  info: string;
  infoSubtle: string;
  /** 组件紫 / AI 紫（#9747FF）——组件与 AI 语义专用。 */
  component: string;
  /** 键盘焦点环。 */
  focusRing: string;
  /** 模态/抽屉遮罩。 */
  backdrop: string;
  /** 遮罩上的前景色（阻塞遮罩文案/图标；遮罩本身两套主题都偏暗，前景固定浅色）。 */
  onBackdrop: string;
}

/** 阴影：浅色弱、深色重（深底上需要更高不透明度才可见）。 */
export interface ThemeShadows {
  sm: string;
  md: string;
  lg: string;
  popover: string;
}

/** 一套主题 = 语义色 + 阴影 + 默认密度。 */
export interface Theme {
  name: ThemeName;
  /** 用给 `color-scheme` / 原生控件（滚动条、表单）的口径。 */
  colorScheme: 'light' | 'dark';
  density: DensityName;
  colors: ThemeColors;
  shadows: ThemeShadows;
}

const LIGHT_COLORS: ThemeColors = {
  primary: '#0d99ff',
  primaryHover: '#0b87e0',
  primaryPressed: '#0977c7',
  onPrimary: '#ffffff',
  selection: '#e5f4ff',
  selectionText: '#0d99ff',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  surfaceSubtle: '#f5f5f5',
  canvas: '#ffffff',
  border: '#e6e6e6',
  borderStrong: '#b3b3b3',
  text: { primary: '#1e1e1e', secondary: '#757575', disabled: '#b3b3b3' },
  icon: { primary: '#1e1e1e', secondary: '#757575', disabled: '#b3b3b3' },
  hover: 'rgba(0, 0, 0, 0.04)',
  pressed: 'rgba(0, 0, 0, 0.08)',
  skeleton: '#e6e6e6',
  skeletonHighlight: '#f0f0f0',
  danger: '#f24822',
  dangerHover: '#d93e1b',
  dangerPressed: '#bf3415',
  onDanger: '#ffffff',
  dangerSubtle: 'rgba(242, 72, 34, 0.1)',
  success: '#14ae5c',
  onSuccess: '#ffffff',
  successSubtle: 'rgba(20, 174, 92, 0.1)',
  warning: '#ffcd29',
  onWarning: '#1e1e1e',
  warningSubtle: 'rgba(255, 205, 41, 0.18)',
  info: '#0d99ff',
  infoSubtle: 'rgba(13, 153, 255, 0.1)',
  component: '#9747ff',
  focusRing: '#0d99ff',
  backdrop: 'rgba(0, 0, 0, 0.5)',
  onBackdrop: '#ffffff',
};

const DARK_COLORS: ThemeColors = {
  primary: '#0d99ff',
  primaryHover: '#2499f0',
  primaryPressed: '#0b87e0',
  onPrimary: '#ffffff',
  selection: '#0d99ff',
  selectionText: '#ffffff',
  surface: '#2c2c2c',
  surfaceRaised: '#383838',
  surfaceSubtle: '#252525',
  canvas: '#1e1e1e',
  border: '#3e3e3e',
  borderStrong: '#5a5a5a',
  text: { primary: '#ffffff', secondary: '#b3b3b3', disabled: '#757575' },
  icon: { primary: '#ffffff', secondary: '#b3b3b3', disabled: '#757575' },
  hover: 'rgba(255, 255, 255, 0.06)',
  pressed: 'rgba(255, 255, 255, 0.1)',
  skeleton: '#3e3e3e',
  skeletonHighlight: '#4a4a4a',
  danger: '#f24822',
  dangerHover: '#ff5b38',
  dangerPressed: '#d93e1b',
  onDanger: '#ffffff',
  dangerSubtle: 'rgba(242, 72, 34, 0.18)',
  success: '#14ae5c',
  onSuccess: '#ffffff',
  successSubtle: 'rgba(20, 174, 92, 0.18)',
  warning: '#ffcd29',
  onWarning: '#1e1e1e',
  warningSubtle: 'rgba(255, 205, 41, 0.22)',
  info: '#0d99ff',
  infoSubtle: 'rgba(13, 153, 255, 0.18)',
  component: '#9747ff',
  focusRing: '#0d99ff',
  backdrop: 'rgba(0, 0, 0, 0.6)',
  onBackdrop: '#ffffff',
};

/** 两套基准主题。 */
export const THEMES: Record<ThemeName, Theme> = {
  light: {
    name: 'light',
    colorScheme: 'light',
    density: 'comfortable',
    colors: LIGHT_COLORS,
    shadows: {
      sm: '0 1px 2px rgba(0, 0, 0, 0.08)',
      md: '0 4px 12px rgba(0, 0, 0, 0.12)',
      lg: '0 8px 24px rgba(0, 0, 0, 0.16)',
      popover: '0 4px 16px rgba(0, 0, 0, 0.14)',
    },
  },
  dark: {
    name: 'dark',
    colorScheme: 'dark',
    density: 'compact',
    colors: DARK_COLORS,
    shadows: {
      sm: '0 1px 2px rgba(0, 0, 0, 0.32)',
      md: '0 4px 12px rgba(0, 0, 0, 0.4)',
      lg: '0 8px 24px rgba(0, 0, 0, 0.48)',
      popover: '0 4px 16px rgba(0, 0, 0, 0.44)',
    },
  },
};

/** 按名取主题（组件/页面切主题的唯一入口）。 */
export function themeOf(name: ThemeName): Theme {
  return THEMES[name];
}

/**
 * 把主题落到**文档根**（`<html data-theme="…">`）——消费方切主题的推荐入口。
 *
 * 口径（《前端验收标准 v1》§3「主题逐页对齐 Figma 本体，不做全站换肤」）：
 * 主题是**文档级属性**，不是容器级属性。令牌选择器因此写成 `:root[data-theme=…]`——
 * 这既保证「一个页面一套基准」，也保证**门户浮层**（Modal/Drawer/Toast 挂在 `document.body`）
 * 能继承到同一套令牌。反面：在嵌套容器上写 `data-theme` 会**静默失效**（选择器不匹配，
 * 全页仍用根上的令牌），所以不要再手写 `element.dataset.theme`——统一走本函数。
 *
 * SSR 安全：无 `document` 时不做事（首屏主题由服务端渲染的 `<html data-theme>` 决定）。
 */
export function applyDocumentTheme(name: ThemeName): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = name;
}

// ---------------------------------------------------------------------------
// 四、展平（TS → CSS 变量；tokens.css 与测试共用同一套命名规则）
// ---------------------------------------------------------------------------

/** 无单位令牌（不加 px 后缀）：字重、行高、层级。 */
function isUnitless(name: string): boolean {
  return (
    name.startsWith('--dfg-font-weight-') ||
    name.startsWith('--dfg-line-height-') ||
    name.startsWith('--dfg-z-')
  );
}

/**
 * 时长令牌（补 ms 后缀）：CSS `<time>` 必须带时间单位——落成 px 会让引用它的
 * `transition` / `animation` 整条声明非法、被浏览器静默丢弃（总纲 §1 F-1 病灶，
 * 全部组件动效因此从未生效）。数字默认补 px 的规则只属于长度类。
 */
function isDuration(name: string): boolean {
  return name.startsWith('--dfg-duration-');
}

/** 令牌值 → CSS 声明值（时长补 ms、无单位类裸数字、其余数字默认补 px）。 */
function toCssValue(name: string, value: string | number): string {
  if (typeof value === 'string') return value;
  if (isUnitless(name)) return String(value);
  if (isDuration(name)) return `${value}ms`;
  return `${value}px`;
}

/** 递归展平：数字/字符串成叶子，对象成变量名前缀。 */
function flattenInto(value: object, prefix: string, out: TokenVars): void {
  for (const [key, child] of Object.entries(value)) {
    const name = `${prefix}-${kebab(key)}`;
    if (typeof child === 'number' || typeof child === 'string') {
      out[name] = toCssValue(name, child);
      continue;
    }
    if (child !== null && typeof child === 'object') flattenInto(child, name, out);
  }
}

/** 主题无关原语的 CSS 变量（落 `:root`）。 */
export function flattenPrimitives(): TokenVars {
  const out: TokenVars = {};
  flattenInto(PRIMITIVES, '--dfg', out);
  return out;
}

/** 单套主题的 CSS 变量（色 + 影 + 密度几何；落 `:root[data-theme="…"]`）。 */
export function flattenTheme(theme: Theme): TokenVars {
  const out: TokenVars = {};
  flattenInto(theme.colors, '--dfg-color', out);
  flattenInto(theme.shadows, '--dfg-shadow', out);
  flattenInto(DENSITY[theme.density], '--dfg', out);
  return out;
}
