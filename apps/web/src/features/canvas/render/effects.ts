/**
 * 效果滤镜（工单 09）：投影 / 内阴影 / 层模糊接入 draw-scene 的纯逻辑与 Skia 对象复用层。
 *
 * 口径换算（与 Figma / CSS 对齐，B 级视觉等价）：
 * - σ = blur / 2：CSS box-shadow 与 Figma 的模糊半径 → 高斯 σ 同为减半（`sigmaOf`）；
 * - 投影 offset 直接映射 `ImageFilter.MakeDropShadow` 的 dx/dy（世界单位，随 CTM 缩放）；
 * - 层模糊走 `ImageFilter.MakeBlur(σ, σ, TileMode.Decal)`：Decal = 边界外透明，
 *   不产生 Clamp 模式的边缘拖影。
 *
 * 实现选择与取舍（**显式登记**，工单 09 验收项；对应 draw-scene.ts 头注释）：
 * - spread = 0 的投影：`MakeDropShadow` 单遍（滤镜输出自带内容 + 阴影），一次绘制；
 * - spread > 0 的投影：Skia 的 DropShadow 没有 spread 参数——
 *   用 `MakeDropShadowOnly + MakeDilate(spread)`（放大轮廓、只留阴影）作**底垫笔**，
 *   内容另起一笔画在其上（两段绘制等价于 Figma 的「放大轮廓投影」）；
 * - 内阴影：CanvasKit 无原生内阴影滤镜——clip 节点形状 → saveLayer → `drawColor` 底色 →
 *   用 `MaskFilter.MakeBlur(Normal, σ)` + `BlendMode.DstOut` 擦除「偏移后的模糊形状」，
 *   剩下的边缘色带即内阴影（spread 靠擦除轮廓几何外扩 `inflateRect` 实现）；
 * - 层模糊作用于**整层**：叶子节点 = 内容滤镜（连自身描边一起模糊）；
 *   容器（frame/group/component/component_set/instance）= saveLayer 把子树合成后再模糊
 *   （这是对原 P0「容器 opacity 不做离屏合成」口径的**唯一扩圈**：
 *   仅当容器带可见层模糊时扩，容器 opacity 仍逐 paint 乘 alpha、不扩）；
 * - 投影/内阴影按**节点自身形状**轮廓计算（frame 取自身 rrect 轮廓，不做子树联合轮廓；
 *   group 无自身形状 → 其投影/内阴影不画，仅层模糊生效——登记为已知近似）；
 *   文本节点不画内阴影（无简单形状可 clip，登记）；
 * - 组合口径：多效果按 effects 数组序逐项应用，投影链「后列表项在上」（Figma 口径），
 *   层模糊恒为最外层（连投影边缘一起模糊，与 Figma 的「层级模糊」语义一致）。
 *
 * 性能登记（含离屏合成含义）：
 * - 每个带效果节点每帧的显式离屏合成：底垫 / 内容各至多一层 + **每条内阴影一层**；
 *   容器带层模糊再 +1 层（子树合成）。层边界 = 节点矩形外扩 `outset`
 *   （3σ + |offset| + spread）——短命小层，非全画布层；
 * - `ImageFilter` / `MaskFilter` 是 Embind 对象，**按效果签名缓存复用**（同 ParagraphCache
 *   惯例：两个缓存都是 256 容量上限，超限淘汰最早插入项并显式 delete，避免 wasm 堆泄漏）。
 *   同一签名的节点全帧共享同一对象，不每帧 new；
 *   已知边界（对抗用例登记，`effects.test.ts`）：单帧不同签名超过容量时，最早的滤镜对象
 *   会在同帧内被淘汰删除——常态下单帧签名数远小于容量（淘汰对象均已绘制完），真实渲染
 *   下的边界表现待 dev 机验证；纯逻辑层用例锁定「计划结构仍正确 + 淘汰路径真触发」。
 * - 效果绘制计数：`EffectPlan.rendered` 供 draw-scene 累加进 `SceneDrawCounters.effectsRendered`，
 *   经既有 `stats()` 观测通道供门禁读取（工单 09 验收项）。
 */

import type { Effect } from '@dforge/engine';
import type { CanvasKit, Color, ImageFilter, MaskFilter } from 'canvaskit-wasm';

