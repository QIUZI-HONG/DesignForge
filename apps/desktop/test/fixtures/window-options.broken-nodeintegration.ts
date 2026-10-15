/** 反例 fixture：渲染进程直连 Node（nodeIntegration: true）——守卫必须 exit 1。 */
export const SECURITY_BASELINE = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
} as const;

export function buildWindowOptions({ preloadPath }: { preloadPath: string }) {
  return { webPreferences: { ...SECURITY_BASELINE, preload: preloadPath } };
}
