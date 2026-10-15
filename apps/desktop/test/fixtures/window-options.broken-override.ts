/**
 * 反例 fixture：基线本身合规，但 `webPreferences` 在**展开之后**又放宽了 webSecurity——
 * 这正是「先展开基线、再悄悄放宽」的写法，守卫必须 exit 1。
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
      webSecurity: false,
      preload: preloadPath,
    },
  };
}
