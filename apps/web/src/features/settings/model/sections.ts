/**
 * 设置分区注册表（FE-09 · 清单 E3/E4 的唯一真源）。
 *
 * 「设置页左导航」与「四步引导步骤」共用本表：分区即步骤（工作目录 → AI → 出图 → 埋点），
 * 顺序、图标、文案键都只在这里定义——两处 UI 各自硬编码清单 = 必然漂移，禁止。
 * 文案键的完整性由 `sections.test.ts` 对着 zh-CN / en 目录断言。
 */
import type { IconName } from '@dforge/ui';

/** 分区 id（引导步骤同集）。 */
export type SettingsSectionId = 'workspace' | 'ai' | 'comfy' | 'telemetry';

/** 分区元数据。 */
export interface SettingsSectionSpec {
  id: SettingsSectionId;
  /** 分区标题文案键。 */
  titleKey: string;
  /** 分区一句话说明文案键。 */
  descriptionKey: string;
  /** 导航 / 步骤条图标（@dforge/ui 图标注册表名）。 */
  icon: IconName;
}

/** 四分区（顺序 = 引导步骤顺序；清单 E3 / E4 同序）。 */
export const SETTINGS_SECTIONS: readonly SettingsSectionSpec[] = [
  {
    id: 'workspace',
    titleKey: 'settings.section.workspace',
    descriptionKey: 'settings.section.workspace.desc',
    icon: 'BoxIcon',
  },
  {
    id: 'ai',
    titleKey: 'settings.section.ai',
    descriptionKey: 'settings.section.ai.desc',
    icon: 'TextIcon',
  },
  {
    id: 'comfy',
    titleKey: 'settings.section.comfy',
    descriptionKey: 'settings.section.comfy.desc',
    icon: 'FrameIcon',
  },
  {
    id: 'telemetry',
    titleKey: 'settings.section.telemetry',
    descriptionKey: 'settings.section.telemetry.desc',
    icon: 'InfoIcon',
  },
];

/** 分区 id 序列（顺序即导航/步骤顺序）。 */
export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = SETTINGS_SECTIONS.map(
  (section) => section.id,
);

/** 按 id 取分区元数据（未知 id 抛错：注册表是封闭集，静默兜底会掩盖漂移）。 */
export function settingsSection(id: SettingsSectionId): SettingsSectionSpec {
  const found = SETTINGS_SECTIONS.find((section) => section.id === id);
  if (found === undefined) throw new Error(`未登记的分区 id：${id}`);
  return found;
}

/**
 * 诊断分区的导航元数据（修复批次 4 · 工作包 D1）。
 *
 * 为什么**不进** `SETTINGS_SECTIONS`：那张表是「设置页左导航」与「四步引导步骤」的共用真源
 * （四步 = 工作目录 → AI → 出图 → 埋点），把诊断塞进去会让引导变成五步（E4 清单外）。
 * 诊断是设置页上的**只读观察面**（无草稿、无保存脚），与表单分区本就是两类东西；
 * 但导航的排版/图标/文案键仍与分区同表定义，避免两处各自硬编码。
 */
export const SETTINGS_DIAGNOSTICS_NAV = {
  id: 'diagnostics',
  titleKey: 'settings.section.diagnostics',
  descriptionKey: 'settings.section.diagnostics.desc',
  icon: 'AlertCircleIcon',
} as const satisfies { id: string; titleKey: string; descriptionKey: string; icon: IconName };

/** 设置页左导航的全部 id（四表单分区 + 诊断）。 */
export type SettingsNavId = SettingsSectionId | typeof SETTINGS_DIAGNOSTICS_NAV.id;