import { parseColor, withAlpha } from './color';

/** 高斯模糊的可见半径（Skia 经验法则：约 3σ 处截断）——saveLayer 边界外扩的依据。 */
export const BLUR_REACH_SIGMAS = 3;

/** Figma/CSS 的模糊半径 → 高斯 σ：减半；非有限或负值 → 0（硬边）。 */
export function sigmaOf(blur: number): number {
  if (!Number.isFinite(blur) || blur <= 0) return 0;
  return blur / 2;
}

/**
 * 可绘制的效果列表（渲染入口的清洗层）：
 * - `visible = false` 剔除；
 * - 任一数值参数非有限 → 整条剔除（画错不如不画）；
 * - `layer_blur` 的 blur ≤ 0 无意义 → 剔除；阴影 blur ≤ 0 是合法硬边 → 保留（σ 归 0）；
 * - 颜色字面量解析失败 → 剔除（解析器抛错在此吞掉，渲染主流程不因脏数据炸）；
 * - **保持数组顺序**（Figma 口径：按列表序逐项应用；组合层级由 `buildEffectPlan` 决定）。
 */
export function visibleEffects(effects: readonly Effect[] | undefined): Effect[] {
  if (effects === undefined || effects.length === 0) return [];
  const out: Effect[] = [];
  for (const effect of effects) {
    if (!effect.visible) continue;
    const { offsetX, offsetY, blur, spread } = effect;
    if (
      !Number.isFinite(offsetX) ||
      !Number.isFinite(offsetY) ||
      !Number.isFinite(blur) ||
      !Number.isFinite(spread)
    ) {
      continue;
    }
    if (effect.type === 'layer_blur' && blur <= 0) continue;
    try {
      parseColor(effect.color);
    } catch {
      continue;
    }
    out.push(effect);
  }
  return out;
}

/** 效果滤镜缓存键（所有影响渲染结果的字段都要进键，否则「改了参数没重画」）。 */
export function effectCacheKey(effect: Effect, alpha: number): string {
  return [
    effect.type,
    effect.color,
    effect.offsetX,
    effect.offsetY,
    sigmaOf(effect.blur), // σ 归一化后进键（blur 抖动 ±0 不产生新对象）
    effect.spread,
    alpha,
  ].join('|');
}

/** 效果色（CanvasKit Color）：效果色 alpha × 节点 alpha（效果是层级属性，不乘填充透明度）。 */
function effectColor(canvasKit: CanvasKit, literal: string, alpha: number): Color {
  const rgba = withAlpha(parseColor(literal), alpha);
  return canvasKit.Color4f(rgba.r, rgba.g, rgba.b, rgba.a);
}

/** ImageFilter / MaskFilter 缓存（WeakMap 按 CanvasKit 实例隔离；超容量显式 delete 最旧）。 */
const filterCache = new WeakMap<CanvasKit, Map<string, ImageFilter>>();
const maskFilterCache = new WeakMap<CanvasKit, Map<string, MaskFilter>>();
/** 缓存容量（同 ParagraphCache 惯例：超限淘汰最早插入项，淘汰时显式 delete Embind 对象）。 */
const FILTER_CACHE_CAPACITY = 256;

/** 取（或构建）缓存的 ImageFilter；命中即复用，避免每帧 new Embind 对象。 */
function cachedFilter(
  canvasKit: CanvasKit,
  key: string,
  build: () => ImageFilter,
): ImageFilter {
  let perKit = filterCache.get(canvasKit);
  if (perKit === undefined) {
    perKit = new Map();
    filterCache.set(canvasKit, perKit);
  }
  const hit = perKit.get(key);
  if (hit !== undefined) return hit;
  const filter = build();
  perKit.set(key, filter);
  if (perKit.size > FILTER_CACHE_CAPACITY) {
    const oldestKey = perKit.keys().next().value;
    if (oldestKey !== undefined && oldestKey !== key) {
      perKit.get(oldestKey)?.delete();
      perKit.delete(oldestKey);
    }
  }
  return filter;
}

