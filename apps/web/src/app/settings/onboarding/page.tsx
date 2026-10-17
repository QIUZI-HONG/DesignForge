import type { Metadata } from 'next';

import { OnboardingWizard } from '@/features/settings';
import { t } from '@/i18n';

/**
 * 四步引导路由（`/settings/onboarding` · 清单 E4，自设计页）。
 *
 * 首次启动的引导入口；完成后进入冷启动页（`/settings/welcome`）。
 */
export const metadata: Metadata = { title: t('onboarding.title') };

export default function OnboardingRoute() {
  return <OnboardingWizard />;
}
