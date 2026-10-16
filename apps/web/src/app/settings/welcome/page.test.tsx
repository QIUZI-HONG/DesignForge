/**
 * `/settings/welcome` 路由冒烟测试（FE-09）。
 *
 * 断言：服务端可渲染、loading 态挂点进入 SSR 产物、渲染产物无裸色值。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import WelcomeRoute from './page';

const html = renderToStaticMarkup(<WelcomeRoute />);

describe('空库冷启动路由（/settings/welcome）', () => {
  it('服务端可渲染，标题为「欢迎使用设界」', () => {
    expect(html).toContain('欢迎使用设界');
  });

  it('loading 态挂点进入 SSR 产物', () => {
    expect(html).toContain('data-df-state="loading"');
  });

  it('渲染产物无裸色值 / rgb()', () => {
    expect(html).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(html).not.toMatch(/rgba?\(/);
  });
});
