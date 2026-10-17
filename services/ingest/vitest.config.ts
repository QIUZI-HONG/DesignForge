import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * services/ingest 测试配置（修复批次 2 · CI 误红修复）。
 *
 * 为什么需要：本包用例是**剧本化离线回放的整管线计算**（collect → ODS → DWD → 识别 → 证据），
 * 单例本机 ~1–2s，CI runner 抖动可达 3–4×（实测 `verify-market/collect-bad-input` 的
 * 3000 条目用例：本机 1.3s / GitHub runner >5s，撞上 vitest 默认 5s 超时误红）。
 *
 * 这里**只放宽超时上限，不放宽任何断言**：真退化（复杂度劣化、挂起）仍会以超时失败，
 * 不引入假绿；也未声明 include，保持 vitest 默认取件口径不变。
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    // #107：按包隔离 vitest 5 的 fs 模块缓存（默认在 workspace 根共享，并行时偶发 ENOTEMPTY）。
    fsModuleCachePath: fileURLToPath(new URL('./node_modules/.vitest-cache', import.meta.url)),
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
