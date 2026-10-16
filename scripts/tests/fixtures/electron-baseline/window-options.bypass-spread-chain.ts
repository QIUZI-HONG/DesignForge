/**
 * 对抗夹具（工作包 C · C7⑦，自补）：展开链（`...A` → `A = {...B}` → `B` 内含放宽项）。
 * 守卫的常量解析必须能跟进多跳（exit 1），否则「包两层变量」即可绕过。
 * 本文件不参与壳运行，仅被 `guard-electron-baseline.mjs --source=` 静态读取。
 */
export const SECURITY_BASELINE = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
} as const;

const INNER = { sandbox: false };
const OUTER = { ...INNER, preload: 'unused' };

export function buildWindowOptions({ preloadPath }: { preloadPath: string }) {
  return {
    webPreferences: {
      ...SECURITY_BASELINE,
      ...OUTER,
      preload: preloadPath,
    },
  };
}
