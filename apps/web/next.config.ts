import type { NextConfig } from 'next';

/**
 * 设界 Web 端 Next.js 配置（骨架期最小集）。
 *
 * - `output: 'export'`：**静态导出口径预留**——设界本地优先，前端最终以静态产物交本地 daemon /
 *   Electron 壳（apps/desktop）装载；随 FE-12（最小壳）与导出票解除注释，届时须确保
 *   无动态路由、无服务端数据依赖。
 * - `transpilePackages`：工作区包（@dforge/ui、@dforge/contracts、@dforge/engine）以 TS 源码直供，不预编译产物。
 * - i18n：zh-CN 唯一暴露，不提供语言切换（ADR-0003）；消息目录在 apps/web/messages。
 */
const nextConfig: NextConfig = {
  // output: 'export',
  reactStrictMode: true,
  transpilePackages: ['@dforge/ui', '@dforge/contracts', '@dforge/engine'],
};

export default nextConfig;
