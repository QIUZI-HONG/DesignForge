import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * 设界 Web 端 Next.js 配置（骨架期最小集）。
 *
 * - `output: 'export'`：**静态导出口径预留**——设界本地优先，前端最终以静态产物交本地 daemon /
 *   Electron 壳（apps/desktop）装载；随 FE-12（最小壳）与导出票解除注释，届时须确保
 *   无动态路由、无服务端数据依赖。
 * - `transpilePackages`：工作区包（@dforge/ui、@dforge/contracts、@dforge/engine）以 TS 源码直供，不预编译产物。
 * - i18n：zh-CN 唯一暴露，不提供语言切换（ADR-0003）；消息目录在 apps/web/messages。
 * - `turbopack.root`：pnpm monorepo——next 装在仓库根 node_modules，Turbopack 默认按
 *   「最近锁文件」探测根；vercel build 等沙箱场景会把根钉在本目录而解析不到 next 包，
 *   显式指回仓库根（与本地 next build 的探测结果一致，无行为差异）。
 * - `allowedDevOrigins`（票 10）：dev 服务器允许的开发来源白名单——本机两个本地主机名
 *   （localhost / 127.0.0.1）都在用（README 桌面壳 dev 装载地址口径：localhost 实测可水合，
 *   127.0.0.1 曾实测不水合），显式放行避免 dev 服务器对跨来源开发请求（/​_next/* 与 HMR）
 *   的来源校验拦到另一个本机主机名；仅影响 dev，生产构建不生效。
 */
const nextConfig: NextConfig = {
  // output: 'export',
  reactStrictMode: true,
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  transpilePackages: ['@dforge/ui', '@dforge/contracts', '@dforge/engine'],
  turbopack: {
    root: path.join(__dirname, '../..'),
  },
};

export default nextConfig;
