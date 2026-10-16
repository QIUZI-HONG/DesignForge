import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PRELOAD_RELATIVE_PATH, resolvePreloadPath } from './preload-path.js';

/** apps/desktop 目录（本测试文件位于 apps/desktop/src/main/）。 */
const shellRoot = fileURLToPath(new URL('../..', import.meta.url));

describe('preload 路径解析', () => {
  it('解析到 shellRoot 下的 preload 脚本', () => {
    expect(resolvePreloadPath('/opt/shell')).toBe('/opt/shell/src/preload/preload.cjs');
  });

  it('相对路径不含反斜杠且为 CJS 扩展名（沙箱 preload 不得是 ESM）', () => {
    expect(PRELOAD_RELATIVE_PATH).toBe('src/preload/preload.cjs');
  });

  it('真实产物存在（防「配了路径却没有文件」的静默失败）', () => {
    expect(existsSync(resolvePreloadPath(shellRoot))).toBe(true);
  });
});
