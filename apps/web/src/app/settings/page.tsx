import type { Metadata } from 'next';

import { SettingsPage } from '@/features/settings/components/settings-page';
import { t } from '@/i18n';

/**
 * 设置页路由（`/settings` · 清单 E3，对标页「结构」）。
 *
 * 薄壳：页面本体归 `features/settings`（与引导/冷启动同 feature）；
 * 浅色首页族主题（根布局 `data-theme="light"`，验收标准 §3 逐页对齐）。
 */
export const metadata: Metadata = { title: t('settings.title') };

export default function SettingsRoute() {
  return <SettingsPage />;
}
