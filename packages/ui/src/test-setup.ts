/**
 * 组件测试公共装配。
 *
 * - RTL 自动清理：vitest 未开 `globals`，RTL 不会自动 cleanup，此处显式在 afterEach 卸载；
 * - `matchMedia` 兜底：jsdom 未实现（组件若按视口降级不会误崩）。
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
