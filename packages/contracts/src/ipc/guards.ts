/**
 * @dforge/contracts · 基础形状守卫（手写校验，零运行时依赖）。
 *
 * 契约包不引入 zod 等校验库（保持零依赖、可被 web/daemon/CLI 任意端消费）；
 * 需要校验的地方一律用这里的最小守卫 + 各命名空间内的显式校验函数。
 */

/** 判断是否为可索引的普通对象（排除 null 与数组）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 判断是否为非空（去空白后）字符串。 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 判断是否为有限数值（排除 NaN / Infinity）。 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 判断是否为布尔值。 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/** 判断是否为字符串数组（逐项校验，空数组合法）。 */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** 判断是否为 ISO8601（UTC 或带时区偏移）时间字符串。 */
export function isIsoDateString(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 10) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && value.includes('-');
}

/** 判断是否为 64 位小写十六进制 SHA-256。 */
export function isHexSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** 判断是否为 `sha256:<hex>` 形态的摘要标识。 */
export function isSha256Digest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}
