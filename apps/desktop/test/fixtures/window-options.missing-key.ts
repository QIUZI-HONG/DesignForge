/**
 * 反例 fixture：基线缺一项（无 webSecurity）——静态判不出该键，fixture 运行禁用运行时探针，
 * 守卫必须 exit 2（阻塞），不得判通过。
 */
export const SECURITY_BASELINE = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  allowRunningInsecureContent: false,
} as const;

export function buildWindowOptions({ preloadPath }: { preloadPath: string }) {
  return { webPreferences: { ...SECURITY_BASELINE, preload: preloadPath } };
}
