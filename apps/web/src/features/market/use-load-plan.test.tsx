// @vitest-environment jsdom
/**
 * `useLoadPlan` 的重取语义（F1 评审修复）：ackToken 一次性——每次打开确认框都必须
 * 重取提案，hook 暴露的 `reload` 是页面 onLoadClick 的接缝。断言外部行为：
 * reload 触发一次新请求、返回**新的 plan 对象**（不复用旧引用）、请求期间清空旧 plan。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { marketFixtures } from '@/features/market';

import { useLoadPlan } from './use-market';

const { makeLoadPlan } = marketFixtures;

const fetchMock = vi.fn();

function respond(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useLoadPlan · 重开重取（F1）', () => {
  it('reload 触发一次新请求并返回新的 plan 对象（不复用旧引用/旧 token）', async () => {
    const planA = makeLoadPlan({ ackToken: 'token-a', ackExpiresAt: '2026-11-08T00:02:00.000Z' });
    const planB = makeLoadPlan({ ackToken: 'token-b', ackExpiresAt: '2026-11-09T00:02:00.000Z' });
    const plans = [planA, planB];
    let calls = 0;
    fetchMock.mockImplementation(() => {
      const plan = plans[Math.min(calls, plans.length - 1)];
      calls += 1;
      return Promise.resolve(respond(plan));
    });
    const { result } = renderHook(() =>
      useLoadPlan('gh:acme/skills#skills/pdf-export', { baseUrl: 'http://daemon.test' }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const firstPlan = result.current.plan;
    expect(firstPlan?.ackToken).toBe('token-a');

    await act(async () => {
      result.current.reload();
    });
    // 重取期间旧 plan 先清空（不残留旧 token 形态），就绪后是**新对象**
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.plan).not.toBe(firstPlan);
    expect(result.current.plan?.ackToken).toBe('token-b');
    expect(calls).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reload 请求期间进入 loading 且 plan 清空；失败态同样可 reload 重试', async () => {
    let fail = true;
    fetchMock.mockImplementation(() => {
      if (fail) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: false, error: { code: 'internal', message: 'x' } }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(respond(makeLoadPlan()));
    });
    const { result } = renderHook(() =>
      useLoadPlan('gh:acme/skills#skills/pdf-export', { baseUrl: 'http://daemon.test' }),
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    fail = false;
    await act(async () => {
      result.current.reload();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.plan?.loadable).toBe(true);
  });
});
