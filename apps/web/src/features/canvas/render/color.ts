/**
 * 颜色工具（渲染层）：令牌字符串 → Skia 颜色。
 *
 * 令牌里的颜色是 CSS 语法（`#RRGGBB` / `#RRGGBBAA` / `rgba(...)`）；CanvasKit 要 0–1 浮点四元组。
 * 解析失败**抛错**（令牌写错时立刻炸，而不是画成透明）。
 */

import type { Color } from 'canvaskit-wasm';

/** RGBA 分量（0–1）。 */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 校验分量范围。 */
function channel(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`颜色分量越界（需 0–1）：${String(value)}`);
  }
  return value;
}

/** 取亮度乘子：alpha 乘算（悬停/次要元素的透明度调制）。 */
export function withAlpha(color: Rgba, alpha: number): Rgba {
  return { r: color.r, g: color.g, b: color.b, a: channel(color.a * alpha) };
}

/** `#RGB` / `#RRGGBB` / `#RRGGBBAA` → RGBA。 */
export function parseHexColor(value: string): Rgba {
  const hex = value.trim().replace(/^#/, '');
  const expand = (short: string): string =>
    short
      .split('')
      .map((char) => `${char}${char}`)
      .join('');
  const full = hex.length === 3 || hex.length === 4 ? expand(hex) : hex;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full)) {
    throw new Error(`无法解析的颜色字面量：${value}`);
  }
  const int = (start: number): number => Number.parseInt(full.slice(start, start + 2), 16) / 255;
  return {
    r: int(0),
    g: int(2),
    b: int(4),
    a: full.length === 8 ? int(6) : 1,
  };
}

/** `rgb(r, g, b)` / `rgba(r, g, b, a)` → RGBA（a 支持 0–1 小数与 0–255 整数两种写法）。 */
export function parseRgbColor(value: string): Rgba {
  const match = /^rgba?\(\s*([^)]+)\)$/i.exec(value.trim());
  if (match === null) throw new Error(`无法解析的颜色字面量：${value}`);
  const parts = (match[1] as string).split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`无法解析的颜色字面量：${value}`);
  }
  const toUnit = (part: number): number => {
    if (part > 1) return channel(part / 255);
    return channel(part);
  };
  return {
    r: toUnit(parts[0] as number),
    g: toUnit(parts[1] as number),
    b: toUnit(parts[2] as number),
    a: parts.length >= 4 ? toUnit(parts[3] as number) : 1,
  };
}

/** 任意 CSS 颜色字面量（本项目令牌的子集）→ RGBA。 */
export function parseColor(value: string): Rgba {
  const trimmed = value.trim();
  if (trimmed.startsWith('#') || /^[0-9a-fA-F]{3,8}$/.test(trimmed)) return parseHexColor(trimmed);
  if (/^rgba?\(/i.test(trimmed)) return parseRgbColor(trimmed);
  throw new Error(`不支持的颜色语法：${value}`);
}

/** RGBA → CanvasKit Color。 */
export function toCanvasKitColor(canvasKit: CanvasKitLike, color: Rgba): Color {
  return canvasKit.Color4f(color.r, color.g, color.b, color.a);
}

/** 颜色工具只需要 Color4f——避免把整个 CanvasKit 类型引进来（便于测试替身）。 */
export interface CanvasKitLike {
  Color4f(r: number, g: number, b: number, a?: number): Color;
}
