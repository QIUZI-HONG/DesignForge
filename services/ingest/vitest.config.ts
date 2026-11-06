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
    // 覆盖率（audit-d08 · D-11）：v8 provider，只统计 `src/**` 源码（测试文件 /
    // 类型声明 / 冻结样本与快照夹具不计入——coverage.all 会把未被 import 的样本数据
    // 按 0 行记账，计入即与 TEST_REPORT §2 基线不可比）；json-summary 供 CI 与审计脚本按文件取数。
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.d.ts',
        'src/**/__fixtures__/**',
        'src/**/__snapshots__/**',
      ],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
