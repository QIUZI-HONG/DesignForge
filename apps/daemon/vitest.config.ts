import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * @dforge/daemon 测试配置（#107 · 审计 10a）。
 *
 * fsModuleCachePath 按包隔离 vitest 5 的 fs 模块缓存（默认在 workspace 根共享，
 * 并行跑包时偶发 ENOTEMPTY）；coverage 采集 src 下的产品源码，测试夹具（testing/）
 * 与测试文件不计入。
 */
export default defineConfig({
  test: {
    fsModuleCachePath: fileURLToPath(new URL('./node_modules/.vitest-cache', import.meta.url)),
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/testing/**'],
      // 阈值取 2026-10-17 实测值下取整（实测 statements 81.68 / branches 66.4 /
      // functions 84.86 / lines 86.28），只降不升；提升阈值需单独评审。
      thresholds: { statements: 78, branches: 63, functions: 80, lines: 83 },
    },
  },
});
