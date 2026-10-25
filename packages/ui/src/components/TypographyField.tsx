'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * TypographyField —— 字号/字重选择（RW-07 最小集；Inspector 文字分区消费）。
 *
 * 口径：语义用**原生下拉**（`select` + `option`）——字号/字重是「从枚举里选一个」，
 * 原生控件免费拿到键盘可达、读屏支持与移动端外形；选项文案由调用方给
 * （字重的「常规/中/粗」、字号的数值展示都属界面文案，本包不含）。
 * 两个维度各自上报（`{size?}` / `{weight?}`），调用方合并进自己的样式状态。
 */
import type { ReactNode } from 'react';
import { useId } from 'react';

import { cx } from '../utils/class-names';

/** 单个选项（label 由调用方给，本包不含界面文案）。 */
export interface TypographyOption {
  value: number;
  label: string;
  disabled?: boolean;
}

/** TypographyField props。 */
export interface TypographyFieldProps {
  /** 整组可访问名（如「文字」）。 */
  label: string;
  /** 字号下拉的可访问名（如「字号」）。 */
  sizeLabel: string;
  /** 字重下拉的可访问名（如「字重」）。 */
  weightLabel: string;
  /** 当前字号（受控）。 */
  size: number;
  sizes: TypographyOption[];
  /** 当前字重（受控）。 */
  weight: number;
  weights: TypographyOption[];
  /** 变更上报：只携带被改的维度，另一维度保持。 */
  onChange: (next: { size?: number; weight?: number }) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** 校验错误文案（给出即错误态，读屏播报；文案由调用方给）。 */
  errorMessage?: ReactNode;
  /** 正常态辅助说明。 */
  hint?: ReactNode;
  className?: string;
}

/** 字号/字重选择控件。 */
export function TypographyField({
  label,
  sizeLabel,
  weightLabel,
  size,
  sizes,
  weight,
  weights,
  onChange,
  disabled = false,
  invalid = false,
  errorMessage,
  hint,
  className,
}: TypographyFieldProps) {
  const autoId = useId();
  const errorId = `dfg-typography-${autoId}-error`;
  const hintId = `dfg-typography-${autoId}-hint`;
  const isInvalid = invalid || errorMessage !== undefined;
  const describedBy =
    errorMessage !== undefined ? errorId : hint !== undefined ? hintId : undefined;

  const renderSelect = (
    accessibleLabel: string,
    current: number,
    options: TypographyOption[],
    onPick: (value: number) => void,
  ): ReactNode => (
    <select
      className="dfg-typography__select"
      aria-label={accessibleLabel}
      value={String(current)}
      disabled={disabled}
      aria-invalid={isInvalid ? 'true' : undefined}
      aria-describedby={describedBy}
      onChange={(event) => {
        onPick(Number(event.target.value));
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={String(option.value)} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );

  return (
    <div role="group" aria-label={label} className={cx('dfg-field', 'dfg-typography', className)}>
      <div className="dfg-typography__controls">
        {renderSelect(sizeLabel, size, sizes, (value) => onChange({ size: value }))}
        {renderSelect(weightLabel, weight, weights, (value) => onChange({ weight: value }))}
      </div>
      {errorMessage === undefined ? null : (
        <span className="dfg-field__error" id={errorId} role="alert">
          {errorMessage}
        </span>
      )}
      {errorMessage === undefined && hint !== undefined ? (
        <span className="dfg-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
