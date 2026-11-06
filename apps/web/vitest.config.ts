import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * apps/web 测试配置（FE-01 引入；其他前端票按需复用）。
 *
 * 为什么需要这个文件：Next 的 tsconfig 用 `jsx: "preserve"`（JSX 交给 Next 编译器），
 * 而 vitest 直接走 Vite 转译链，必须显式声明自动 JSX 运行时，
 * 否则 JSX 会以保留形式丢给运行时解析（`Expected jsx identifier` 类报错）。
 * 别名：与 `tsconfig.json` 的 `@/*` 对齐。
 * 环境：默认 node（页面级 smoke 用 `react-dom/server`）；需要 DOM 的用例，
 * 在文件头用 `// @vitest-environment jsdom` 单独切换。
 * setupFiles：RTL 显式 cleanup（vitest 未开 globals）+ matchMedia 兜底，见 `src/test-setup.ts`
 * （FE-02 / FE-09 各自引入同口径装配，合并后共用本文件）。
 */
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    // isolate: false——依据 tp2 优化批实验：两轮 1700 全绿、web 测试 12.4s→6.4s；RTL 每用例自动清理不受影响；仅 web 包启用。
    // tp2-05 重新落地：前置条件=F-3 五点卫生根治已入（test-setup.ts 全局兜底三件套 + 五点逐条），
    // 判定性验收=全 workspace `pnpm verify` ≥2 轮绿（上次翻车现场即 E1' 全链，见企业报告 v1.1 §isolate）。
    isolate: false,
    // 覆盖率（audit-d08 · D-11）：v8 provider，只统计 `src/**` 源码（测试文件 /
    // 类型声明 / 测试装配不计入）；json-summary 供 CI 与审计脚本按文件取数。
    // web 包 coverage 较慢（用例最多），CI 报数步不取本包（ci.yml 注释写明取舍）。
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.d.ts', 'src/test-setup.ts'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
