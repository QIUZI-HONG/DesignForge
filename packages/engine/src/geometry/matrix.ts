/**
 * 2D 仿射矩阵运算（纯函数，无 DOM、无场景依赖）。
 */

import type { Matrix, Point } from './types';

/** 单位阵。 */
export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** 单位阵（返回新对象，便于作为可变结构的初值安全使用）。 */
export function identity(): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/** 矩阵乘法 `m1 · m2`：先施加 `m2`，再施加 `m1`。 */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

/** 平移矩阵。 */
export function translation(tx: number, ty: number): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

/** 缩放矩阵。 */
export function scaling(sx: number, sy = sx): Matrix {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** 旋转矩阵（度，顺时针为正——y 轴向下）。 */
export function rotation(degrees: number): Matrix {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** 绕指定点施加 `m`：`T(p) · m · T(-p)`。 */
export function aroundPoint(m: Matrix, pivot: Point): Matrix {
  return multiply(multiply(translation(pivot.x, pivot.y), m), translation(-pivot.x, -pivot.y));
}

/** 求逆（奇异矩阵返回单位阵，避免下游 NaN 扩散）。 */
export function invert(m: Matrix): Matrix {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return identity();
  const inv = 1 / det;
  return {
    a: m.d * inv,
    b: -m.b * inv,
    c: -m.c * inv,
    d: m.a * inv,
    e: (m.c * m.f - m.d * m.e) * inv,
    f: (m.b * m.e - m.a * m.f) * inv,
  };
}

/** 点变换。 */
export function applyToPoint(m: Matrix, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** 向量变换（忽略平移分量）。 */
export function applyToVector(m: Matrix, v: Point): Point {
  return { x: m.a * v.x + m.c * v.y, y: m.b * v.x + m.d * v.y };
}

/** 旋转向量（度，顺时针为正）。 */
export function rotateVector(v: Point, degrees: number): Point {
  return applyToVector(rotation(degrees), v);
}

/** 矩阵的旋转分量（度）；仅对「旋转 + 平移（无错切）」的矩阵有意义。 */
export function decomposeRotation(m: Matrix): number {
  return (Math.atan2(m.b, m.a) * 180) / Math.PI;
}

/** 是否近似单位阵。 */
export function isIdentity(m: Matrix, epsilon = 1e-9): boolean {
  return (
    Math.abs(m.a - 1) < epsilon &&
    Math.abs(m.b) < epsilon &&
    Math.abs(m.c) < epsilon &&
    Math.abs(m.d - 1) < epsilon &&
    Math.abs(m.e) < epsilon &&
    Math.abs(m.f) < epsilon
  );
}

/** 点间距离。 */
export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** 数值近似相等（几何断言用）。 */
export function nearlyEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

/** 取中点。 */
export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
