/**
 * 正例夹具（工作包 C · C7 配套）：与真实 `apps/desktop/src/main/window-options.ts` 同形——
 * **唯一** webPreferences 声明点、直接展开基线、展开后只加非基线键（含非字面量表达式 `ARGS`）。
 * 守卫修好（能抓覆盖）之后，这一例必须仍是 exit 0：不得为了抓骗子把正例判红。
 * 本文件不参与壳运行，仅被 `guard-electron-baseline.mjs --source=` 静态读取。
 */
export const SECURITY_BASELINE = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
} as const;

declare const EXTRA_ARGS: string[];

export function buildWindowOptions({ preloadPath }: { preloadPath: string }) {
  return {
    useContentSize: true,
    width: 1440,
    height: 900,
    webPreferences: {
      ...SECURITY_BASELINE,
      preload: preloadPath,
      // 非基线键 + 非字面量值：允许（守卫只对基线五项与声明点数量设硬约束）
      additionalArguments: EXTRA_ARGS.filter((item) => item !== ''),
    },
  };
}