/**
 * 内阴影擦除用的模糊 MaskFilter（`BlurStyle.Normal` + respectCTM：σ 是世界单位）。
 * σ ≤ 0 → null（硬边擦除，无需滤镜）。
 *
 * 缓存与 `cachedFilter` 同构：按 σ 签名复用 + 容量上限淘汰最旧（淘汰时显式
 * `delete()` Embind 对象再出 map）——无上限的 `Map.set` 会让每个新 σ 常驻 wasm 堆。
 * 构建失败（MakeBlur 返回 null）不入缓存，下次重试。
 */
export function blurMaskFilter(canvasKit: CanvasKit, sigma: number): MaskFilter | null {
  if (!Number.isFinite(sigma) || sigma <= 0) return null;
  let perKit = maskFilterCache.get(canvasKit);
  if (perKit === undefined) {
    perKit = new Map();
    maskFilterCache.set(canvasKit, perKit);
  }
  const key = String(sigma);
  const hit = perKit.get(key);
  if (hit !== undefined) return hit;
  const filter = canvasKit.MaskFilter.MakeBlur(
    canvasKit.BlurStyle.Normal,
    sigma,
    true,
  ) as MaskFilter | null;
  if (filter === null) return null;
  perKit.set(key, filter);
  if (perKit.size > FILTER_CACHE_CAPACITY) {
    const oldestKey = perKit.keys().next().value;
    if (oldestKey !== undefined && oldestKey !== key) {
      perKit.get(oldestKey)?.delete();
      perKit.delete(oldestKey);
    }
  }
  return filter;
}

