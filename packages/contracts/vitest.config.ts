import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * @dforge/contracts 测试配置（#107 · 审计 10a）。
 *
 * fsModuleCachePath 按包隔离 vitest 5 的 fs 模块缓存（默认在 workspace 根共享，
 * 并行跑包时偶发 ENOTEMPTY）；coverage 采集 src 下的产品源码并排除测试。
 */
export default defineConfig({
  test: {
    fsModuleCachePath: fileURLToPath(new URL('./node_modules/.vitest-cache', import.meta.url)),
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // 阈值取 2026-10-17 实测值下留 2–5pp 余量（实测 statements 87.89 / branches 82.56 /
      // functions 98.33 / lines 92.7），只降不升；提升阈值需单独评审。
      thresholds: { statements: 85, branches: 80, functions: 95, lines: 90 },
    },
  },
});
