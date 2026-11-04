/**
 * Effect 字段描述表（arch-03）回归。
 *
 * 断言口径：表是字段义务的唯一真源——结构上覆盖 `Effect` 全部键；缓存键与结构等值
 * 都从表派生；`Effect` 新增字段而表未登记时，`satisfies Record<keyof Effect, …>`
 * 先编译红，本文件的结构断言再兜一层（键集 = 实例键集）。
 */

import { describe, expect, it } from 'vitest';

import {
  EFFECT_FIELD_KEYS,
  EFFECT_FIELDS,
  type Effect,
  type EffectField,
  effectCacheKey,
  sameEffects,
  sigmaOf,
} from '../index';

/** 完整 Effect（编译期强制覆盖全部字段：Effect 新增字段时此处先红）。 */
const COMPLETE: Effect = {
  type: 'drop_shadow',
  color: '#FF0000',
  offsetX: 0,
  offsetY: 0,
  blur: 8,
  spread: 0,
  visible: true,
};

function effectOf(overrides: Partial<Effect>): Effect {
  return { ...COMPLETE, ...overrides };
}

/** 每字段一个「确实不同」的变体（键集由表约束：漏字段即编译错误）。 */
const VARIANTS = {
  type: { type: 'inner_shadow' },
  color: { color: '#00FF00' },
  offsetX: { offsetX: 1 },
  offsetY: { offsetY: 1 },
  blur: { blur: 12 },
  spread: { spread: 2 },
  visible: { visible: false },
} satisfies Record<EffectField, Partial<Effect>>;

describe('EFFECT_FIELDS（字段义务描述表）', () => {
  it('结构断言：表键集 = Effect 实例全部键（漏登记 / 多登记都失败）', () => {
    expect([...EFFECT_FIELD_KEYS].sort()).toEqual(Object.keys(COMPLETE).sort());
  });

  it('每个字段都声明了进键 / 比较方式 / 可编辑三项义务', () => {
    for (const key of EFFECT_FIELD_KEYS) {
      const spec = EFFECT_FIELDS[key];
      expect(typeof spec.cacheKey, key).toBe('boolean');
      expect(spec.compare === 'strict' || typeof spec.compare === 'function', key).toBe(true);
      expect(typeof spec.editable, key).toBe('boolean');
    }
  });
});

describe('effectCacheKey（从表派生）', () => {
  it('进键字段变化 → 键变化；不进键字段（visible）变化 → 键不变', () => {
    const base = effectOf({});
    for (const key of EFFECT_FIELD_KEYS) {
      const changed = effectCacheKey(effectOf(VARIANTS[key]), 1) !== effectCacheKey(base, 1);
      expect(changed, `字段 ${key}`).toBe(EFFECT_FIELDS[key].cacheKey);
    }
  });

  it('键格式钉死（渲染缓存复用不变）：type|color|offsetX|offsetY|σ|spread|alpha', () => {
    expect(effectCacheKey(effectOf({}), 1)).toBe('drop_shadow|#FF0000|0|0|4|0|1');
    expect(effectCacheKey(effectOf({ blur: 12, spread: 2 }), 0.5)).toBe(
      'drop_shadow|#FF0000|0|0|6|2|0.5',
    );
  });

  it('blur 按 σ 归一化进键（blur 8 → σ 4，与渲染换算同源）', () => {
    expect(sigmaOf(8)).toBe(4);
    expect(effectCacheKey(effectOf({ blur: 8 }), 1)).toContain('|4|');
  });
});

describe('sameEffects（从表派生）', () => {
  it('结构等值：同值不同引用相等；长度 / 顺序敏感', () => {
    const blur = effectOf({ type: 'layer_blur', blur: 10 });
    expect(sameEffects([COMPLETE], [{ ...COMPLETE }])).toBe(true);
    expect(sameEffects([COMPLETE, blur], [blur, COMPLETE])).toBe(false);
    expect(sameEffects([COMPLETE], [])).toBe(false);
  });

  it('覆盖全部字段：任一字段变化都不等（含不进键的 visible）', () => {
    const base = effectOf({});
    for (const key of EFFECT_FIELD_KEYS) {
      expect(sameEffects([effectOf(VARIANTS[key])], [base]), `字段 ${key}`).toBe(false);
    }
  });

  it('与缓存键语义一致：进键字段的变化，键与等值都判不等', () => {
    const base = effectOf({});
    for (const key of EFFECT_FIELD_KEYS) {
      if (!EFFECT_FIELDS[key].cacheKey) continue;
      const variant = effectOf(VARIANTS[key]);
      expect(effectCacheKey(variant, 1) === effectCacheKey(base, 1), `字段 ${key}`).toBe(false);
      expect(sameEffects([variant], [base]), `字段 ${key}`).toBe(false);
    }
    expect(effectCacheKey(base, 1) === effectCacheKey(effectOf({}), 1)).toBe(true);
    expect(sameEffects([base], [effectOf({})])).toBe(true);
  });

  it('不进键字段（visible）只影响结构等值：渲染前按可见性清洗，键不承载该义务', () => {
    const hidden = effectOf({ visible: false });
    expect(effectCacheKey(hidden, 1)).toBe(effectCacheKey(effectOf({}), 1));
    expect(sameEffects([hidden], [effectOf({})])).toBe(false);
  });
});
