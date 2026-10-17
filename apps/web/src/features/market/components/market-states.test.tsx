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
import {
  MarketEmptyState,
  MarketErrorState,
  MarketPageEmptyState,
  MarketWarningBanner,
} from './MarketStates';

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

describe('MarketPageEmptyState · 页内空态（DEF-01）', () => {
  function renderPageEmpty(
    mode: 'filters' | 'featured' | 'installed',
    overrides: Partial<Parameters<typeof MarketPageEmptyState>[0]> = {},
  ) {
    const props = {
      mode,
      loaded: 60,
      total: 284,
      remaining: 224,
      loadMoreState: 'idle' as const,
      loadMoreError: null,
      onLoadMore: vi.fn(),
      onClearFilters: vi.fn(),
      onCancelFeatured: vi.fn(),
      onGoMarket: vi.fn(),
      ...overrides,
    };
    return { ...render(<MarketPageEmptyState {...props} />), props };
  }

  it('filters：说明已检查范围与剩余条数，主「加载更多」+ 次「清空筛选」', async () => {
    const user = userEvent.setup();
    const { props, container } = renderPageEmpty('filters');
    expect(container.querySelector('[data-df-empty="no-result-page"]')).toBeTruthy();
    expect(container.querySelector('[data-df-state="empty"]')).toBeTruthy();
    expect(screen.getByText('当前已加载的 60 条中没有匹配')).toBeTruthy();
    expect(screen.getByText(/还有 224 条未检查/)).toBeTruthy();
    const pagination = container.querySelector('[data-df-market="pagination"]');
    expect(pagination?.getAttribute('role')).toBe('status');
    expect(pagination?.getAttribute('aria-live')).toBe('polite');
    expect(pagination?.textContent).toContain('已加载 60 / 284');
    await user.click(screen.getByRole('button', { name: '加载更多' }));
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '清空筛选' }));
    expect(props.onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('featured：主「加载更多」+ 次「取消精选」', async () => {
    const user = userEvent.setup();
    const { props } = renderPageEmpty('featured');
    expect(screen.getByText('当前已加载的 60 条中没有精选')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '取消精选' }));
    expect(props.onCancelFeatured).toHaveBeenCalledTimes(1);
  });

  it('installed：主「加载更多」+ 次「去市场」', async () => {
    const user = userEvent.setup();
    const { props } = renderPageEmpty('installed');
    expect(screen.getByText('当前已加载的 60 条中没有已装载资源')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '去市场' }));
    expect(props.onGoMarket).toHaveBeenCalledTimes(1);
  });

  it('加载更多中：主按钮 loading（aria-busy + loadingLabel）', () => {
    renderPageEmpty('filters', { loadMoreState: 'loading' });
    const button = screen.getByRole('button', { name: '正在加载…' });
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('加载更多失败：role=alert 给失败文案与「重试」（同一 offset 重试）', async () => {
    const user = userEvent.setup();
    const { props, container } = renderPageEmpty('filters', {
      loadMoreState: 'error',
      loadMoreError: 'boom',
    });
    const alert = container.querySelector('[data-df-market="pagination"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('加载更多失败');
    expect(alert?.textContent).toContain('boom');
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
  });
});

describe('MarketEmptyState · 终点空态（DEF-01）', () => {
  it('精选终点：说明已检查全部并给「取消精选」', async () => {
    const user = userEvent.setup();
    const onCancelFeatured = vi.fn();
    render(<MarketEmptyState kind="featured-empty" onCancelFeatured={onCancelFeatured} />);
    expect(screen.getByText('当前没有精选资源')).toBeTruthy();
    expect(screen.getByText(/已检查全部/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '取消精选' }));
    expect(onCancelFeatured).toHaveBeenCalledTimes(1);
  });

  it('无结果可用「去市场」出口（已装载终点）', async () => {
    const user = userEvent.setup();
    const onGoMarket = vi.fn();
    render(<MarketEmptyState kind="no-result" note="已检查全部 3 条。" onGoMarket={onGoMarket} />);
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
