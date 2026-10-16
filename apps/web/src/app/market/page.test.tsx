// @vitest-environment jsdom
/**
 * 市场首页路由测试（接缝：页面 × daemon 客户端的联合行为，用假 fetch 驱动）。
 *
 * 断言六态挂在页面上是对的：正常（卡片网格）→ 搜索过滤 → 无结果空态；
 * 索引缺失 → 采集指引空态；daemon 不可达 → 错误态 + 重试。
 * 不测内部实现（不断言样式），只断言用户可见结构与关键文案。
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { marketFixtures } from '@/features/market';

// 夹具经 market 公开面取（`marketFixtures` 命名空间），不引 `__fixtures__` 深路径
const { makeAsset, makeQueryResponse } = marketFixtures;

// 路由能力：只测页面渲染与筛选，不做真实跳转。
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
}));

import MarketHomePage from './page';

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

/** 让假 fetch 返回一个成功信封。 */
function respondWith(result: unknown): void {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('/market · 正常路径（D1）', () => {
  it('从 daemon 取数并渲染卡片网格（含双语卡片与安装按钮）', async () => {
    respondWith(makeQueryResponse());
    render(<MarketHomePage />);

    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: 'PDF 导出' }).length).toBeGreaterThan(0);
    });
    expect(screen.getByText('技能市场')).toBeTruthy();
    expect(screen.getByText(/共 2 个资源 · 可装载 2 个/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '装载' }).length).toBe(2);
    expect(fetchMock).toHaveBeenCalled();
    const firstUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(firstUrl).toContain('/market/query');
    expect(firstUrl).toContain('sort=score');
  });

  it('搜索无结果 → 无结果空态；清空筛选后重新取数（不是加载态，也不是采集指引）', async () => {
    const user = userEvent.setup();
    respondWith(makeQueryResponse({ items: [], total: 0 }));
    render(<MarketHomePage />);
    await waitFor(() => {
      expect(screen.getByText('没有匹配的资源')).toBeTruthy();
    });
    expect(screen.queryByText(/市场索引尚未产出/)).toBeNull();

    const before = fetchMock.mock.calls.length;
    await user.type(screen.getByLabelText('搜索市场资源'), 'zzz');
    await waitFor(() => {
      expect(String((fetchMock.mock.calls.at(-1) as unknown[])[0])).toContain('q=zzz');
    });

    await user.click(screen.getByRole('button', { name: '清空筛选' }));
    await waitFor(() => {
      expect(String((fetchMock.mock.calls.at(-1) as unknown[])[0])).not.toContain('q=zzz');
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('/market · 空态与错误态（验收 §5）', () => {
  it('索引缺失 → 空态给「去跑采集」指引（不伪造数据）', async () => {
    respondWith(
      makeQueryResponse({
        items: [],
        total: 0,
        counts: null,
        generatedAt: null,
        warnings: [
          { code: 'index-missing', message: '尚无市场索引（等待采集线产出，属正常空态）' },
        ],
      }),
    );
    render(<MarketHomePage />);
    await waitFor(() => {
      expect(screen.getByText('市场索引尚未产出')).toBeTruthy();
    });
    expect(screen.getByText(/df market collect/)).toBeTruthy();
    expect(screen.queryAllByRole('heading', { name: 'PDF 导出' })).toHaveLength(0);
  });

  it('索引损坏 → 空态说明契约不符（重跑采集并校验）', async () => {
    respondWith(
      makeQueryResponse({
        items: [],
        total: 0,
        warnings: [{ code: 'index-invalid', message: '索引不兼容：schema 不匹配' }],
      }),
    );
    render(<MarketHomePage />);
    await waitFor(() => {
      expect(screen.getByText('市场索引无法解析')).toBeTruthy();
    });
  });

  it('daemon 不可达 → 错误态 + 重试（重试再次请求）', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    render(<MarketHomePage />);
    await waitFor(() => {
      expect(screen.getByText('无法连接本地服务')).toBeTruthy();
    });
    expect(screen.getByText('DAEMON_UNREACHABLE')).toBeTruthy();
    const before = fetchMock.mock.calls.length;
    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it('部分失败 → 结果区给提示条（有结果仍照常展示）', async () => {
    respondWith(
      makeQueryResponse({ warnings: [{ code: 'partial-failure', message: '部分来源加载失败' }] }),
    );
    render(<MarketHomePage />);
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('部分来源加载失败');
    });
  });
});

describe('/market · 客户端过滤与已装载（D3/§7.4）', () => {
  function seedLoaded(assetId: string): void {
    window.localStorage.setItem(
      'dfg.market.loaded.v1',
      JSON.stringify([
        {
          assetId,
          name: 'pdf-export',
          kind: 'skill',
          digest: 'sha256:old',
          ref: 'a1b2c3d',
          targetPath: '.dfg/market/skill/pdf-export/',
          capabilities: [],
          approvedAt: '2026-10-15T23:00:00Z',
          caller: 'user',
        },
      ]),
    );
  }

  it('本地已有装载记录 → 卡片显示「已装载」且 digest 变化提示可更新', async () => {
    respondWith(makeQueryResponse({ items: [makeAsset()], total: 1 }));
    seedLoaded(makeAsset().id);
    render(<MarketHomePage />);
    await waitFor(() => {
      expect(screen.getAllByText('已装载').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('可更新')).toBeTruthy();
  });

  it('切到「已装载」且本地无记录/无命中 → 已装载空态（引导回市场）', async () => {
    const user = userEvent.setup();
    respondWith(makeQueryResponse({ items: [makeAsset()], total: 1 }));
    render(<MarketHomePage />);
    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: 'PDF 导出' }).length).toBeGreaterThan(0);
    });
    await user.click(screen.getByRole('radio', { name: '已装载' }));
    await waitFor(() => {
      expect(screen.getByText('还没有装载任何资源')).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: '去市场' }));
    expect(screen.queryByText('还没有装载任何资源')).toBeNull();
  });

  it('点「装载」→ 打开确认框（dryRun 预览与一次性 token 入口）', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/market/load-plan')) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              assetId: 'gh:acme/skills#skills/pdf-export',
              mode: 'loadable',
              loadable: true,
              ackRequired: [],
              license: {
                spdx: 'MIT',
                gate: 'loadable',
                evidencePath: 'LICENSE',
                evidenceSha256: '77aa11',
              },
              targetPathHint: '.dfg/market/skill/pdf-export/',
              reasons: [],
              notice: '可装载：dryRun 预览 → 确认后单事务写入 → 审计留痕',
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ ok: true, result: makeQueryResponse({ items: [makeAsset()], total: 1 }) }),
        {
          status: 200,
        },
      );
    });

    render(<MarketHomePage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '装载' })).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: '装载' }));
    await waitFor(() => {
      expect(screen.getByText('装载位置')).toBeTruthy();
    });
    expect(screen.getByText('.dfg/market/skill/pdf-export/')).toBeTruthy();
    expect(screen.getByRole('button', { name: '批准并签发一次性 token' })).toBeTruthy();
  });

  it('点卡片名 → 进入详情路由（编码后的 assetId）', async () => {
    const user = userEvent.setup();
    respondWith(makeQueryResponse({ items: [makeAsset()], total: 1 }));
    render(<MarketHomePage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'PDF 导出' })).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: 'PDF 导出' }));
    expect(push).toHaveBeenCalledWith('/market/gh%3Aacme%2Fskills%23skills%2Fpdf-export');
  });
});
