// @vitest-environment jsdom
/**
 * 未知路由 404 页测试（G1 / UX-14）。
 *
 * 断言口径（用户可见行为）：
 * 1. 中文品牌文案（标题 + 说明），**不出现** Next 缺省英文页文案——全中文基线（ADR-0003）；
 * 2. 「返回首页」是可点出口，地址为站内 `/`（挂载后由 B 包单点续写 daemon 端点参数）；
 * 3. 服务端可渲染（无浏览器 API 依赖的 SSR 安全路径）。
 */
import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import NotFound from './not-found';

describe('未知路由 404 页', () => {
  it('中文文案 + 返回首页出口（无英文默认页残留）', () => {
    render(<NotFound />);
    expect(screen.getByText('页面不存在')).toBeTruthy();
    expect(screen.getByText('这个地址没有对应的页面，可能已被移动或删除。')).toBeTruthy();
    const link = screen.getByRole('link', { name: '返回首页' });
    expect(link.getAttribute('href')).toBe('/');
    expect(document.body.textContent).not.toContain('This page could not be found');
  });

  it('服务端可渲染（SSR 产物含中文标题与 404 标记）', () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain('页面不存在');
    expect(html).toContain('404');
    expect(html).toContain('href="/"');
  });
});
