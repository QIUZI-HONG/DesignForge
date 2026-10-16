/**
 * `/settings` 路由冒烟测试（FE-09）。
 *
 * 断言（验收标准 §6 ①在 DOM 级的落点）：
 * 1. 服务端可渲染（页面能在无浏览器 API 的环境起得来）；
 * 2. loading 态挂点进入 SSR 产物（六态挂点可达的证据之一）；
 * 3. 渲染产物无裸色值（与 `guard-tokens` 静态检查互补）。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import SettingsRoute from './page';

const html = renderToStaticMarkup(<SettingsRoute />);

describe('设置页路由（/settings）', () => {
  it('服务端可渲染，标题为「设置」', () => {
    expect(html).toContain('设置');
  });

  it('loading 态挂点进入 SSR 产物', () => {
    expect(html).toContain('data-df-state="loading"');
  });

  it('渲染产物无裸色值 / rgb()', () => {
    expect(html).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(html).not.toMatch(/rgba?\(/);
  });
});
