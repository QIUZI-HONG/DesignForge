/**
 * 效果滤镜纯逻辑回归（工单 09）。
 *
 * 断言口径：效果参数解析/换算/缓存键/组合计划都是**可脱离像素验证的纯逻辑**，
 * 先在这里锁口径（σ 换算、spread 分流、blur 最外层、Embind 复用、外扩边界），
 * 「画出来的像素对不对」由 renderer.test.ts 的像素级样本与浏览器门禁（对照 Figma 本体）负责。
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  createPage,
  createRect,
  defaultGridSettings,
  dropShadow,
  type Effect,
  type ScenePage,
} from '@dforge/engine';
import type { CanvasKit } from 'canvaskit-wasm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  blurMaskFilter,
  buildEffectPlan,
  effectCacheKey,
  inflatedCornerRadius,
  inflateRect,
  sigmaOf,
  visibleEffects,
} from './effects';

const require = createRequire(import.meta.url);

let canvasKit: CanvasKit;

beforeAll(async () => {
  const entry = require.resolve('canvaskit-wasm/bin/canvaskit.js');
  const module = (await import(`file://${entry}`)) as { default: unknown };
  const init = module.default as (options: {
    locateFile: (file: string) => string;
  }) => Promise<CanvasKit>;
  canvasKit = await init({ locateFile: (file) => join(dirname(entry), file) });
}, 60_000);

/** 便捷构造：覆盖默认字段的 Effect。 */
function effectOf(overrides: Partial<Effect>): Effect {
  return {
    type: 'drop_shadow',
    color: '#FF0000',
    offsetX: 0,
    offsetY: 0,
    blur: 8,
    spread: 0,
    visible: true,
    ...overrides,
  };
}

describe('visibleEffects（解析与清洗）', () => {
  it('剔除不可见效果，保持文档数组顺序（Figma 口径：按列表序逐项应用）', () => {
    const effects = [
      effectOf({ type: 'layer_blur', blur: 10 }),
      dropShadow('#000000', 4, 4, 8, 2),
      effectOf({ visible: false }),
      effectOf({ type: 'inner_shadow', blur: 4 }),
    ];
    const visible = visibleEffects(effects);
    expect(visible.map((item) => item.type)).toEqual(['layer_blur', 'drop_shadow', 'inner_shadow']);
  });

  it('任一数值参数非有限（NaN/Infinity）→ 整条剔除（画错不如不画）', () => {
    const effects = [
      effectOf({ offsetX: Number.NaN }),
      effectOf({ blur: Number.POSITIVE_INFINITY }),
      effectOf({ type: 'inner_shadow', spread: Number.NaN }),
      dropShadow('#000000', 4, 4, 8, 0),
    ];
    expect(visibleEffects(effects).length).toBe(1);
  });

  it('layer_blur 的 blur ≤ 0 无意义 → 剔除；阴影 blur ≤ 0 是合法硬边 → 保留', () => {
    const effects = [
      effectOf({ type: 'layer_blur', blur: 0 }),
      effectOf({ type: 'layer_blur', blur: -4 }),
      dropShadow('#000000', 0, 0, 0, 0),
    ];
    const visible = visibleEffects(effects);
    expect(visible.map((item) => item.type)).toEqual(['drop_shadow']);
  });

  it('颜色字面量解析失败 → 剔除（渲染层不因脏数据抛错）', () => {
    const effects = [effectOf({ color: '#GGGGGG' }), dropShadow('#000000', 0, 0, 4, 0)];
    expect(visibleEffects(effects).length).toBe(1);
  });

  it('undefined / 空数组 → 空列表（无效果节点走零开销快路径）', () => {
    expect(visibleEffects(undefined)).toEqual([]);
    expect(visibleEffects([])).toEqual([]);
  });
});

describe('sigmaOf（blur → σ 换算）', () => {
  it('CSS box-shadow / Figma 同口径：σ = blur / 2（blur 8 → σ 4）', () => {
    expect(sigmaOf(8)).toBe(4);
    expect(sigmaOf(10)).toBe(5);
  });

  it('blur 0 / 负数 / NaN → σ 0（硬边，不产生模糊）', () => {
    expect(sigmaOf(0)).toBe(0);
    expect(sigmaOf(-4)).toBe(0);
    expect(sigmaOf(Number.NaN)).toBe(0);
  });
});

