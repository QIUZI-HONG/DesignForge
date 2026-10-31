// @vitest-environment jsdom
/**
 * 数据看板路由测试（接缝：页面 × daemon 客户端的联合行为，用假 fetch 驱动；D6）。
 *
 * 巡检缺口④：看板空态说「先跑采集线」却不给命令（`collect-hint=0`），只有页头「返回市场」。
 * 断言空态内**直接可见采集命令提示**，且与市场首页空态**同源**：同一挂点
 * （`data-df-market="collect-hint"`）+ 同一 CLI 口径（`df market collect && df market score
 * && df market index`）+ 同一描述文案（`market.empty.indexMissing.desc`）。
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { marketFixtures } from '@/features/market';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
}));

import DashboardPage from './page';

const fetchMock = vi.fn();

beforeEach(() => {
  push.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 让假 fetch 对每次请求都新建成功信封 Response（body 只能消费一次）。 */
function respondWith(result: unknown): void {
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ ok: true, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

describe('/dashboard · 空态给采集命令提示（巡检缺口④）', () => {
  it('索引缺失 → 空态内直接可见采集命令（与市场首页空态同源挂点与 CLI 口径）', async () => {
    respondWith(
      marketFixtures.makeMissingIndexResponse([
        { code: 'index-missing', message: '尚无市场索引（等待采集线产出，属正常空态）' },
      ]),
    );
    render(<DashboardPage />);
    await waitForEmpty();
    const empty = document.querySelector('[data-df-empty="index-missing"]');
    expect(empty).not.toBeNull();
    // 同源文案：描述与市场首页共用 market.empty.indexMissing.desc
    expect(empty?.textContent).toContain('索引是市场卡片的唯一真值');
    // 同源命令：与市场首页空态同一挂点（data-df-market="collect-hint"）与同一 CLI 口径
    const hint = empty?.querySelector('[data-df-market="collect-hint"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain('df market collect && df market score && df market index');
  });

  it('索引损坏 → 空态内同样给采集命令（重跑采集线）', async () => {
    respondWith(
      marketFixtures.makeMissingIndexResponse([
        { code: 'index-invalid', message: '索引不兼容：schema 不匹配' },
      ]),
    );
    render(<DashboardPage />);
    await waitForEmpty('index-invalid');
    const hint = document.querySelector(
      '[data-df-empty="index-invalid"] [data-df-market="collect-hint"]',
    );
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain('df market collect');
  });
});

/** 等看板空态挂点出现（取数落定后渲染）。 */
async function waitForEmpty(kind = 'index-missing'): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (document.querySelector(`[data-df-empty="${kind}"]`) !== null) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`看板空态 [data-df-empty="${kind}"] 未出现`);
}
