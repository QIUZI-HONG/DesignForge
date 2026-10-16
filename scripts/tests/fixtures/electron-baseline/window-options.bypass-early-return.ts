/**
 * 对抗夹具（工作包 C · C7③）：宽松配置藏在 **if 分支的提前 return** 里。
 * 守卫只扫函数体顶层的 return 时读不到它（「最后一个 webPreferences 字面量」仍是安全那个）→
 * 必须按「唯一声明点」判定并抓到（exit 1），否则控制流可绕过静态判定。
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
  if (debug === true) {
    return {
      webPreferences: {
        contextIsolation: false,
        sandbox: false,
        nodeIntegration: true,
        webSecurity: false,
        allowRunningInsecureContent: true,
        preload: preloadPath,
      },
    };
  }
  return {
    webPreferences: {
      ...SECURITY_BASELINE,
      preload: preloadPath,
    },
  };
}
