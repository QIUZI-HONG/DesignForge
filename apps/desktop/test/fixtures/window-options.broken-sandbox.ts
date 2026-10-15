/** 反例 fixture：沙箱被关（sandbox: false）——守卫必须 exit 1。 */
export const SECURITY_BASELINE = {
  contextIsolation: true,
  sandbox: false,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
} as const;

export function buildWindowOptions({ preloadPath }: { preloadPath: string }) {
  return { webPreferences: { ...SECURITY_BASELINE, preload: preloadPath } };
}
