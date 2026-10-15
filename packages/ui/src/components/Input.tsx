/**
 * Input —— 文本 / 数字 / 搜索输入（面板与表单的基础件）。
 *
 * 形态：外层 `dfg-input-wrap` 承载边框与焦点环（焦点环落在外层，输入本体去边框），
 * 因此「前缀图标 + 输入 + 后缀槽」共用一套几何；焦点环用 `:focus-within`，
 * 键盘与鼠标进入编辑都可见（验收标准 §5 的 active(focus-visible) 口径）。
 * 错误态：`aria-invalid` + `aria-describedby` 指到错误文案（`role="alert"`），
 * 文案一律由调用方给（本包不含业务文案）。
 */
import { forwardRef, type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { SearchIcon } from '../icons/index';
import { cx } from '../utils/class-names';

/** 输入类型：文本 / 数字 / 搜索。 */
export type InputKind = 'text' | 'number' | 'search';

/** Input props。 */
export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'size'> {
  kind?: InputKind;
  size?: 'sm' | 'md';
  /** 字段名（给出后渲染 label 并与控件关联）。 */
  fieldLabel?: ReactNode;
  /** 错误态开关（配合 errorMessage 或缺省单独使用）。 */
  invalid?: boolean;
  /** 校验错误文案（给出即错误态，读屏播报）。 */
  errorMessage?: ReactNode;
  /** 正常态辅助说明。 */
  hint?: ReactNode;
  /** 前缀图标覆盖（默认：搜索态用放大镜）。 */
  icon?: ReactNode;
  /** 后缀槽（清除键、单位等由调用方给）。 */
  trailing?: ReactNode;
  className?: string;
}

/** 输入控件。 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    kind = 'text',
    size = 'md',
    fieldLabel,
    invalid = false,
    errorMessage,
    hint,
    icon,
    trailing,
    className,
    id,
    disabled,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? `dfg-input-${autoId}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const isInvalid = invalid || errorMessage !== undefined;
  const leadingIcon = icon ?? (kind === 'search' ? <SearchIcon /> : undefined);
  const describedBy =
    errorMessage !== undefined ? errorId : hint !== undefined ? hintId : undefined;

  return (
    <div className={cx('dfg-field', className)}>
      {fieldLabel === undefined ? null : (
        <label className="dfg-field__label" htmlFor={inputId}>
          {fieldLabel}
        </label>
      )}
      <div
        className={cx(
          'dfg-input-wrap',
          size === 'sm' && 'dfg-input-wrap--sm',
          isInvalid && 'dfg-input-wrap--invalid',
          disabled === true && 'dfg-input-wrap--disabled',
        )}
      >
        {leadingIcon === undefined ? null : (
          <span className="dfg-input-wrap__affix">{leadingIcon}</span>
        )}
        <input
          ref={ref}
          id={inputId}
          type={kind === 'number' ? 'number' : kind === 'search' ? 'search' : 'text'}
          className={cx('dfg-input', kind === 'number' && 'dfg-input--number')}
          aria-invalid={isInvalid ? true : undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          {...rest}
        />
        {trailing === undefined ? null : <span className="dfg-input-wrap__affix">{trailing}</span>}
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
});
