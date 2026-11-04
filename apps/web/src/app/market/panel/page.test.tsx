// @vitest-environment jsdom
/**
 * `/market/panel` 路由页测试（P1-5 六态提取的回归钉：页壳 + 共享六态体）。
 *
 * 自六态提取起，页面的**自有行为**只剩：深色主题开关（进入切 dark、卸载恢复）、
 * 页题/页提示、反馈键说明；面板内容与六态渲染归 `MarketPanelBody`（与编辑器左栏
 * `MarketPanelSlot` 同源，其行为钉在 `features/market/register.test.tsx`）。
 * 数据面用假 fetch 驱动（与市场路由测试同一手法），不连 daemon。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FEEDBACK_KEY, marketFixtures } from '@/features/market';

// 夹具经 market 公开面取（`marketFixtures` 命名空间），不引 `__fixtures__` 深路径
const { makeQueryResponse } = marketFixtures;

import MarketPanelPage from './page';

// 路由能力：共享六态体内部取 useRouter（详情跳转），组件级测试不拉真实 app router。
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // tp2-05 · F-3 ⑤：render/断言抛错路径的主题泄漏（页面组件卸载恢复不执行）由
  // `test-setup.ts` 全局兜底按用例前快照还原（结构修，等价 try/finally 覆盖）。
});

/** 让假 fetch 返回一个成功信封。 */
function respondWith(result: unknown): void {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('/market/panel 页（P1-5 六态提取后：页壳 + 共享六态体）', () => {
  it('页面 chrome：深色主题 + 页题 + 反馈键说明；面板内容来自共享六态体', async () => {
    respondWith(makeQueryResponse());
    const previous = document.documentElement.dataset.theme;
    const view = render(<MarketPanelPage />);

    expect(screen.getByText('编辑器内市场面板（D5）')).toBeTruthy();
    expect(document.querySelector('[data-df-market="panel-feedback-key"]')?.textContent).toContain(
      FEEDBACK_KEY,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-df-page="market-panel"]')).not.toBeNull();
    });
    // 请求口径与编辑器页签同源（共享 hook 单点）：综合评分前 8
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/market/query');
    expect(url).toContain('sort=score');
    expect(url).toContain('limit=8');

    view.unmount();
    // 页级主题开关只归本页：卸载恢复进页前的主题
    expect(document.documentElement.dataset.theme).toBe(previous ?? 'light');
  });

  it('索引缺失空态由共享六态体渲染（页壳零参与状态机）', async () => {
    respondWith(
      makeQueryResponse({
        items: [],
        total: 0,
        warnings: [{ code: 'index-missing', message: '索引不存在' }],
      }),
    );
    render(<MarketPanelPage />);
    await waitFor(() => {
      expect(document.querySelector('[data-df-empty="index-missing"]')).not.toBeNull();
    });
  });

  it('取数失败错误态 + 重试入口由共享六态体渲染', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    respondWith(makeQueryResponse());
    render(<MarketPanelPage />);
    await waitFor(() => {
      expect(document.querySelector('[data-df-state="error"]')).not.toBeNull();
    });
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });
});
