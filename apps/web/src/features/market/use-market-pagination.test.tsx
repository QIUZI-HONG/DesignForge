// @vitest-environment jsdom
/**
 * `useMarketPagination`（DEF-R1）：首屏 +「加载更多」增量累加的 hook 级测试。
 * 断言外部行为（items 累积/去重、offset 参数、终点与失败态、参数变化重置），不测实现细节。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { marketFixtures } from '@/features/market';

import { useMarketPagination } from './use-market';

const { makeAsset, makeQueryResponse } = marketFixtures;

const fetchMock = vi.fn();
const urls: string[] = [];

function respond(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function counts(total: number) {
  return {
    total,
    byKind: { skill: total, plugin: 0, 'design-system': 0, template: 0 },
    loadable: total,
  };
}

const a = makeAsset({ id: 'gh:acme/skills#skills/a' });
const b = makeAsset({ id: 'gh:acme/skills#skills/b' });
const c = makeAsset({ id: 'gh:acme/skills#skills/c' });
const d = makeAsset({ id: 'gh:acme/skills#skills/d' });

beforeEach(() => {
  fetchMock.mockReset();
  urls.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMarketPagination', () => {
  it('首屏 + 加载更多：按 offset 递增累加并去重，达到 total 即终点', async () => {
    const first = makeQueryResponse({ items: [a, b], total: 4, counts: counts(4) });
    const second = makeQueryResponse({ items: [b, c, d], total: 4, counts: counts(4) });
    fetchMock.mockImplementation((url: string) => {
      urls.push(String(url));
      return Promise.resolve(respond(String(url).includes('offset=2') ? second : first));
    });
    const { result } = renderHook(() =>
      useMarketPagination({ sort: 'score', limit: 2 }, { baseUrl: 'http://daemon.test' }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items.map((item) => item.id)).toEqual([a.id, b.id]);
    expect(result.current.loadMoreState).toBe('idle');

    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(4));
    expect(result.current.items.map((item) => item.id)).toEqual([a.id, b.id, c.id, d.id]);
    expect(result.current.loadMoreState).toBe('done');
    expect(urls.some((url) => url.includes('offset=2'))).toBe(true);
  });

  it('空页视为终点（服务端 total 更大也不无限请求）', async () => {
    const first = makeQueryResponse({ items: [a], total: 10, counts: counts(10) });
    const empty = makeQueryResponse({ items: [], total: 10, counts: counts(10) });
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(respond(String(url).includes('offset=1') ? empty : first)),
    );
    const { result } = renderHook(() =>
      useMarketPagination({ sort: 'score', limit: 1 }, { baseUrl: 'http://daemon.test' }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadMoreState).toBe('done'));
    expect(result.current.items).toHaveLength(1);
  });

  it('加载更多失败：保留已载内容并给可重试错误', async () => {
    const first = makeQueryResponse({ items: [a], total: 3, counts: counts(3) });
    fetchMock.mockImplementation((url: string) => {
      urls.push(String(url));
      if (String(url).includes('offset=1')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: false, error: { code: 'x', message: 'boom' } }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(respond(first));
    });
    const { result } = renderHook(() =>
      useMarketPagination({ sort: 'score', limit: 1 }, { baseUrl: 'http://daemon.test' }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadMoreState).toBe('error'));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.loadMoreError).toContain('boom');
  });

  it('参数变化：累积自动失效（回到首页结果）', async () => {
    const first = makeQueryResponse({ items: [a, b], total: 4, counts: counts(4) });
    const second = makeQueryResponse({ items: [c, d], total: 4, counts: counts(4) });
    const renamed = makeQueryResponse({ items: [d], total: 1, counts: counts(1) });
    fetchMock.mockImplementation((url: string) => {
      urls.push(String(url));
      const value = String(url);
      if (value.includes('sort=name')) return Promise.resolve(respond(renamed));
      return Promise.resolve(respond(value.includes('offset=2') ? second : first));
    });
    const { result, rerender } = renderHook(
      ({ sort }: { sort: 'score' | 'name' }) =>
        useMarketPagination({ sort, limit: 2 }, { baseUrl: 'http://daemon.test' }),
      { initialProps: { sort: 'score' as 'score' | 'name' } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(4));

    rerender({ sort: 'name' });
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([d.id]));
  });
});
