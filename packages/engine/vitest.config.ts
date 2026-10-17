import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * @dforge/engine 测试配置（#107 · 审计 10a）。
 *
 * fsModuleCachePath：vitest 5 默认把 fs 模块缓存放在 workspace 根的
 * `node_modules/.vitest-cache`；`pnpm -r test` 并行时多个包同时读写同一目录会偶发
 * ENOTEMPTY（审计 09 N-10）。这里固定到本包 node_modules，进程间不再共享。
 * coverage：v8 采集 src 下的产品源码（排除测试文件），阈值取实测值下留 2–5pp 余量。
 */
export default defineConfig({
  test: {
    fsModuleCachePath: fileURLToPath(new URL('./node_modules/.vitest-cache', import.meta.url)),
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // 阈值取 2026-10-17 实测值下留 2–5pp 余量（实测 statements 85.59 / branches 77.71 /
      // functions 85.49 / lines 88.95），只降不升；提升阈值需单独评审。
      thresholds: { statements: 82, branches: 75, functions: 82, lines: 85 },
    },
  },
});
