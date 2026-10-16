// @vitest-environment jsdom
/**
 * 资源详情路由测试（接缝：页面 × daemon 客户端的联合行为，用假 fetch 驱动）。
 *
 * 断言 E2 的错误分流（修复批次 4 / UX-15）：
 * - 资产不存在（daemon 404 `market_asset_not_found` 或信封 `found=false`）→ **独立**「未找到该资产」
 *   空态 + 去市场出口，绝不渲染「无法连接本地服务 / DAEMON_UNREACHABLE」（不误导用户排查本地服务）；
 * - 连接失败 → 「无法连接本地服务」错误态 + DAEMON_UNREACHABLE + 可重试（重试真的重新取数）。
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ assetId: 'gh:no/such#asset' }),
}));

import MarketAssetPage from './page';

const fetchMock = vi.fn();

beforeEach(() => {
  push.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('/market/[assetId] · E2 错误分类（not-found 与连接错误分流）', () => {
  it('daemon 404 market_asset_not_found → 独立「未找到该资产」空态 + 去市场出口', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          error: { code: 'market_asset_not_found', message: '资产不存在（可能未采集或已下架）' },
        },
        404,
      ),
    );
    const { container } = render(<MarketAssetPage />);

    await waitFor(() => {
      expect(screen.getByText('未找到该资产')).toBeTruthy();
    });
    expect(container.querySelector('[data-df-empty="not-found"]')).not.toBeNull();
    // 不得再复用连接错误外壳
    expect(screen.queryByText('无法连接本地服务')).toBeNull();
    expect(screen.queryByText('DAEMON_UNREACHABLE')).toBeNull();

    await user.click(screen.getByRole('button', { name: '去市场逛逛' }));
    expect(push).toHaveBeenCalledWith('/market');
  });

  it('信封成功但 found=false → 同一独立空态（不区分来源）', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, result: { found: false, assetId: 'gh:no/such#asset' } }),
    );
    render(<MarketAssetPage />);
    await waitFor(() => {
      expect(screen.getByText('未找到该资产')).toBeTruthy();
    });
    expect(screen.queryByText('DAEMON_UNREACHABLE')).toBeNull();
  });

  it('连接失败 → 「无法连接本地服务」错误态 + DAEMON_UNREACHABLE，重试真的重新取数', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    render(<MarketAssetPage />);

    await waitFor(() => {
      expect(screen.getByText('无法连接本地服务')).toBeTruthy();
    });
    expect(screen.getByText('DAEMON_UNREACHABLE')).toBeTruthy();
    expect(screen.queryByText('未找到该资产')).toBeNull();

    const before = fetchMock.mock.calls.length;
    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    });
  });
});
