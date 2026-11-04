import { describe, expect, it } from 'vitest';
import { AI_STEP_STATUSES, AI_VISIBLE_STEPS } from '@/features/ai/steps';
import en from '../../messages/en.json';
import zhCN from '../../messages/zh-CN.json';
import { FALLBACK_LOCALE, PRIMARY_LOCALE, t } from './index';

describe('@dforge/web i18n 冒烟', () => {
  it('zh-CN 为唯一暴露语言，en 仅为兜底', () => {
    expect(PRIMARY_LOCALE).toBe('zh-CN');
    expect(FALLBACK_LOCALE).toBe('en');
  });

  it('zh-CN 与 en 键集一致（zh-CN 唯一真源；en 缺键会让界面出现裸键）', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it('默认取中文文案', () => {
    expect(t('home.title')).toBe('设界');
  });

  it('ICU 参数可解析', () => {
    expect(t('home.stage', { stage: 'P0' })).toContain('P0');
  });

  it('缺键回落 en 兜底文本', () => {
    expect(t('home.title', undefined, 'en')).toBe('DesignForge');
  });

  it('两目录皆缺键时原样回键（便于发现漏译）', () => {
    expect(t('__missing_key__')).toBe('__missing_key__');
  });
});

describe('票 02 · AI 承诺文案与实际交付一致（spec P0-3）', () => {
  // JSON 导入的键集是字面量并集，动态键索引需放宽为记录（仅测试读，非类型逃逸）
  const zh = zhCN as unknown as Record<string, string>;
  const enCatalog = en as unknown as Record<string, string>;

  // 钉子口径：这一批文案修的是「承诺大于交付」——旧文案承诺的能力（初稿/图层结构、
  // 本地模板生成器）在仓里并不存在。以下断言把旧的不实声明钉死在目录层：
  // 谁要恢复旧措辞，必须先让实现真实存在（P5），而不是改回一句好听的话。
  it('首页 AI 区：不再承诺「初稿」「图层结构」（AI 只回文字建议）', () => {
    const desc = zh['home.ai.desc'];
    expect(desc).toBeTruthy();
    expect(desc).not.toContain('初稿');
    expect(desc).not.toContain('图层结构');
    expect(desc).toContain('文字建议');
  });

  it('抽屉副标题：显式声明不改动文档，不再暗示「描述修改」会落盘', () => {
    const subtitle = zh['ai.subtitle'];
    expect(subtitle).toBeTruthy();
    expect(subtitle).toContain('不会改动文档');
    expect(subtitle).not.toContain('本地模板');
  });

  it('设置页降级提示：不再声称「本地模板兜底」', () => {
    const missing = zh['settings.credential.missing'];
    expect(missing).toBeTruthy();
    expect(missing).not.toContain('本地模板');
    expect(missing).toContain('非 AI 生成');
  });

  it('降级角标与说明：「本地模板」口径全部退场，措辞为「本地建议（非 AI 生成）」', () => {
    expect(zh['ai.badge.localTemplate']).toContain('本地建议');
    expect(zh['ai.badge.localTemplate']).not.toContain('本地模板');
    for (const key of ['ai.badge.localTemplate.desc', 'ai.hint.unconfigured']) {
      expect(zh[key]).toBeTruthy();
      expect(zh[key]).not.toContain('本地模板');
    }
    expect(zh['ai.badge.localTemplate.desc']).toContain('非 AI');
  });

  it('en 兜底目录与 zh-CN 同步退场「local template」生成口径', () => {
    expect(enCatalog['ai.badge.localTemplate']).not.toContain('template');
    expect(enCatalog['ai.badge.localTemplate.desc']).not.toContain('local template');
    expect(enCatalog['settings.credential.missing']).not.toContain('local template');
    expect(enCatalog['ai.subtitle']).not.toContain('local template');
  });
});

describe('票 03 · 本地建议角标与首页空态文案（spec P0-2）', () => {
  const zh = zhCN as unknown as Record<string, string>;
  const enCatalog = en as unknown as Record<string, string>;

  it('降级角标明确标注「本地建议 · 非 AI 生成」（来源可辨）', () => {
    expect(zh['ai.badge.localTemplate']).toContain('本地建议');
    expect(zh['ai.badge.localTemplate']).toContain('非 AI 生成');
  });

  it('首页空态不再承诺「用 AI 生成第一版初稿」（与实际交付一致）', () => {
    const desc = zh['home.empty.desc'];
    expect(desc).toBeTruthy();
    expect(desc).not.toContain('初稿');
  });

  it('en 兜底目录同步：角标含 not AI-generated，首页空态退场 draft 承诺', () => {
    expect(enCatalog['ai.badge.localTemplate']).toContain('not AI-generated');
    expect(enCatalog['home.empty.desc']).not.toContain('draft the first version');
  });
});

describe('票 10 · Inspector 效果区键名经 i18n（spec P1-6）', () => {
  // 引擎 Effect 契约值（snake_case）——面板按 `inspector.effect.${effect.type}` 取词，
  // 目录曾有 camelCase 旧键（dropShadow 等），UI 取不到 → 原始键直出（巡检实测）。
  const EFFECT_TYPES = ['drop_shadow', 'inner_shadow', 'layer_blur'] as const;

  it('引擎效果类型在 zh-CN 目录有映射，t() 不回键（不裸键直出）', () => {
    for (const type of EFFECT_TYPES) {
      expect(t(`inspector.effect.${type}`)).not.toBe(`inspector.effect.${type}`);
    }
  });

  it('en 兜底目录同键集映射（键集一致性用例之上，钉词面）', () => {
    const enCatalogLocal = en as unknown as Record<string, string>;
    for (const type of EFFECT_TYPES) {
      expect(enCatalogLocal[`inspector.effect.${type}`]).toBeTruthy();
    }
  });

  it('zh-CN 词面与 Figma 本体术语表一致（投影/内阴影/层模糊）', () => {
    expect(t('inspector.effect.drop_shadow')).toBe('投影');
    expect(t('inspector.effect.inner_shadow')).toBe('内阴影');
    expect(t('inspector.effect.layer_blur')).toBe('层模糊');
  });

  it('camelCase 旧键退场（无引用的死键不留在目录）', () => {
    const zhLocal = zhCN as unknown as Record<string, string>;
    const enCatalogLocal = en as unknown as Record<string, string>;
    for (const old of ['dropShadow', 'innerShadow', 'layerBlur']) {
      expect(zhLocal[`inspector.effect.${old}`]).toBeUndefined();
      expect(enCatalogLocal[`inspector.effect.${old}`]).toBeUndefined();
    }
  });
});

describe('P2-6 · 动态拼键纪律的「功能域钉值」半边（AiDrawer 步骤族）', () => {
  // 口径统一（P2-6）：静态键由 catalog-coverage.test 守卫；动态键（t(`prefix.${value}`)）
  // 由各功能域用例钉住**全部**取值（catalog-coverage 文件头的既定纪律）。AiDrawer 的
  // 步骤/状态标签走动态键——这里枚举 steps.ts 导出的全集逐键断言不回键（degrade 族
  // 已由 AiDrawer.test.tsx 的 it.each 钉住，不重复）。
  const catalog = zhCN as unknown as Record<string, string>;
  const enCatalog = en as unknown as Record<string, string>;

  it('可见步骤 id 全集（AI_VISIBLE_STEPS）在两目录都有词条（t() 不回键）', () => {
    for (const id of AI_VISIBLE_STEPS) {
      const key = `ai.step.${id}`;
      expect(catalog[key]).toBeTruthy();
      expect(catalog[key]).not.toBe(key);
      expect(enCatalog[key]).toBeTruthy();
    }
  });

  it('步骤状态全集（pending/active/done/failed）在两目录都有词条', () => {
    for (const status of AI_STEP_STATUSES) {
      const key = `ai.step.status.${status}`;
      expect(catalog[key]).toBeTruthy();
      expect(catalog[key]).not.toBe(key);
      expect(enCatalog[key]).toBeTruthy();
    }
  });
});
