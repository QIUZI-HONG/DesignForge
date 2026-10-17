import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * @dforge/ui 测试配置。
 *
 * 口径（_shared §3/§4）：组件测试走 jsdom + @testing-library/react，断言可观测行为
 * （键盘可达 / 焦点 / Esc / aria 角色），不测实现细节；令牌与守卫逻辑为纯函数测试。
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test-setup.ts'],
    // #107：按包隔离 vitest 5 的 fs 模块缓存（默认在 workspace 根共享，并行时偶发 ENOTEMPTY）。
    fsModuleCachePath: fileURLToPath(new URL('./node_modules/.vitest-cache', import.meta.url)),
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test-setup.ts'],
    },
  },
});
