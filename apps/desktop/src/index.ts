/**
 * @dforge/desktop —— 桌面最小壳（骨架占位）。
 *
 * 定位：Electron 窗口 + 装载 web 产物 + 安全基线断言骨架
 * （contextIsolation=true / sandbox=true / nodeIntegration=false / webSecurity=true）。
 * 接管票：FE-12（最小壳）；安全基线守卫挂点见根 scripts/guard-electron-baseline.mjs。
 */

/** 壳标识（占位导出，供冒烟测试与后续基线断言使用）。 */
export const DESKTOP_PACKAGE = '@dforge/desktop' as const;

/** 安全基线的四项开关名（FE-12 落地时按此逐项断言，禁止静默放宽）。 */
export const ELECTRON_SECURITY_BASELINE = [
  'contextIsolation',
  'sandbox',
  'nodeIntegration',
  'webSecurity',
] as const;
