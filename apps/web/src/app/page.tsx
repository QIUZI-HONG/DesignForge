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

import '@/features/home/home.css';

/** 首页。 */
export default function HomePage() {
  const router = useRouter();
  return (
    <HomeView
      onOpenDocument={(document) => router.push(editorHref(document.id))}
      onOpenMarket={(assetId) => router.push(`/market?assetId=${encodeURIComponent(assetId)}`)}
    />
  );
}
