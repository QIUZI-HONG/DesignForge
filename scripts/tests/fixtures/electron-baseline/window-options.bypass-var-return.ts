/**
 * 对抗夹具（工作包 C · C7⑥，自补）：宽松配置**经变量**返回（`return { webPreferences: lax }`），
 * 与提前 return 同类——两个 webPreferences 声明点中有一个是放宽的，必须抓到（exit 1）。
 * 本文件不参与壳运行，仅被 `guard-electron-baseline.mjs --source=` 静态读取。
 */
export const SECURITY_BASELINE = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
} as const;

export function buildWindowOptions({
  preloadPath,
  debug,
}: {
  preloadPath: string;
  debug?: boolean;
}) {
  const lax = {
    contextIsolation: false,
    sandbox: false,
    nodeIntegration: true,
    webSecurity: false,
    allowRunningInsecureContent: true,
    preload: preloadPath,
  };
  if (debug === true) {
    return { webPreferences: lax };
  }
  return {
    webPreferences: {
      ...SECURITY_BASELINE,
      preload: preloadPath,
    },
  };
}
