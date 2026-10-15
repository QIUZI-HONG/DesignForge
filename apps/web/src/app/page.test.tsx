/**
 * 首页（`/`）页面级测试（FE-02）。
 *
 * 断言：页面作为服务端组件的**结构契约**能渲染（含侧栏/顶栏/内容区骨架与容器类名），
 * 且渲染产物里没有裸色值（与 `guard-tokens` 的静态检查互补，DOM 级兜一道）。
 *
 * 数据面不在本文件里跑：`HomeView` 缺省走 daemon（浏览器里才有意义），页面级行为
 * （加载三态/搜索/两步删除/新建）在 `features/home/components/HomeView.test.tsx` 里
 * 用注入替身完整覆盖——这里只保证页面壳能起来、样式类名与主题口径没走样。
 */
import { ToastProvider } from '@dforge/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import HomePage from './page';

// 页面壳的 SSR 渲染与路由上下文无关（导航回调不触发）：替身掉 Next 的 useRouter，
// 这样本文件只测「壳结构 + 文案 + 无裸色值」三件事，不需要起 Next 运行时。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

// Toast 队列由根布局的 ToastProvider 持有（真实应用里 layout.tsx 已提供）；SSR 渲染同样需要它
const html = renderToStaticMarkup(
  <ToastProvider>
    <HomePage />
  </ToastProvider>,
);

describe('首页页面外壳', () => {
  it('渲染三区结构（侧栏 / 顶栏 / 内容区）', () => {
    expect(html).toContain('dfg-home__sidebar');
    expect(html).toContain('dfg-home__topbar');
    expect(html).toContain('dfg-home__content');
  });

  it('侧栏三分区与顶栏动作都在（最近 / 本地文档 / 回收站 / 新建 / 搜索）', () => {
    expect(html).toContain('最近');
    expect(html).toContain('本地文档');
    expect(html).toContain('回收站');
    expect(html).toContain('新建');
    expect(html).toContain('搜索文件与技能资产');
  });

  it('浅色基准：不写死颜色，颜色只用令牌变量', () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/rgba?\(/);
  });
});
