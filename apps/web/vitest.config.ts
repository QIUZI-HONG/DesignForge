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
 * setupFiles：RTL 显式 cleanup（vitest 未开 globals）+ matchMedia 兜底，见 `src/test-setup.ts`。
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
  },
});
