/**
 * 对抗夹具（工作包 C · C7①）：后置覆盖写成**对象展开** `...{ sandbox: false }`。
 * 覆盖与数据类写入同义，守卫必须抓到（exit 1）；抓不到 = 假阴性。
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
      ...{ sandbox: false },
      preload: preloadPath,
    },
  };
}
