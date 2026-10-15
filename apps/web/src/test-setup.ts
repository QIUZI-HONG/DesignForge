/**
 * apps/web 测试公共装配（FE-09 引入；其他前端票按需复用）。
 *
 * - RTL 自动清理：vitest 未开 `globals`，RTL 不会自动 cleanup，此处显式在 afterEach 卸载；
 * - `matchMedia` 兜底：jsdom 未实现（组件若按视口降级不会误崩）。
 * 与 `packages/ui/src/test-setup.ts` 同源口径（不在包间共享物上做耦合，各自持有薄装配）。
 */
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

if (typeof window !== 'undefined' && window.matchMedia === undefined) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
