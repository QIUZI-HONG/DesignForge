import { defineConfig } from 'vitest/config';

/**
 * apps/desktop 测试与覆盖率配置（audit-d08 · D-11）。
 *
 * 覆盖率口径：v8 provider，只统计 `src/**` 源码（测试文件 / 类型声明 / 测试夹具不计入），
 * 报告落 `coverage/`（根 .gitignore 已含，不进版本库）；reporter 带 `json-summary`
 * 供 CI 与审计脚本按文件取数（lines/branches pct）。
 * 桌面用例是纯静态/单测（CI 不拉 Electron 二进制），coverage 不引入任何二进制依赖。
 * `src/main/main.ts`（Electron 主进程入口）与 `src/preload/preload.cjs`（壳桥）须真二进制
 * 加载才执行——单测口径恒不可达，不计入（否则 coverage.all 会把它们按 0 行记账，与
 * TEST_REPORT §2 的基线度量不可比）。
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.d.ts',
        'src/main/main.ts',
        'src/preload/preload.cjs',
      ],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
