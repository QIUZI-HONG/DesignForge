/**
 * 编辑器路由布局（FE-03）——深色作用域 + 跨票 Provider。
 *
 * 职责（`briefs/fe-03.md` §2）：**HUD Provider 由编辑器路由布局提供**（FE-06 只调 `useCanvasHud()`），
 * 顺带把深色基准落到根元素（首帧内联脚本 + 客户端导航由 `EditorThemeScope` 兜底）。
 *
 * 为什么内联脚本用 `dangerouslySetInnerHTML`：这是「首帧前改 HTML 属性」的标准做法
 * （SSR 流式解析到即执行）；内容是本文件内的常量字符串，无外部输入，不构成注入面。
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { CanvasHudProvider } from '@/features/editor-shell/hud/context';
import { EditorThemeScope } from '@/features/editor-shell/ui/theme-scope';
import { t } from '@/i18n';

import '@/features/editor-shell/editor-shell.css';

export const metadata: Metadata = {
  title: t('editor.title'),
};

/** 深色首帧脚本（常量；见文件头注释）。 */
const DARK_THEME_BOOTSTRAP = "document.documentElement.dataset.theme='dark';";

/** 编辑器布局。 */
export default function EditorLayout({ children }: { children: ReactNode }) {
  return (
    <CanvasHudProvider>
      {/* 首帧前把根元素切到深色基准；内联脚本见文件头注释 */}
      <script dangerouslySetInnerHTML={{ __html: DARK_THEME_BOOTSTRAP }} />
      <EditorThemeScope />
      {children}
    </CanvasHudProvider>
  );
}
