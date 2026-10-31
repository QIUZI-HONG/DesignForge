/**
 * 编辑器路由布局（FE-03）——深色作用域 + 跨票 Provider。
 *
 * 职责（`briefs/fe-03.md` §2）：**HUD Provider 由编辑器路由布局提供**（FE-06 只调 `useCanvasHud()`），
 * 顺带把深色基准落到根元素（`EditorThemeScope`：SSR 经 `useServerInsertedHTML` 注入首帧
 * 置深脚本、客户端导航由其 effect 兜底——票 10 起首帧脚本不再写在 React 渲染树里，
 * 机制与理由见 `features/editor-shell/ui/theme-scope.tsx` 头注释）。
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { CanvasHudProvider, EditorThemeScope } from '@/features/editor-shell';
import { t } from '@/i18n';

import '@/features/editor-shell/editor-shell.css';

export const metadata: Metadata = {
  title: t('editor.title'),
};

/** 编辑器布局。 */
export default function EditorLayout({ children }: { children: ReactNode }) {
  return (
    <CanvasHudProvider>
      {/* 深色作用域：首帧置深走服务端插入通道（见 theme-scope.tsx），不在渲染树里放 <script> */}
      <EditorThemeScope />
      {children}
    </CanvasHudProvider>
  );
}
