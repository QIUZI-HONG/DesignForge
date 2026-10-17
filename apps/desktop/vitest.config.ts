import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * @dforge/desktop 测试配置（#107 · 审计 10a）。
 *
 * 桌面用例是纯静态/单测（不 require('electron')、不起真窗口）；
 * fsModuleCachePath 按包隔离，避免 `pnpm -r test` 并行时共享缓存触发 ENOTEMPTY。
 */
export default defineConfig({
  test: {
    fsModuleCachePath: fileURLToPath(new URL('./node_modules/.vitest-cache', import.meta.url)),
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
