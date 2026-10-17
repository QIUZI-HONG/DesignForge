/**
 * 「不可用」占位符单点（复核 J5：此前 `FilterRow` / `FilterBar` / `NumberField` 与
 * 若干处行内字面量各写一份 `'—'`——同物异名/同名异物的漂移面）。
 *
 * 语义：数据面**不可用**（连不上、算不出）时界面显示什么。空字符串会把「不可用」与
 * 「真实为空」混为一谈，`0` 更会把「连不上」说成「没有」（G5/UX-19：计数不可用显示
 * 「—」而不是 0）。各领域保留自己的语义别名（`COUNT_UNAVAILABLE` /
 * `MARKET_COUNT_UNAVAILABLE` / `MIXED_PLACEHOLDER`），但**值只能来自这里**。
 */
export const UNAVAILABLE_PLACEHOLDER = '—';
