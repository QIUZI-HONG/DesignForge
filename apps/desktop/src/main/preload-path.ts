/**
 * preload 路径解析。
 *
 * 为什么单列：沙箱 preload **必须是 CJS**（Electron 沙箱 preload 不走 ESM 加载器），而本包
 * `"type": "module"` 且 tsc 产出 ESM——故 preload 以手写 `.cjs` 直接入 `src/preload/`，
 * 由这里按「壳资源根 + 相对路径」解析，主进程不硬编码路径（打包期 P6 只需改这一个函数）。
 */
import { join } from 'node:path';

/** preload 在壳资源根下的相对路径（POSIX 形态，作为对外可断言的常量）。 */
export const PRELOAD_RELATIVE_PATH = 'src/preload/preload.cjs';

/** 解析 preload 绝对路径（`shellRoot` = apps/desktop 目录）。 */
export function resolvePreloadPath(shellRoot: string): string {
  return join(shellRoot, ...PRELOAD_RELATIVE_PATH.split('/'));
}
