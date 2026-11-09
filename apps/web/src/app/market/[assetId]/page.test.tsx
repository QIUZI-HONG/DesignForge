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
import { marketFixtures } from '@/features/market';

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

/** 默认路径先做端口窗健康探测：/health 回 200，其余请求回给定响应。 */
function respondAll(payload: unknown, status = 200): void {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/health')) return new Response('{}', { status: 200 });
    return jsonResponse(payload, status);
  });
}

describe('/market/[assetId] · E2 错误分类（not-found 与连接错误分流）', () => {
  it('daemon 404 market_asset_not_found → 独立「未找到该资产」空态 + 去市场出口', async () => {
    const user = userEvent.setup();
    respondAll(
      {
        ok: false,
        error: { code: 'market_asset_not_found', message: '资产不存在（可能未采集或已下架）' },
      },
      404,
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

describe('/market/[assetId] · 行为事件（票②）', () => {
  /** 抽取打到 /telemetry/events 的调用体。 */
  function telemetryCalls(): Array<{ name: string; payload: Record<string, unknown> }> {
    return fetchMock.mock.calls
      .filter((call) => String(call[0]).includes('/telemetry/events'))
      .map(
        (call) =>
          JSON.parse(String((call[1] as { body: string }).body)) as {
            name: string;
            payload: Record<string, unknown>;
          },
      );
  }

  it('详情就绪 → 发 market.asset-detail（含 assetId，且一次挂载只发一次）', async () => {
    const asset = marketFixtures.makeAsset();
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, result: { found: true, asset } }));
    render(<MarketAssetPage />);
    // 详情就绪的判据：详情容器挂上（本页不渲染 displayName 纯文本，徽标行是首屏标识）
    await waitFor(() => {
      expect(document.querySelector('[data-df-page="market-detail"]')).not.toBeNull();
    });
    await waitFor(() => {
      const calls = telemetryCalls().filter((call) => call.name === 'market.asset-detail');
      expect(calls).toHaveLength(1);
      expect(calls[0]?.payload).toEqual({ assetId: asset.id });
    });
  });

  it('资产不存在 → 不发 market.asset-detail（没有「查看」行为就没有事件）', async () => {
    respondAll(
      {
        ok: false,
        error: { code: 'market_asset_not_found', message: '资产不存在（可能未采集或已下架）' },
      },
      404,
    );
    render(<MarketAssetPage />);
    await waitFor(() => {
      expect(screen.getByText('未找到该资产')).toBeTruthy();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(telemetryCalls().some((call) => call.name === 'market.asset-detail')).toBe(false);
  });
});
