import { describe, expect, it } from 'vitest';

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