/** 内阴影擦除轮廓的矩形外扩（spread 把影子往里推 = 擦除轮廓变大）。 */
export function inflateRect(
  rect: { x: number; y: number; width: number; height: number },
  spread: number,
): { x: number; y: number; width: number; height: number } {
  const amount = Math.max(0, spread);
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

/** 擦除轮廓的圆角：随 spread 增大，钳制在膨胀后包围盒短边一半内（Skia RRect 合法性）。 */
export function inflatedCornerRadius(
  radius: number,
  spread: number,
  inflatedWidth: number,
  inflatedHeight: number,
): number {
  return Math.min(Math.max(0, radius) + Math.max(0, spread), inflatedWidth / 2, inflatedHeight / 2);
}

/** 内阴影的单条绘制参数（换算完成，draw-scene 逐条执行）。 */
export interface InnerShadowPlan {
  color: Color;
  dx: number;
  dy: number;
  sigma: number;
  spread: number;
}

/** 一次节点绘制的效果计划（draw-scene 据此分流：底垫笔 / 内容笔 / 内阴影逐条）。 */
export interface EffectPlan {
  /** 内容笔滤镜：spread=0 投影（含内容）+ 叶子层模糊（最外层）；null = 内容直接画。 */
  content: ImageFilter | null;
  /** 底垫笔滤镜：spread>0 投影（只留阴影、轮廓已 Dilate 放大）；null = 无底垫。 */
  shadowOnly: ImageFilter | null;
  /** 内阴影逐条（数组序；在自身填充之上、子节点之后绘制）。 */
  innerShadows: InnerShadowPlan[];
  /** saveLayer 边界外扩（世界单位，按轴取各效果最大值）。 */
  outset: { x: number; y: number };
  /** 本计划会实际绘制的效果条数（进 `SceneDrawCounters.effectsRendered`）。 */
  rendered: number;
}

/** 零效果计划（无效果节点的快路径：不查缓存、不建对象）。 */
const EMPTY_PLAN: EffectPlan = {
  content: null,
  shadowOnly: null,
  innerShadows: [],
  outset: { x: 0, y: 0 },
  rendered: 0,
};

/**
 * 组合效果计划。组合口径：
 * - 投影按数组序折叠进 `MakeCompose(后者, 前者)`——后列表项在上（Figma 口径）；
 * - 层模糊恒为最外层（连投影边缘一起模糊）；
 * - spread>0 投影全部折叠进底垫链（与内容分离，内容另起一笔）；
 * - 每个贡献都按签名缓存：单效果按 `effectCacheKey`，组合链按「折叠序签名」，
 *   同签名全帧共享同一 ImageFilter 对象。
 */
export function buildEffectPlan(
  canvasKit: CanvasKit,
  effects: readonly Effect[],
  alpha: number,
): EffectPlan {
  if (effects.length === 0) return EMPTY_PLAN;

  let contentCount = 0;
  let shadowCount = 0;
  const innerShadows: InnerShadowPlan[] = [];
  let outsetX = 0;
  let outsetY = 0;

  /**
   * 把单个效果滤镜折叠进链：`MakeCompose(single, 旧链)`（single 在上、旧链在下）。
   * 首个贡献直接用自身（Compose 与 null 输入返回另一参数本身，无需包装对象）；
   * 组合结果按「折叠序签名」缓存——签名含序：顺序不同 = 视觉不同 ≠ 同一对象。
   */
  const fold = (
    chain: { filter: ImageFilter | null; sig: string },
    single: ImageFilter,
    singleKey: string,
  ): void => {
    const previous = chain.filter;
    chain.sig = chain.sig === '' ? singleKey : `${chain.sig}>>${singleKey}`;
    chain.filter =
      previous === null
        ? single
        : cachedFilter(canvasKit, `chain|${chain.sig}`, () =>
            canvasKit.ImageFilter.MakeCompose(single, previous),
          );
  };
  const contentChain = { filter: null as ImageFilter | null, sig: '' };
  const shadowChain = { filter: null as ImageFilter | null, sig: '' };

  for (const effect of effects) {
    const sigma = sigmaOf(effect.blur);
    if (effect.type === 'drop_shadow') {
      const color = effectColor(canvasKit, effect.color, alpha);
      const reach = BLUR_REACH_SIGMAS * sigma + Math.max(0, effect.spread);
      outsetX = Math.max(outsetX, Math.abs(effect.offsetX) + reach);
      outsetY = Math.max(outsetY, Math.abs(effect.offsetY) + reach);
      if (effect.spread > 0) {
        // spread>0：放大轮廓 + 只留阴影（底垫笔）；Dilate 输入滤镜同样进缓存
        const dilate = cachedFilter(canvasKit, `dilate|${effect.spread}`, () =>
          canvasKit.ImageFilter.MakeDilate(effect.spread, effect.spread, null),
        );
        const single = cachedFilter(canvasKit, effectCacheKey(effect, alpha), () =>
          canvasKit.ImageFilter.MakeDropShadowOnly(
            effect.offsetX,
            effect.offsetY,
            sigma,
            sigma,
            color,
            dilate,
          ),
        );
        fold(shadowChain, single, effectCacheKey(effect, alpha));
        shadowCount += 1;
      } else {
        // spread=0：MakeDropShadow 单遍（输出含内容）
        const single = cachedFilter(canvasKit, effectCacheKey(effect, alpha), () =>
          canvasKit.ImageFilter.MakeDropShadow(
            effect.offsetX,
            effect.offsetY,
            sigma,
            sigma,
            color,
            null,
          ),
        );
        fold(contentChain, single, effectCacheKey(effect, alpha));
        contentCount += 1;
      }
      continue;
    }
    if (effect.type === 'layer_blur') {
      outsetX = Math.max(outsetX, BLUR_REACH_SIGMAS * sigma);
      outsetY = Math.max(outsetY, BLUR_REACH_SIGMAS * sigma);
      const single = cachedFilter(canvasKit, effectCacheKey(effect, alpha), () =>
        canvasKit.ImageFilter.MakeBlur(sigma, sigma, canvasKit.TileMode.Decal, null),
      );
      // 层模糊恒为最外层：效果按数组序处理完后它在链最外（连投影边缘一起模糊）
      fold(contentChain, single, effectCacheKey(effect, alpha));
      contentCount += 1;
      continue;
    }
    if (effect.type === 'inner_shadow') {
      // 内阴影只在形状内部：不贡献 outset（擦除只会减少像素，不越界）
      innerShadows.push({
        color: effectColor(canvasKit, effect.color, alpha),
        dx: effect.offsetX,
        dy: effect.offsetY,
        sigma,
        spread: effect.spread,
      });
    }
  }

  return {
    content: contentChain.filter,
    shadowOnly: shadowChain.filter,
    innerShadows,
    outset: { x: outsetX, y: outsetY },
    rendered: contentCount + shadowCount + innerShadows.length,
  };
}
