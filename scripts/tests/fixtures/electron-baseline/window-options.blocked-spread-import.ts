/**
 * 对抗夹具（工作包 C · C7⑧，自补）：展开一个**无法静态判定**的外部对象
 * （`...IMPORTED_PREFS`）——可能含放宽项，守卫既不能放行（假绿）也不能报违规（误报），
 * 只能记「无法判定」→ exit 2（阻塞）。
 * 本文件不参与壳运行，仅被 `guard-electron-baseline.mjs --source=` 静态读取。
 */
export const SECURITY_BASELINE = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
} as const;

declare const IMPORTED_PREFS: Record<string, unknown>;

export function buildWindowOptions({ preloadPath }: { preloadPath: string }) {
  return {
    webPreferences: {
      ...SECURITY_BASELINE,
      ...IMPORTED_PREFS,
      preload: preloadPath,
    },
  };
}
