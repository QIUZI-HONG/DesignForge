/**
 * 对抗夹具（工作包 C · C7⑤，自补）：后置覆盖藏在**局部常量**里，再展开进来
 * （`...LAX_OVERRIDES`）。守卫必须能解析同文件内的常量字面量（exit 1），
 * 否则「把放宽项挪进一个变量」就能绕过。
 * 本文件不参与壳运行，仅被 `guard-electron-baseline.mjs --source=` 静态读取。
 */
export const SECURITY_BASELINE = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
} as const;

/** 局部放宽项（真实现场常以「debug 附加项」名义存在）。 */
const LAX_OVERRIDES = {
  sandbox: false,
  webSecurity: false,
};

export function buildWindowOptions({ preloadPath }: { preloadPath: string }) {
  return {
    webPreferences: {
      ...SECURITY_BASELINE,
      ...LAX_OVERRIDES,
      preload: preloadPath,
    },
  };
}
