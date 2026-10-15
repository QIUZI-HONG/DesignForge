/**
 * 桌面壳窗口口径与安全基线 —— 壳的**唯一**窗口选项真源。
 *
 * 为什么单列一个模块：`scripts/guard-electron-baseline.mjs` 要**静态读**这里的对象字面量来做
 * 基线断言（五项取值 + 不得被后置覆盖）。故本模块的对象必须保持**纯字面量**形状：
 * 键值直书，禁止条件展开、环境变量注入或函数拼装；任何间接化都会让守卫退化为运行时探针。
 *
 * 依据：`docs/spec/frontend-impl-spec-v1.md` §一.6（壳）；
 * 尺寸依据：`docs/spec/acceptance-standard-v1.md` §3（1440×900 CSS 主基准 + 窄窗不破版）。
 */
import type { BrowserWindowConstructorOptions } from 'electron';

/** 安全基线五项：四项硬断言（票面）+ 禁不安全内容加载。取值即 Electron `webPreferences` 语义。 */
export const SECURITY_BASELINE = {
  /** 渲染进程与 preload 上下文隔离。 */
  contextIsolation: true,
  /** 渲染进程沙箱（preload 仅得受限 require）。 */
  sandbox: true,
  /** 渲染进程不得直连 Node（本地能力一律走 preload 白名单 / daemon）。 */
  nodeIntegration: false,
  /** 禁关闭同源策略——壳内渲染须与浏览器同口径（验收标准 §3 壳内条款）。 */
  webSecurity: true,
  /** 混合内容中的不安全脚本一律不跑（本地文件装载场景的兜底）。 */
  allowRunningInsecureContent: false,
} as const;

/** 默认窗口尺寸 = 验收基准视口（1440×900 CSS 逻辑像素，验收标准 §3）。 */
export const WINDOW_SIZE = {
  width: 1440,
  height: 900,
} as const;

/** 窄窗下限：1280×800 / 1024×768 两档窄窗须「不破版」（验收标准 §3）。 */
export const WINDOW_MIN_SIZE = {
  width: 1024,
  height: 768,
} as const;

/** 窗口标题：产品名（zh-CN 唯一暴露，见 GLOSSARY「设界」）。 */
export const WINDOW_TITLE = '设界';

/** 建窗入参；preload 路径由调用方解析（沙箱下必须为 CJS，见 `preload-path.ts`）。 */
export interface BuildWindowOptionsInput {
  /** preload 脚本绝对路径。 */
  preloadPath: string;
}

/**
 * 生成 `BrowserWindow` 构造选项。
 *
 * ⚠️ `webPreferences` 必须是 `SECURITY_BASELINE` 的**直接展开**，且其后**不得**出现同名键覆盖——
 * `scripts/guard-electron-baseline.mjs` 对此做 AST 断言（防「先展开基线、再悄悄放宽」）。
 */
export function buildWindowOptions({
  preloadPath,
}: BuildWindowOptionsInput): BrowserWindowConstructorOptions {
  return {
    width: WINDOW_SIZE.width,
    height: WINDOW_SIZE.height,
    minWidth: WINDOW_MIN_SIZE.width,
    minHeight: WINDOW_MIN_SIZE.height,
    show: false,
    title: WINDOW_TITLE,
    autoHideMenuBar: true,
    webPreferences: {
      ...SECURITY_BASELINE,
      preload: preloadPath,
    },
  };
}
