/**
 * `@dforge/web` 设置特性（FE-09）——公开面。
 *
 * 消费方（`app/settings/**` 三条路由）只需要三个整块页面：
 * - `SettingsPage`（E3 设置页）· `OnboardingWizard`（E4 四步引导）· `ColdStart`（E6 空库冷启动）。
 *
 * 不导出（刻意的）：`api/*`（设置数据面客户端）、`model/*`（草稿/保存态/校验状态机）、
 * 页面内部件（`save-footer` / `section-form` / `sections` / `clipboard`）。
 * 新增跨边界消费需求 = 在本文件显式加一行，而不是引用内部路径。
 */

export { ColdStart, type ColdStartProps } from './components/cold-start';
export { OnboardingWizard, type OnboardingWizardProps } from './components/onboarding-wizard';
export { SettingsPage, type SettingsPageProps } from './components/settings-page';
