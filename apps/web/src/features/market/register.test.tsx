// @vitest-environment jsdom
/**
 * 编辑器内市场面板入口（票 16）——register 接缝的组件级测试。
 *
 * 接缝：`@/features/market/register` 的 `MarketPanelSlot`（承载既有市场面板内容与六态）
 * 挂进左栏扩展页签族（`left-panel-tabs` 槽 + `EditorPanels` 页签）后的可观测行为：
 * 入口渲染 → 打开市场面板 → 关闭回原页签；编辑器深色基准下主题不动根元素（无漂移、无残留）。
 * 数据面用假 fetch 驱动（与市场路由测试同一手法），不连 daemon。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPanelsSession, EditorPanels, PanelsProvider } from '@/features/editor-panels';
import { registerEditorSlotItem, resetEditorSlots } from '@/features/editor-shell';

import { makeQueryResponse } from './__fixtures__/market';
import { FEEDBACK_KEY, readFeedback } from './feedback';
import { MarketPanelSlot, MARKET_TAB_ID, marketTabLabel } from './register';

// 路由能力：只断言跳转落点，不做真实导航。
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  push.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  resetEditorSlots();
  vi.unstubAllGlobals();
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

/** 等面板数据就绪（data-df-page 取样名是既有 MarketPanel 的挂点）。 */
async function waitForPanelReady(): Promise<Element> {
  return await waitFor(() => {
    const node = document.querySelector('[data-df-page="market-panel"]');
    expect(node).not.toBeNull();
    return node as Element;
  });
}

describe('MarketPanelSlot · 编辑器内市场面板（数据接线）', () => {
  it('取数渲染既有面板内容（列表/详情/试跑 dryRun 说明），请求走综合评分前 8 口径', async () => {
    respondWith(makeQueryResponse());
    render(<MarketPanelSlot />);
    await waitForPanelReady();
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/market/query');
    expect(url).toContain('sort=score');
    expect(url).toContain('limit=8');
    expect(document.querySelectorAll('[data-df-market="panel-row"]').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-df-market="panel-run-note"]')?.textContent).toContain(
      'dryRun',
    );
  });

  it('试跑写本地计数（FEEDBACK_KEY；与 /market/panel 同一册），不发额外请求', async () => {
    respondWith(makeQueryResponse());
    render(<MarketPanelSlot />);
    const panel = await waitForPanelReady();
    const assetId = panel
      .querySelector('[data-df-market="panel-row"]')
      ?.getAttribute('data-df-asset');
    expect(assetId).toBeTruthy();
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '试跑（dryRun）' }));
    const book = readFeedback(window.localStorage);
    expect(book).toHaveLength(1);
    expect(book[0]?.assetId).toBe(assetId);
    expect(book[0]?.runs).toBe(1);
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(FEEDBACK_KEY.length).toBeGreaterThan(0); // 计数册的存储键与市场域同源
  });

  it('索引缺失 → 采集指引空态（与市场首页/看板同源，含命令提示）', async () => {
    respondWith(
      makeQueryResponse({ items: [], total: 0, warnings: [{ code: 'index-missing' }] }),
    );
    render(<MarketPanelSlot />);
    await waitFor(() => {
      expect(document.querySelector('[data-df-empty="index-missing"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-df-market="collect-hint"]')?.textContent).toContain(
      'df market collect',
    );
  });

  it('取数失败 → 错误态 + 重试（重试成功后面板恢复）', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    respondWith(makeQueryResponse());
    render(<MarketPanelSlot />);
    await waitFor(() => {
      expect(document.querySelector('[data-df-state="error"]')).not.toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitForPanelReady();
  });

  it('「打开详情」跳完整详情页（续写当前端点参数，D-3/UX-01 口径）', async () => {
    respondWith(makeQueryResponse());
    render(<MarketPanelSlot />);
    await waitForPanelReady();
    fireEvent.click(screen.getByRole('button', { name: '打开详情' }));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('/market/'));
  });
});

describe('编辑器内入口（左栏页签族 × 市场扩展页签，票 16 验收）', () => {
  /**
   * 完整编辑器左栏 + 已注册的市场扩展页签——注册形状与 editor-bootstrap 声明同源
   * （同 id / 同 label 单点 / render 挂 MarketPanelSlot），不拉起整棵编辑器树。
   */
  function mountEditorLeftRail() {
    const session = createPanelsSession();
    const unregister = registerEditorSlotItem('left-panel-tabs', {
      id: MARKET_TAB_ID,
      order: 0,
      label: marketTabLabel,
      render: () => <MarketPanelSlot />,
    });
    const view = render(
      <PanelsProvider session={session}>
        <EditorPanels />
      </PanelsProvider>,
    );
    return { session, view, unregister };
  }

  it('入口渲染并打开市场面板；关闭后回到原页签，面板卸载无状态残留', async () => {
    respondWith(makeQueryResponse());
    // 编辑器深色基准（EditorThemeScope 的落点：根元素 data-theme=dark）
    document.documentElement.dataset.theme = 'dark';
    const { session } = mountEditorLeftRail();
    expect(screen.getByRole('radio', { name: '市场' })).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: '市场' }));
    const panel = await waitForPanelReady();
    expect(panel.getAttribute('data-df-theme')).toBe('dark');
    expect(session.ui.getState().leftExtensionTab).toBe(MARKET_TAB_ID);

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(document.querySelector('[data-df-page="market-panel"]')).toBeNull();
    expect(session.ui.getState().leftExtensionTab).toBeNull();
    expect(session.ui.getState().leftTab).toBe('layers');
  });

  it('面板在编辑器深色基准下挂载无主题漂移：组件不改根元素，卸载后仍是深色', async () => {
    respondWith(makeQueryResponse());
    document.documentElement.dataset.theme = 'dark';
    const { view } = mountEditorLeftRail();
    fireEvent.click(screen.getByRole('radio', { name: '市场' }));
    await waitForPanelReady();
    expect(document.documentElement.dataset.theme).toBe('dark');

    // 卸载（切页签/关闭的 DOM 后果）：根元素主题不得被「恢复」成浅色——
    // 这是 /market/panel 页级主题开关不能带进编辑器的理由（带进来即漂移 + 残留）。
    view.unmount();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.querySelector('[data-df-page="market-panel"]')).toBeNull();
  });
});
