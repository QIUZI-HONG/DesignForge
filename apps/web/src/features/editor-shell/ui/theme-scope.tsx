'use client';

/**
 * 编辑器深色作用域（验收标准 §3：主题逐页对齐 Figma 本体——编辑器族 = 深色 UI3）。
 *
 * 为什么要在**根元素**上设 `data-theme`：令牌选择器是 `:root[data-theme="…"]`，
 * 只有根元素上的属性会换整套变量（嵌套容器切换会静默失效，见 `tokens.css` 头注释）。
 *
 * 为什么还配一段内联脚本（见 `app/editor/layout.tsx`）：首帧 HTML 到达时若还没执行 JS，
 * 根元素仍是浅色（根布局的默认）→ 会闪一下浅色；内联脚本在解析到它时就执行，抹掉这个闪。
 * 本组件负责**客户端导航**进入编辑器时的设置与**离开时还原**。
 */
import { useEffect } from 'react';

/** 挂载时把根元素切到深色基准，卸载时还原（客户端导航路径）。 */
export function EditorThemeScope() {
  useEffect(() => {
    const previous = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = 'dark';
    return () => {
      document.documentElement.dataset.theme = previous ?? 'light';
    };
  }, []);
  return null;
}
