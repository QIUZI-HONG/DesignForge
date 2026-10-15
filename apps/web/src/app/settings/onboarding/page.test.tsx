/**
 * `/settings/onboarding` 路由冒烟测试（FE-09）。
 *
 * 断言：服务端可渲染、loading 态挂点进入 SSR 产物、渲染产物无裸色值。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import OnboardingRoute from './page';

const html = renderToStaticMarkup(<OnboardingRoute />);

describe('四步引导路由（/settings/onboarding）', () => {
  it('服务端可渲染，标题为「四步引导」', () => {
    expect(html).toContain('四步引导');
  });

  it('loading 态挂点进入 SSR 产物', () => {
    expect(html).toContain('data-df-state="loading"');
  });

  it('渲染产物无裸色值 / rgb()', () => {
    expect(html).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(html).not.toMatch(/rgba?\(/);
  });
});
