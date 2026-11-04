/**
 * NumberField 的界面文案与混选占位（Inspector 侧注入点）。
 *
 * `@dforge/ui` 的数值编辑 module 不含业务文案（ADR-0003：界面文案一律经 i18n 目录）；
 * 混选占位仍以 `@/lib/unavailable` 为单点（复核 J5：值只能来自那里）。
 */

import type { NumberFieldMessages } from '@dforge/ui';

import { t } from '@/i18n';
import { UNAVAILABLE_PLACEHOLDER } from '@/lib/unavailable';

/** 混选占位（C6：混合值显示「—」）。 */
export const MIXED_PLACEHOLDER = UNAVAILABLE_PLACEHOLDER;

/** 数值编辑行内提示文案（拒绝/夹取）。 */
export const NUMBER_FIELD_MESSAGES: NumberFieldMessages = {
  reverted: t('inspector.number.reverted'),
  clamped: (value) => t('inspector.number.clamped', { value }),
};
