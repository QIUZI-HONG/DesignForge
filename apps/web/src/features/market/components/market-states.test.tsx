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

import { t } from '@/i18n';

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

describe('MarketErrorState · 错误态人话化（票 06 / spec P1-2）', () => {
  it('网络失败（daemon_unreachable）→ 人话主句 + 重试按钮；原始 message 与码沉进技术详情折叠', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { container } = render(
      <MarketErrorState
        message="TypeError: Failed to fetch"
        code="daemon_unreachable"
        onRetry={onRetry}
      />,
    );
    expect(container.querySelector('[data-df-state="error"]')).toBeTruthy();
    // 人话（标题 + 主句）替代裸英文直出
    expect(screen.getByText(t('market.error.title'))).toBeTruthy();
    expect(screen.getByText(t('market.error.network.human'))).toBeTruthy();
    expect(screen.queryByText('TypeError: Failed to fetch')?.closest('details')).not.toBeNull();
    // 原始技术串与归一码都在默认收起的折叠里（报障可引用）
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain('TypeError: Failed to fetch');
    expect(details?.textContent).toContain('DAEMON_UNREACHABLE');
    await user.click(screen.getByRole('button', { name: t('market.error.retry') }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('非网络失败（daemon 明确拒绝，有码有中文文案）→ message 原样描述，码收折叠', () => {
    const { container } = render(
      <MarketErrorState
        message="评分索引暂不可用"
        code="market_score_unavailable"
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText('评分索引暂不可用')).toBeTruthy();
    expect(screen.queryByText(t('market.error.network.human'))).toBeNull();
    const details = container.querySelector('details');
    expect(details?.textContent).toContain('MARKET_SCORE_UNAVAILABLE');
    // 非网络失败的 message 不再重复进折叠（人话在描述位）
    expect(details?.textContent).not.toContain('评分索引暂不可用');
  });
});

describe('MarketErrorState / MarketWarningBanner', () => {
  it('部分失败提示条有 role=status（读屏可播报）', () => {
    render(<MarketWarningBanner message="部分来源结果加载失败：rate limit" />);
    expect(screen.getByRole('status').textContent).toContain('rate limit');
  });
});
