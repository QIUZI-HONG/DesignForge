import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * @dforge/cli 测试配置（#107 · 审计 10a）。
 *
 * fsModuleCachePath 按包隔离 vitest 5 的 fs 模块缓存，避免并行跑包时 ENOTEMPTY。
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
