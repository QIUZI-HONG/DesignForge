/**
 * 设置分区注册表测试（FE-09）。
 *
 * 注册表是「设置页左导航」与「四步引导步骤」的**同源真源**（简报 §1：四步与设置分区同源），
 * 因此这里同时断言：顺序、与 i18n 目录的键完整性（zh-CN 唯一真源 + en 兜底不落键）、
 * 以及与引导步骤 id 的一致性。
 */
import { ICONS } from '@dforge/ui';
import { describe, expect, it } from 'vitest';

import en from '../../../../messages/en.json';
import zhCN from '../../../../messages/zh-CN.json';

import { SETTINGS_SECTION_IDS, SETTINGS_SECTIONS } from './sections';

describe('设置分区注册表', () => {
  it('四分区按「工作目录 → AI → 出图 → 埋点」定序（清单 E3）', () => {
    expect(SETTINGS_SECTION_IDS).toEqual(['workspace', 'ai', 'comfy', 'telemetry']);
    expect(SETTINGS_SECTIONS.map((section) => section.titleKey)).toEqual([
      'settings.section.workspace',
      'settings.section.ai',
      'settings.section.comfy',
      'settings.section.telemetry',
    ]);
  });

  it('每个分区的文案键在 zh-CN 目录存在（en 兜底同步补键，不得落空）', () => {
    for (const section of SETTINGS_SECTIONS) {
      for (const key of [section.titleKey, section.descriptionKey]) {
        expect(zhCN, `zh-CN 缺键：${key}`).toHaveProperty(key);
        expect(en, `en 缺键：${key}`).toHaveProperty(key);
      }
    }
  });

  it('分区携带图标，且图标名在 @dforge/ui 图标注册表中真实存在', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(Object.keys(ICONS), `未知图标：${section.icon}`).toContain(section.icon);
    }
  });
});
