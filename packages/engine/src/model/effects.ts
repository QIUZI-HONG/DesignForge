/**
 * Effect 字段描述表——字段义务的单一真源（arch-03）。
 *
 * 背景：`Effect` 的 7 个字段此前在四处各枚举一次、义务互不知情——渲染滤镜缓存键
 * （哪些字段影响签名）、Inspector 结构等值（`sameEffects`）、参数补丁的「无变化」
 * 判定、Inspector 控件覆盖。任何一处漏字段都是静默缺陷（改了参数没重画 /
 * 混选不显示「—」/ 空修改产生历史）。
 *
 * 口径：
 * - 用 `satisfies Record<keyof Effect, EffectFieldSpec>` 登记——`Effect` 新增字段而
 *   表未登记 = **编译期报缺项**；多登记同样编译失败。
 * - `effectCacheKey` / `sameEffects` 只从表派生，消费侧不得再手写字段列表。
 * - 缓存键键序 = 表的声明序，键值 = `String(cacheValue ?? 原值)`；容器在末尾追加参数
 *   （alpha 属于调用点，不是 `Effect` 字段）。
 */

import type { Effect } from './paint';

/** 单字段的比较方式：原始值严格相等，或自定义比较函数（结构字段扩展时用）。 */
export type EffectFieldCompare = 'strict' | ((a: Effect, b: Effect) => boolean);

/** Effect 单字段的义务描述。 */
export interface EffectFieldSpec {
  /** 是否进渲染滤镜缓存键（凡影响渲染结果的字段都必须进键）。 */
  readonly cacheKey: boolean;
  /** 结构等值如何比较（Inspector 混选判定的依据）。 */
  readonly compare: EffectFieldCompare;
  /** 是否可经 Inspector 编辑（false = 创建时选定，之后不提供控件）。 */
  readonly editable: boolean;
  /** 缓存键取值归一化（缺省取原值）——如 blur → σ，避免无意义的键抖动。 */
  readonly cacheValue?: (effect: Effect) => string | number | boolean;
}

/** Figma/CSS 的模糊半径 → 高斯 σ：减半；非有限或负值 → 0（硬边）。 */
export function sigmaOf(blur: number): number {
  if (!Number.isFinite(blur) || blur <= 0) return 0;
  return blur / 2;
}

/**
 * Effect 字段描述表（唯一真源）。
 *
 * `visible` 不进缓存键：渲染入口 `visibleEffects` 先剔除不可见效果，缓存键只承载
 * 「实际会画出来的滤镜」的签名；结构等值仍包含它（混选要能显示可见性差异）。
 */
export const EFFECT_FIELDS = {
  type: { cacheKey: true, compare: 'strict', editable: false },
  color: { cacheKey: true, compare: 'strict', editable: true },
  offsetX: { cacheKey: true, compare: 'strict', editable: true },
  offsetY: { cacheKey: true, compare: 'strict', editable: true },
  blur: {
    cacheKey: true,
    compare: 'strict',
    editable: true,
    cacheValue: (effect: Effect) => sigmaOf(effect.blur),
  },
  spread: { cacheKey: true, compare: 'strict', editable: true },
  visible: { cacheKey: false, compare: 'strict', editable: true },
} as const satisfies Record<keyof Effect, EffectFieldSpec>;

/** 表登记的字段键（顺序 = 缓存键的字段序）。 */
export const EFFECT_FIELD_KEYS = Object.keys(EFFECT_FIELDS) as readonly EffectField[];

/** 字段键类型（= `keyof Effect`，经表反射，供消费侧按名引用）。 */
export type EffectField = keyof typeof EFFECT_FIELDS;

/** 可编辑字段（表中 `editable: true` 的键；Inspector 控件覆盖面的类型依据）。 */
export type EffectEditableField = {
  [K in EffectField]: (typeof EFFECT_FIELDS)[K]['editable'] extends true ? K : never;
}[EffectField];

/** 可编辑且值为数值的字段（数值控件用：键集随表变化，漏接控件即编译红）。 */
export type EffectNumberField = {
  [K in EffectEditableField]: Effect[K] extends number ? K : never;
}[EffectEditableField];

/** 单条效果的渲染滤镜缓存键（字段集与归一化由 `EFFECT_FIELDS` 派生）。 */
export function effectCacheKey(effect: Effect, alpha: number): string {
  const parts: string[] = [];
  for (const key of EFFECT_FIELD_KEYS) {
    const spec: EffectFieldSpec = EFFECT_FIELDS[key];
    if (!spec.cacheKey) continue;
    const value = spec.cacheValue === undefined ? effect[key] : spec.cacheValue(effect);
    parts.push(String(value));
  }
  parts.push(String(alpha));
  return parts.join('|');
}

/** 单条效果结构等值（字段集与比较方式由 `EFFECT_FIELDS` 派生）。 */
export function sameEffect(a: Effect, b: Effect): boolean {
  for (const key of EFFECT_FIELD_KEYS) {
    const spec: EffectFieldSpec = EFFECT_FIELDS[key];
    const equal = spec.compare === 'strict' ? a[key] === b[key] : spec.compare(a, b);
    if (!equal) return false;
  }
  return true;
}

/** 效果数组结构等值（顺序敏感；长度不同即不等）。 */
export function sameEffects(a: readonly Effect[], b: readonly Effect[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const effect = a[index];
    const other = b[index];
    if (effect === undefined || other === undefined) return false;
    if (!sameEffect(effect, other)) return false;
  }
  return true;
}
