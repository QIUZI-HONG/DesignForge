'use client';

/**
 * 站内跳转地址的 React 绑定（修复批次 4 · 工作包 B；D-3 / UX-01）。
 *
 * 为什么单独一个模块（而不是放进 `@/lib/daemon-endpoint`）：单点模块被 Server Component
 * 间接导入（`features/market` 的数据面链），在里面挂 React hook 会让 `next build` 直接失败
 * （RSC 边界；`useState` in Server Component）。纯字符串逻辑仍在 `daemon-endpoint` 单点，
 * 本模块只做「渲染期安全」的包装。
 *
 * `useDaemonEndpointHref` 返回**首帧与 SSR 输出逐字一致**的地址（不带参数）：客户端组件在
 * App Router 里同样被服务端预渲染，渲染期直接读 `window.location` 会造成 hydration 属性
 * 不一致；挂载后经 effect 才补上当前端点参数。消费方：进标记的 `<a href>`（首页卡片、
 * 回首页链接）；只走事件回调的跳转（`router.push` / `location.assign`）直接在回调里调
 * `withDaemonEndpoint`，不需要本 hook。
 */
import { useEffect, useState } from 'react';

import { withDaemonEndpoint } from './daemon-endpoint';

/** 站内地址 + 当前页面的 daemon 端点参数（挂载后写入；无参时保持基址）。 */
export function useDaemonEndpointHref(href: string): string {
  const [resolved, setResolved] = useState(href);
  useEffect(() => {
    setResolved(withDaemonEndpoint(href));
  }, [href]);
  return resolved;
}
