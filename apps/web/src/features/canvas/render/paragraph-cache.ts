/**
 * 段落缓存（CanvasKit ParagraphBuilder 的复用层）。
 *
 * 为什么要有它：Paragraph 是 Skia 侧的重量级对象，**不能每帧重建**
 * （`_shared.md` §4「避免明显反模式：别每帧重建 Skia 对象」）。
 * 键 = 文本 + 排版属性 + 颜色 + 布局宽度；命中即复用，未命中才 build；
 * 容量上限触发时**显式 delete 最旧对象**（Embind 对象不 delete 会泄漏 wasm 堆）。
 */

import type { CanvasKit, FontMgr, Paragraph, TextAlign } from 'canvaskit-wasm';

import type { Rgba } from './color';
import { toCanvasKitColor } from './color';

/** 取文本对齐枚举（引擎的 TextAlign → CanvasKit）。 */
export function textAlignOf(
  canvasKit: CanvasKit,
  align: 'left' | 'center' | 'right' | 'justify',
): TextAlign {
  switch (align) {
    case 'center':
      return canvasKit.TextAlign.Center;
    case 'right':
      return canvasKit.TextAlign.Right;
    case 'justify':
      return canvasKit.TextAlign.Justify;
    default:
      return canvasKit.TextAlign.Left;
  }
}

/** 段落规格（渲染层入参，与引擎 `TextContent` 解耦）。 */
export interface ParagraphSpec {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** 行高倍数（1 = 100%）。 */
  lineHeight: number;
  letterSpacing: number;
  align: 'left' | 'center' | 'right' | 'justify';
  color: Rgba;
  /** 布局宽度（世界宽度 × 缩放后的屏幕宽度）；0 → 不限宽（单行标签）。 */
  layoutWidth: number;
  /** 单行标签用：省略号截断（标尺/尺寸标签）。 */
  maxLines?: number;
}

/** 缓存键（所有影响 Skia 渲染的字段都要进键，否则会出现「改了字号没重排」）。 */
function cacheKey(spec: ParagraphSpec): string {
  return [
    spec.fontFamily,
    spec.fontSize,
    spec.fontWeight,
    spec.lineHeight,
    spec.letterSpacing,
    spec.align,
    `${spec.color.r},${spec.color.g},${spec.color.b},${spec.color.a}`,
    spec.layoutWidth,
    spec.maxLines ?? '',
    spec.text,
  ].join('|');
}

/** 段落缓存（LRU 近似：超限淘汰最早插入项）。 */
export class ParagraphCache {
  readonly #entries = new Map<string, Paragraph>();
  readonly #canvasKit: CanvasKit;
  readonly #fontMgr: FontMgr;
  readonly #capacity: number;

  constructor(canvasKit: CanvasKit, fontMgr: FontMgr, capacity = 512) {
    this.#canvasKit = canvasKit;
    this.#fontMgr = fontMgr;
    this.#capacity = capacity;
  }

  /** 取（或构建）段落。 */
  get(spec: ParagraphSpec): Paragraph {
    const key = cacheKey(spec);
    const existing = this.#entries.get(key);
    if (existing !== undefined) return existing;
    const paragraph = this.#build(spec);
    this.#entries.set(key, paragraph);
    if (this.#entries.size > this.#capacity) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey !== undefined && oldestKey !== key) {
        this.#entries.get(oldestKey)?.delete();
        this.#entries.delete(oldestKey);
      }
    }
    return paragraph;
  }

  /** 构建段落（未命中缓存的路径）。 */
  #build(spec: ParagraphSpec): Paragraph {
    const canvasKit = this.#canvasKit;
    // CanvasKit 的字型对象走**规范化函数**（TextStyle/ParagraphStyle）：
    // 直接传裸对象会因省略字段被 emscripten 绑定拒绝（"Missing field"）。
    const textStyle = new canvasKit.TextStyle({
      fontFamilies: [spec.fontFamily],
      fontSize: spec.fontSize,
      heightMultiplier: spec.lineHeight,
      letterSpacing: spec.letterSpacing,
      color: toCanvasKitColor(canvasKit, spec.color),
      fontStyle: { weight: { value: spec.fontWeight } },
    });
    const paragraphStyle = new canvasKit.ParagraphStyle({
      textStyle,
      textAlign: textAlignOf(canvasKit, spec.align),
      textDirection: canvasKit.TextDirection.LTR,
      ...(spec.maxLines === undefined ? {} : { maxLines: spec.maxLines, ellipsis: '…' }),
    });
    const builder = canvasKit.ParagraphBuilder.Make(paragraphStyle, this.#fontMgr);
    builder.pushStyle(textStyle);
    builder.addText(spec.text);
    const paragraph = builder.build();
    builder.delete();
    paragraph.layout(spec.layoutWidth > 0 ? spec.layoutWidth : 1_000_000);
    return paragraph;
  }

  /** 释放全部 Skia 对象。 */
  dispose(): void {
    for (const paragraph of this.#entries.values()) paragraph.delete();
    this.#entries.clear();
  }

  /** 当前缓存条目数（测试/调试）。 */
  get size(): number {
    return this.#entries.size;
  }
}
