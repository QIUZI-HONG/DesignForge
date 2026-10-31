'use client';

import { useServerInsertedHTML } from 'next/navigation';
/**
 * 编辑器深色作用域（验收标准 §3：主题逐页对齐 Figma 本体——编辑器族 = 深色 UI3）。
 *
 * 为什么要在**根元素**上设 `data-theme`：令牌选择器是 `:root[data-theme="…"]`，
 * 只有根元素上的属性会换整套变量（嵌套容器切换会静默失效，见 `tokens.css` 头注释）。
 *
 * 两条进入路径，各配一段机制（票 10 · spec P1-6 重排）：
 *
 * 1. **SSR 首帧**：经 `useServerInsertedHTML` 把置深脚本注入 `<head>`（仅服务端产出，
 *    流式插到 `</head>` 前，解析期即执行 → 首帧即深色，不闪浅色）。为什么不用
 *    `<script dangerouslySetInnerHTML>` 写在渲染树里：React 18/19 客户端创建可执行
 *    `<script>` 必报「Encountered a script tag while rendering React component」，且该
 *    路径创建的 script 并不执行（innerHTML 语义，纯死代码）；`beforeInteractive` 只允许
 *    挂根布局、会全站注入（首页也会被置深），均不适用。插入通道的内容**不在客户端
 *    React 树里**（客户端 hook 为 no-op），因此无 script-tag 警告、无水合错配面。
 * 2. **客户端导航**：挂载时把根元素切到深色，卸载时还原（effect 路径，见下）。
 */
import { useEffect } from 'react';

/** 深色首帧脚本（常量；内容与机制见文件头注释）。 */
const DARK_THEME_BOOTSTRAP = "document.documentElement.dataset.theme='dark';";

/** 根布局的默认主题常量（`app/layout.tsx` 的 `data-theme="light"`；卸载还原目标）。 */
const ROOT_DEFAULT_THEME = 'light';

/** 深色作用域：SSR 注入首帧置深脚本 + 客户端导航的设置/还原。 */
export function EditorThemeScope() {
  // 仅 SSR 生效：向 Next 的服务端插入通道注册首帧脚本（客户端渲染时通道不存在，no-op；
  // 内容为常量字符串，无外部输入，经 dangerouslySetInnerHTML 落到 <head> 不构成注入面）。
  // 通道按流式 flush **多次**回调同一注册函数（首个 chunk / 每个后续 chunk / 收尾 flush，
  // 见 next 的 stream-ops `createHeadInsertionTransform` 与 makeGetServerInsertedHTML）——
  // 必须自带「只发一次」闸，否则置深脚本会跟着每个 flush 重复进流（实测 4 次，含 </html> 后）。
  let emitted = false;
  useServerInsertedHTML(() => {
    if (emitted) return null;
    emitted = true;
    return <script dangerouslySetInnerHTML={{ __html: DARK_THEME_BOOTSTRAP }} />;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = 'dark';
    return () => {
      // 还原到根布局默认，而不是记下进入前的值：SSR 首帧路径里「进入前的值」恒为
      // dark（首帧脚本已翻过，React 明确「won't be patched up」）——按旧写法 capture
      // previous 会把 dark 还原给浅色路由（编辑器 → 首页导航后首页停在深色）。
      document.documentElement.dataset.theme = ROOT_DEFAULT_THEME;
    };
  }, []);
  return null;
}
