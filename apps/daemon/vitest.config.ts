import { defineConfig } from 'vitest/config';

/**
 * @dforge/daemon 测试与覆盖率配置（audit-d08 · D-11）。
 *
 * 覆盖率口径：v8 provider，只统计 `src/**` 源码（测试文件 / 类型声明 / 测试夹具不计入），
 * 报告落 `coverage/`（根 .gitignore 已含，不进版本库）；reporter 带 `json-summary`
 * 供 CI 与审计脚本按文件取数（lines/branches pct）。
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.d.ts', 'src/testing/**'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
