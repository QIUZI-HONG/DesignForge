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
    // #107：vitest 5 默认把 fs 模块缓存放在 workspace 根共享（node_modules/.vitest-cache），
    // `pnpm -r test` 并行时偶发 ENOTEMPTY；按包固定后互不干扰。
    fsModuleCachePath: fileURLToPath(new URL('./node_modules/.vitest-cache', import.meta.url)),
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test-setup.ts'],
      // 阈值取 2026-10-17 实测值下留 2–4pp 余量（实测 statements 81.50 / branches 74.16 /
      // functions 81.45 / lines 84.49），只降不升；提升阈值需单独评审。
      thresholds: { statements: 78, branches: 71, functions: 78, lines: 81 },
    },
  },
});
