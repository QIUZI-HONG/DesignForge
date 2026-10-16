/**
 * 对抗夹具（工作包 C · C7②）：后置覆盖用**计算属性名** `['sandbox']: false`。
 * 覆盖语义与 `sandbox: false` 完全一致，守卫不得按「属性名是不是 Identifier」漏判（exit 1）。
 * 本文件不参与壳运行，仅被 `guard-electron-baseline.mjs --source=` 静态读取。
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
      ['sandbox']: false,
      preload: preloadPath,
    },
  };
}
