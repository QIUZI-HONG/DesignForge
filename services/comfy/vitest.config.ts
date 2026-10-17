import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * @dforge/comfy 测试配置（#107 · 审计 10a）。
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
      // 阈值取 2026-10-17 实测值下留 2–4pp 余量（实测 100/100/100/100，仅 1 个源文件），
      // 只降不升；提升阈值需单独评审。
      thresholds: { statements: 97, branches: 97, functions: 97, lines: 97 },
    },
  },
});
