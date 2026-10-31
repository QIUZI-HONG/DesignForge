// @vitest-environment jsdom
/**
 * 根布局测试（票 10 · spec P1-6：data-theme 水合错配清零）。
 *
 * 背景（巡检实测）：编辑器路由在**水合前**把根元素翻到 `data-theme="dark"`
 * （首帧置深脚本，见 `app/editor/layout.tsx` / `EditorThemeScope`），而根布局
 * 服务端常量是 `data-theme="light"`——App Router 运行时（Next 16 内置 React 19.3）
 * 水合逐次加载报「A tree hydrated but some attributes of the server rendered HTML
 * didn't match the client properties」（React 明确不回补，分歧系有意设计：深色首帧）。
 *
 * 为什么是**静态断言**而非水合模拟：仓内组件测试跑 `react-dom@18.3.1`，其对
 * `<html>` 的属性分歧既不告警也不可比（18 的水合告警语义与 19 内置运行时不同），
 * jsdom 里 hydrateRoot(document) 亦无法复刻真运行时——告警层面的真值断言由
 * 主会话浏览器复核承担（票面验收「浏览器实测」项）。这里钉死的是结构性前提：
 * `<html>` 必须带 `suppressHydrationWarning`（React 的水合豁免是**元素级**的，
 * 无属性级开关——只静音该元素的属性/文本 diff，树内其余节点照常报），且缺了它
 * 错配告警会随每次编辑器路由加载重现。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import RootLayout from './layout';

const LAYOUT_SOURCE = readFileSync(join(import.meta.dirname, 'layout.tsx'), 'utf8');

describe('根布局 · data-theme 水合豁免（票 10）', () => {
  it('服务端首帧仍是浅色常量（深色翻转只发生在编辑器路由的置深脚本里）', () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <div data-df-root-probe="1">页面</div>
      </RootLayout>,
    );
    expect(html).toContain('data-theme="light"');
  });

  it('<html> 带 suppressHydrationWarning（水合豁免是元素级；缺了它每次加载报 data-theme 错配）', () => {
    // 静态断言：源码中 <html lang=…> 开标签必须同时带 data-theme 与 suppressHydrationWarning
    // （渲染产物不暴露该 React prop，只能在源码层钉住；锚定 lang= 以跳过头注释里的 <html> 字样）
    const htmlTag = /<html\s+lang=[^>]*>/.exec(LAYOUT_SOURCE)?.[0] ?? '';
    expect(htmlTag).toContain('data-theme="light"');
    expect(htmlTag).toContain('suppressHydrationWarning');
  });
});
