// @vitest-environment jsdom
/**
 * 市场状态族测试（接缝：`MarketEmptyState` / `MarketErrorState` / `MarketWarningBanner`）。
 *
 * 断言四类空态**口径不混**：索引缺失/损坏给采集指引（CLI 命令），无结果给清空筛选，
 * 已装载空态引导回市场；错误态给重试；部分失败给提示条（role=status）。
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MARKET_COLLECT_COMMAND } from '../api';
import { MarketEmptyState, MarketErrorState, MarketWarningBanner } from './MarketStates';

afterEach(() => {
  cleanup();
});

describe('MarketEmptyState · 空态四类', () => {
  it('索引缺失：给「去跑采集」的 CLI 指引，不伪造数据', () => {
    const { container } = render(<MarketEmptyState kind="index-missing" />);
    expect(screen.getByText('市场索引尚未产出')).toBeTruthy();
    expect(screen.getByText(new RegExp(MARKET_COLLECT_COMMAND))).toBeTruthy();
    expect(container.querySelector('[data-df-state="empty"]')?.getAttribute('data-df-empty')).toBe(
      'index-missing',
    );
  });

  it('索引损坏：说明版本/字段不合契约', () => {
    const { container } = render(<MarketEmptyState kind="index-invalid" />);
    expect(screen.getByText('市场索引无法解析')).toBeTruthy();
    expect(container.querySelector('[data-df-empty="index-invalid"]')).toBeTruthy();
  });

  it('无结果：清空筛选按钮回调', async () => {
    const user = userEvent.setup();
    const onClearFilters = vi.fn();
    render(<MarketEmptyState kind="no-result" onClearFilters={onClearFilters} />);
    await user.click(screen.getByRole('button', { name: '清空筛选' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('已装载空态：引导回市场列表', async () => {
    const user = userEvent.setup();
    const onGoMarket = vi.fn();
    render(<MarketEmptyState kind="installed-empty" onGoMarket={onGoMarket} />);
    await user.click(screen.getByRole('button', { name: '去市场' }));
    expect(onGoMarket).toHaveBeenCalledTimes(1);
  });
});

describe('MarketErrorState / MarketWarningBanner', () => {
  it('错误态：显示消息与错误码，重试回调可触发', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { container } = render(
      <MarketErrorState message="请确认 daemon 已启动（默认 127.0.0.1:4318）" onRetry={onRetry} />,
    );
    expect(screen.getByText(/daemon 已启动/)).toBeTruthy();
    expect(screen.getByText('DAEMON_UNREACHABLE')).toBeTruthy();
    expect(container.querySelector('[data-df-state="error"]')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('部分失败提示条有 role=status（读屏可播报）', () => {
    render(<MarketWarningBanner message="部分来源结果加载失败：rate limit" />);
    expect(screen.getByRole('status').textContent).toContain('rate limit');
  });
});
