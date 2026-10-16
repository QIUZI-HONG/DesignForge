// @vitest-environment jsdom
/**
 * `useDaemonEndpointHref` 测试（D-3/UX-01 的 React 绑定缝）。
 *
 * 断言角度：外部可观测行为——**首帧与 SSR 同口径**（地址不带参数，避免 hydration 差异），
 * 挂载后（effect 触发）才补上当前端点参数；当前页没有参数时保持基址。
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useDaemonEndpointHref } from './daemon-endpoint';

const ENDPOINT = 'http://127.0.0.1:4999';
const ENCODED = encodeURIComponent(ENDPOINT);

/** 把 jsdom 当前地址设成指定查询串（用例间复位）。 */
function setSearch(search: string): void {
  window.history.replaceState(null, '', `/${search}`);
}

afterEach(() => {
  setSearch('');
});

describe('useDaemonEndpointHref', () => {
  it('首帧返回基址（与 SSR 输出一致）；挂载后带上当前端点参数', async () => {
    setSearch(`?daemon=${ENCODED}`);
    const renders: string[] = [];
    const { result } = renderHook(() => {
      const href = useDaemonEndpointHref('/editor?documentId=x');
      renders.push(href);
      return href;
    });
    expect(renders[0]).toBe('/editor?documentId=x');
    expect(result.current).toBe(`/editor?documentId=x&daemon=${ENCODED}`);
  });

  it('当前页无 ?daemon= 时保持基址（canonical URL 干净）', async () => {
    setSearch('');
    const { result } = renderHook(() => useDaemonEndpointHref('/market'));
    await waitFor(() => expect(result.current).toBe('/market'));
  });

  it('非法端点值不进入地址', async () => {
    setSearch('?daemon=not-a-url');
    const { result } = renderHook(() => useDaemonEndpointHref('/market'));
    await waitFor(() => expect(result.current).toBe('/market'));
  });
});