describe('effectCacheKey（复用缓存键契约）', () => {
  it('同参数同 alpha → 同键', () => {
    const a = effectOf({});
    const b = effectOf({});
    expect(effectCacheKey(a, 1)).toBe(effectCacheKey(b, 1));
  });

  it('任一影响渲染的字段变化 → 键变化（漏字段 = 「改了参数没重画」）', () => {
    const base = effectOf({});
    const alpha = 1;
    const keys = new Set<string>([effectCacheKey(base, alpha)]);
    for (const variant of [
      effectOf({ type: 'inner_shadow' }),
      effectOf({ color: '#00FF00' }),
      effectOf({ offsetX: 1 }),
      effectOf({ offsetY: 1 }),
      effectOf({ blur: 12 }), // σ 进键（blur 8→12 即 σ 4→6）
      effectOf({ spread: 2 }),
    ]) {
      const key = effectCacheKey(variant, alpha);
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
    expect(keys.size).toBe(7);
  });

  it('节点 alpha 变化 → 键变化（阴影色 alpha 随节点透明度乘算）', () => {
    const base = effectOf({});
    expect(effectCacheKey(base, 1)).not.toBe(effectCacheKey(base, 0.5));
  });
});

describe('buildEffectPlan（组合计划，真实 CanvasKit）', () => {
  it('spread=0 投影进内容滤镜（MakeDropShadow 单遍、含内容），rendered=1', () => {
    const plan = buildEffectPlan(canvasKit, [dropShadow('#000000', 20, 0, 8, 0)], 1);
    expect(plan.content).not.toBeNull();
    expect(plan.shadowOnly).toBeNull();
    expect(plan.innerShadows).toHaveLength(0);
    expect(plan.rendered).toBe(1);
    // 外扩 = |dx| + spread + 3σ = 20 + 0 + 12
    expect(plan.outset.x).toBeCloseTo(32);
    expect(plan.outset.y).toBeCloseTo(12);
  });

  it('spread>0 投影走「只留阴影」底垫（MakeDropShadowOnly + MakeDilate），内容滤镜为空', () => {
    const plan = buildEffectPlan(canvasKit, [dropShadow('#000000', 0, 0, 4, 10)], 1);
    expect(plan.shadowOnly).not.toBeNull();
    expect(plan.content).toBeNull();
    expect(plan.rendered).toBe(1);
    // 外扩 = |dx| + spread + 3σ = 0 + 10 + 6
    expect(plan.outset.x).toBeCloseTo(16);
  });

  it('层模糊进内容滤镜且在最外层（连阴影一起模糊），outset = 3σ', () => {
    const blur = effectOf({ type: 'layer_blur', blur: 10 });
    const plan = buildEffectPlan(canvasKit, [blur], 1);
    expect(plan.content).not.toBeNull();
    expect(plan.rendered).toBe(1);
    expect(plan.outset.x).toBeCloseTo(15); // 3σ = 3 × 5
    expect(plan.outset.y).toBeCloseTo(15);
  });

  it('投影 + 层模糊并存：rendered=2，外扩取各效果按轴最大值', () => {
    const shadow = dropShadow('#000000', 20, 0, 8, 0); // x: 20+12=32, y: 12
    const blur = effectOf({ type: 'layer_blur', blur: 10 }); // x/y: 15
    const plan = buildEffectPlan(canvasKit, [shadow, blur], 1);
    expect(plan.rendered).toBe(2);
    expect(plan.outset.x).toBeCloseTo(32);
    expect(plan.outset.y).toBeCloseTo(15);
  });

  it('内阴影逐条携带换算后的参数；色 alpha = 效果色 alpha × 节点 alpha', () => {
    const inner = effectOf({
      type: 'inner_shadow',
      color: '#0000FF80',
      offsetX: 6,
      offsetY: 0,
      blur: 4,
      spread: 2,
    });
    const plan = buildEffectPlan(canvasKit, [inner], 0.5);
    expect(plan.innerShadows).toHaveLength(1);
    const item = plan.innerShadows[0];
    if (item === undefined) throw new Error('innerShadows[0] 缺失');
    expect(item.dx).toBe(6);
    expect(item.dy).toBe(0);
    expect(item.sigma).toBeCloseTo(2); // 4 / 2
    expect(item.spread).toBe(2);
    expect(item.color[3]).toBeCloseTo((128 / 255) * 0.5);
    expect(plan.rendered).toBe(1);
    // 内阴影只在形状内部：不贡献外扩
    expect(plan.outset.x).toBeCloseTo(0);
    expect(plan.content).toBeNull();
    expect(plan.shadowOnly).toBeNull();
  });

  it('不可见/非法效果不进计划：rendered=0、滤镜全空（零开销）', () => {
    // buildEffectPlan 信任入口清洗（visibleEffects），此处按真实调用路径组合
    const plan = buildEffectPlan(canvasKit, visibleEffects([effectOf({ visible: false })]), 1);
    expect(plan.rendered).toBe(0);
    expect(plan.content).toBeNull();
    expect(plan.shadowOnly).toBeNull();
    expect(plan.innerShadows).toHaveLength(0);
    expect(plan.outset.x).toBe(0);
  });

  it('Embind 复用：同签名两次构建返回同一 ImageFilter 对象（不每帧 new）', () => {
    const effects = [dropShadow('#000000', 4, 4, 8, 0), effectOf({ type: 'layer_blur', blur: 10 })];
    const first = buildEffectPlan(canvasKit, effects, 1);
    const second = buildEffectPlan(canvasKit, [...effects], 1);
    expect(first.content).not.toBeNull();
    expect(first.content).toBe(second.content);
    // alpha 不同 → 阴影色不同 → 不同滤镜对象
    const otherAlpha = buildEffectPlan(canvasKit, [...effects], 0.5);
    expect(first.content).not.toBe(otherAlpha.content);
  });

  it('多投影按数组序折叠：后列表项在上（Figma 口径），签名含序（顺序不同 ≠ 同一对象）', () => {
    const a = dropShadow('#FF0000', 0, 0, 4, 0);
    const b = dropShadow('#00FF00', 8, 0, 4, 0);
    const ab = buildEffectPlan(canvasKit, [a, b], 1);
    const ba = buildEffectPlan(canvasKit, [b, a], 1);
    expect(ab.content).not.toBeNull();
    expect(ab.content).not.toBe(ba.content);
    expect(ab.rendered).toBe(2);
  });
});

describe('blurMaskFilter（内阴影擦除滤镜）', () => {
  it('σ>0 返回滤镜并按 σ 复用；σ=0 返回 null（硬边擦除无需滤镜）', () => {
    const filter = blurMaskFilter(canvasKit, 2);
    expect(filter).not.toBeNull();
    expect(blurMaskFilter(canvasKit, 2)).toBe(filter);
    expect(blurMaskFilter(canvasKit, 0)).toBeNull();
  });
});

describe('内阴影 spread 的几何外扩', () => {
  it('inflateRect：矩形向四周扩 spread（擦除轮廓随之变大）', () => {
    expect(inflateRect({ x: 0, y: 0, width: 50, height: 30 }, 4)).toEqual({
      x: -4,
      y: -4,
      width: 58,
      height: 38,
    });
  });

  it('inflatedCornerRadius：圆角随 spread 增大，且钳制在膨胀后包围盒一半内', () => {
    // 半径 6 + spread 4 = 10；膨胀后盒 58×38 的一半是 19 → 不钳
    expect(inflatedCornerRadius(6, 4, 58, 38)).toBe(10);
    // 半径 0 + spread 0 → 0
    expect(inflatedCornerRadius(0, 0, 58, 38)).toBe(0);
    // 大 spread 钳到短边一半
    expect(inflatedCornerRadius(6, 40, 58, 38)).toBe(19);
  });
});

/** 烟雾：夹具页面可正常构造（与 renderer.test.ts 的夹具口径互认）。 */
describe('夹具', () => {
  it('页面夹具构造无异常', () => {
    const rect = createRect({ id: 'n_rect', x: 10, y: 10, width: 50, height: 30 });
    const page: ScenePage = createPage({
      id: 'page_1',
      rootIds: ['n_rect'],
      nodes: { n_rect: rect },
      grid: { ...defaultGridSettings(), visible: false },
    });
    expect(page.rootIds).toEqual(['n_rect']);
  });
});
