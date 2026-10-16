'use client';

/**
 * 首页 / 文件浏览器（FE-02；路由 `/`，对标页 · 浅色基准）。
 *
 * 本文件只做三件事：导入本票样式、把路由导航接给 `HomeView`、确认浅色基准
 * （`<html data-theme="light">` 由根布局给出，验收标准 §3「逐页对齐 Figma 本体」——
 * 首页族浅色，编辑器族深色）。页面结构与全部状态都在 `features/home/**`（本票独占目录）。
 */
import { useRouter } from 'next/navigation';

import { editorHref, HomeView } from '@/features/home';
import { withDaemonEndpoint } from '@/lib/daemon-endpoint';

import '@/features/home/home.css';

/** 首页。 */
export default function HomePage() {
  const router = useRouter();
  return (
    <HomeView
      // 站内跳转一律经 `withDaemonEndpoint` 续写当前端点参数（D-3/UX-01）：跳转后的页面
      // 才能解析到同一 daemon；当前页没有 `?daemon=`（壳/部署形态）时原样返回（URL 干净）
      onOpenDocument={(document) => router.push(withDaemonEndpoint(editorHref(document.id)))}
      onOpenMarket={(assetId) =>
        router.push(withDaemonEndpoint(`/market?assetId=${encodeURIComponent(assetId)}`))
      }
    />
  );
}
