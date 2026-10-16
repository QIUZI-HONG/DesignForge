import type { Metadata } from 'next';

import { ColdStart } from '@/features/settings';
import { t } from '@/i18n';

/**
 * 空库冷启动路由（`/settings/welcome` · 清单 E6，自设计页）。
 *
 * 空态 → 一键示例（daemon 建示例文档）→ 进入编辑器（`/editor?doc=<id>`，FE-03 接管解析）；
 * 库中已有文件时只做分流提示（返回首页）。
 */
export const metadata: Metadata = { title: t('coldstart.title') };

export default function WelcomeRoute() {
  return <ColdStart />;
}
