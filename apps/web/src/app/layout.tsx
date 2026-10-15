import { ToastProvider } from '@dforge/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// 设计系统样式：双基准令牌变量（tokens.css）+ 基础组件样式（components.css）。
// 主题按页对齐 Figma 本体（验收标准 §3）——`data-theme` 默认浅色（首页族），
// 编辑器类页面（FE-03）自行切到 `dark`（UI3 深色族）。
import '@dforge/ui/styles.css';

// 字体：Noto Sans SC 离线捆绑（ADR-0003 §3）——400/500/700 三档。
// 验收门禁须断言字体已加载（禁止静默回退到系统字体）；断言挂点随 FE-01/FE-12 接入。
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/500.css';
import '@fontsource/noto-sans-sc/700.css';

import { t } from '@/i18n';

import './globals.css';

export const metadata: Metadata = {
  title: t('home.title'),
  description: t('home.subtitle'),
};

/** 根布局：语言固定 zh-CN（ADR-0003，全中文基线，不提供语言切换）。 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="light">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
