// @vitest-environment jsdom
/**
 * 对抗测试（验证方 test/verify-web-b）· 市场页在**信封状但内层形状坏**时的表现。
 *
 * 风险点（任务书 §1）：daemon（或中间反代）返回 `{ok:true,result:null}` /
 * 内层字段为 null —— 是否给可读出口，还是静默空白/直接崩。
 * 用假 fetch 驱动页面（与 `page.test.tsx` 同口径）。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
}));

import MarketHomePage from './page';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function respondWith(result: unknown): void {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('对抗 · 内层形状坏时的市场页', () => {
  // 原为 it.fails（缺陷证据）：result:null 时页面既无错误态也无空态，结果区静默空白。
  // 修法落地（信封形状校验归一为错误态）后按验证方注释改回 it()。
  it('result 为 null → 结果区必须有可读出口（错误态或空态），不得静默空白', async () => {
    respondWith(null);
    const { container } = render(<MarketHomePage />);
    // 等一帧，让 loading 落定
    await screen.findByText('技能市场');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const hasExit =
      container.querySelector('[data-df-state="empty"]') !== null ||
      screen.queryByRole('button', { name: /重试/ }) !== null;
    expect(hasExit).toBe(true);
  });

  // 原为 it.fails（缺陷证据）：内层 `items`/`warnings` 为 null 时，
  // `classifyMarketOutcome` 在读 `warnings.some` 时抛 TypeError，渲染期崩溃；
  // jsdom 下由 React 上报为 unhandled error（无错误边界 → 整树卸载 = 白屏）。
  // 修法落地（信封形状校验 → 渲染期不再吃到 null）后按验证方注释改回 it()。
  it('内层字段为 null（items/warnings）→ 页面不得崩溃（有错误边界兜底）', async () => {
    respondWith({ schema: 'df.marketplace.index/v1', state: 'empty', items: null, warnings: null });
    let caught: unknown = null;
    class Boundary extends Component<{ children: ReactNode }> {
      override componentDidCatch(error: unknown) {
        caught = error;
      }
      override render() {
        return this.props.children;
      }
    }
    render(
      <Boundary>
        <MarketHomePage />
      </Boundary>,
    );
    await screen.findByText('技能市场');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(caught).toBeNull();
  });

  it('信封是失败（ok:false）→ 错误态 + 重试，不静默', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: { code: 'internal', message: '坏了' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(<MarketHomePage />);
    expect(await screen.findByText(/坏了/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /重试/ })).toBeTruthy();
  });
});

/** 契约外的内层形状变体（每一项都是「无分支可匹配」的候选输入）。 */
const badInnerShapes: Array<{ name: string; result: unknown }> = [
  { name: 'result 为 null', result: null },
  { name: 'result 为字符串', result: 'boom' },
  {
    name: 'items 为对象而非数组',
    result: {
      schema: 'df.marketplace.index/v1',
      state: 'empty',
      generatedAt: null,
      total: 0,
      counts: null,
      items: {},
      warnings: [],
    },
  },
  {
    name: 'warnings 为 null',
    result: {
      schema: 'df.marketplace.index/v1',
      state: 'empty',
      generatedAt: null,
      total: 0,
      counts: null,
      items: [],
      warnings: null,
    },
  },
  {
    name: 'warnings 元素为 null',
    result: {
      schema: 'df.marketplace.index/v1',
      state: 'empty',
      generatedAt: null,
      total: 0,
      counts: null,
      items: [],
      warnings: [null],
    },
  },
  {
    name: 'total 为字符串',
    result: {
      schema: 'df.marketplace.index/v1',
      state: 'empty',
      generatedAt: null,
      total: '3',
      counts: null,
      items: [],
      warnings: [],
    },
  },
];

describe('对抗 · 内层形状变体（补充：坏字段不得静默、不得白屏）', () => {
  it.each(badInnerShapes)('$name → 结果区给可读出口（错误态或空态）', async ({ result }) => {
    respondWith(result);
    const { container } = render(<MarketHomePage />);
    await screen.findByText('技能市场');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const hasExit =
      container.querySelector('[data-df-state="empty"]') !== null ||
      container.querySelector('[data-df-state="error"]') !== null ||
      screen.queryByRole('button', { name: /重试/ }) !== null;
    expect(hasExit).toBe(true);
  });

  it.each(badInnerShapes)('$name → 渲染期不抛异常（无错误边界也不白屏）', async ({ result }) => {
    respondWith(result);
    let caught: unknown = null;
    class Boundary extends Component<{ children: ReactNode }> {
      override componentDidCatch(error: unknown) {
        caught = error;
      }
      override render() {
        return this.props.children;
      }
    }
    render(
      <Boundary>
        <MarketHomePage />
      </Boundary>,
    );
    await screen.findByText('技能市场');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(caught).toBeNull();
  });
});
