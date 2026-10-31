// @vitest-environment jsdom
/**
 * 编辑器路由布局测试（票 10 · spec P1-6：警告清零）。
 *
 * 背景（巡检实测）：布局曾把首帧置深脚本作为 `<script dangerouslySetInnerHTML>` 写进
 * React 渲染树——React 18 客户端创建 `<script>`（客户端导航进入 /editor、或任何
 * client render 路径）都会报「Encountered a script tag while rendering React component」
 * （react-dom-client `createInstance` 对可执行 script 的固定告警），且该路径创建的
 * script 并不执行（纯死代码——置深实际由 `EditorThemeScope` 的 effect 兜底）。
 *
 * 修复口径：首帧脚本移出 React 渲染树，改走 Next 官方的 `useServerInsertedHTML`
 * 服务端插入通道（仅 SSR 产出、进 <head>、解析期即执行；客户端渲染为 no-op，
 * 不产生 script 元素）。本文件守两侧 seam：
 * 1. React 渲染产物（服务端标记 + 客户端 DOM）不含 `<script>`；
 * 2. 服务端插入通道仍携带置深脚本（经 `ServerInsertedHTMLContext` 捕获回调验证），
 *    首帧置深能力不因迁移而丢失。
 */

import { render } from '@testing-library/react';
import { ServerInsertedHTMLContext } from 'next/navigation';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EditorThemeScope } from '@/features/editor-shell';

import EditorLayout from './layout';

describe('编辑器布局 · 首帧脚本不在 React 渲染树（票 10）', () => {
  it('服务端标记与客户端 DOM 均不含 <script>（可执行脚本进 React 树必报 script-tag 警告）', () => {
    const html = renderToStaticMarkup(
      <EditorLayout>
        <div data-df-layout-probe="1" />
      </EditorLayout>,
    );
    expect(html).not.toContain('<script');

    const { container } = render(
      <EditorLayout>
        <div data-df-layout-probe="1" />
      </EditorLayout>,
    );
    expect(container.querySelector('script')).toBeNull();
  });

  it('深色首帧脚本经 useServerInsertedHTML 通道注入（仅 SSR；内容不变）', () => {
    const captured: Array<() => ReactNode> = [];
    render(
      <ServerInsertedHTMLContext.Provider value={(callback) => captured.push(callback)}>
        <EditorThemeScope />
      </ServerInsertedHTMLContext.Provider>,
    );
    // 挂载即向通道注册（服务端渲染期执行；客户端无 provider 时为 no-op）
    expect(captured).toHaveLength(1);
    const register = captured[0];
    if (register === undefined) throw new Error('useServerInsertedHTML 未向通道注册回调');
    const markup = renderToStaticMarkup(register());
    expect(markup).toContain('<script');
    expect(markup).toContain("document.documentElement.dataset.theme='dark';");
  });
});
