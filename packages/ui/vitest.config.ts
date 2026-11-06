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
    // 覆盖率（audit-d08 · D-11）：v8 provider，只统计 `src/**` 源码（测试文件 /
    // 类型声明 / 测试装配不计入）；json-summary 供 CI 与审计脚本按文件取数。
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.d.ts', 'src/test-setup.ts'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
