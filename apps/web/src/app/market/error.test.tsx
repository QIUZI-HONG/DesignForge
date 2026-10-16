// @vitest-environment jsdom
/**
 * 市场路由段错误边界测试（W1 · 渲染期异常必须收敛为可见错误态，而不是白屏）。
 *
 * 断言对外行为：给出错误对象与 reset 即可渲染出可见错误态；点重试触发 reset
 * （Next App Router 段级边界的恢复入口）。不测内部实现。
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MarketErrorBoundary from './error';

afterEach(cleanup);

describe('/market 段错误边界', () => {
  it('渲染期异常 → 可见错误态（标题 + 说明），不是空白', () => {
    render(<MarketErrorBoundary error={new Error('boom')} reset={vi.fn()} />);
    expect(screen.getByText('市场页渲染出错')).toBeTruthy();
    expect(screen.getByText(/未预期的错误/)).toBeTruthy();
  });

  it('错误态有六态挂点（data-df-state="error"，截图/门禁定位用）', () => {
    const { container } = render(<MarketErrorBoundary error={new Error('boom')} reset={vi.fn()} />);
    expect(container.querySelector('[data-df-state="error"]')).not.toBeNull();
  });

  it('点「重试」→ 调用 reset（段级恢复）', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    render(<MarketErrorBoundary error={new Error('boom')} reset={reset} />);
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
