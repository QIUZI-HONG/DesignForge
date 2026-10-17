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
      // 阈值取 2026-10-17 实测值下留 2–4pp 余量（实测 statements 84.61 / branches 67.51 /
      // functions 85.71 / lines 86.00），只降不升；提升阈值需单独评审。
      thresholds: { statements: 81, branches: 64, functions: 82, lines: 83 },
    },
  },
});
