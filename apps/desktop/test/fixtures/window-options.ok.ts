/**
 * 正例 fixture：与真实 `window-options.ts` 同形，供守卫测试证明「检查器不是恒判失败」。
 * 本文件**不参与壳运行**，仅被 `guard-electron-baseline.mjs --source=` 静态读取。
 */
export const SECURITY_BASELINE = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
} as const;

export function buildWindowOptions({ preloadPath }: { preloadPath: string }) {
  return {
    webPreferences: {
      ...SECURITY_BASELINE,
      preload: preloadPath,
    },
  };
}
