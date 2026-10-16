/**
 * 对抗夹具（工作包 C · C7④，自补）：后置覆盖用**字符串字面量属性名** `'sandbox': false`。
 * 与计算属性名同类（覆盖语法不同、语义相同），守卫必须抓到（exit 1）。
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
      'nodeIntegration': true,
      preload: preloadPath,
    },
  };
}
