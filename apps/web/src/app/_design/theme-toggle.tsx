'use client';

import { SegmentedControl, type ThemeName } from '@dforge/ui';
/**
 * 预览页的主题切换（FE-01 · `/_design` 专用）。
 *
 * 口径（验收标准 §3）：主题逐页对齐 Figma 本体——首页族浅色、编辑器族深色；
 * 预览页是唯一需要**同时检视两套基准**的地方，因此在 `documentElement` 上切
 * `data-theme`（令牌变量随主题块整体换值），并把选择记进 localStorage 方便复看。
 * 为什么切 `documentElement` 而不是包一层 div：令牌选择器是 `:root[data-theme=…]`，
 * 只有根元素上的属性才会换整套变量（嵌套容器切换会静默失效）。
 */
import { useEffect, useState } from 'react';

import { t } from '@/i18n';

/** 记忆键（预览页专用，不影响产品页默认基准）。 */
const THEME_STORAGE_KEY = 'dfg-preview-theme';

/** 双主题切换。 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeName>('light');

  // 首次挂载读回上次选择（SSR 期间不读 localStorage，避免水合不一致）
  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initial: ThemeName = stored === 'dark' ? 'dark' : 'light';
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  const apply = (next: ThemeName): void => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  };

  return (
    <SegmentedControl
      label={t('design.theme.label')}
      value={theme}
      onChange={(value) => apply(value === 'dark' ? 'dark' : 'light')}
      options={[
        { value: 'light', label: t('design.theme.light') },
        { value: 'dark', label: t('design.theme.dark') },
      ]}
    />
  );
}
