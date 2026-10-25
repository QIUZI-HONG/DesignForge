'use client';

/**
 * Inspector 通用小控件（文本草稿输入 / 开关 / 下拉）。
 *
 * 与 NumberField 同一套草稿语义：文本输入静默 300ms 或 Enter/blur 才提交；
 * 开关与下拉是**离散操作**（一次点击 = 一次修改），立即提交一条命令。
 * 文案一律由调用方传入（本模块不含业务文案）。
 */

import { ColorField as UiColorField } from '@dforge/ui';
import { type ChangeEvent, type KeyboardEvent, type ReactNode, useId } from 'react';

import { useDraftCommit } from '../model/draft';
import { MIXED_PLACEHOLDER } from './NumberField';

/** 文本字段 props。 */
export interface DraftTextFieldProps {
  label: string;
  fieldName: string;
  /** 外部真值；undefined = 混选（显示「—」）。 */
  value: string | undefined;
  onCommit(value: string): void;
  /** 提交前校验；不通过则不提交并回滚（如颜色字面量格式）。 */
  validate?: ((value: string) => boolean) | undefined;
  /** 校验失败提示（aria-describedby 指向，读屏可读）。 */
  invalidHint?: string | undefined;
  /** 颜色预览色块（给色值字段用；空则不渲染）。 */
  swatch?: string | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
}

/** 文本草稿输入（300ms 提交；非法值回滚不提交）。 */
export function DraftTextField({
  label,
  fieldName,
  value,
  onCommit,
  validate,
  invalidHint,
  swatch,
  placeholder,
  disabled = false,
}: DraftTextFieldProps) {
  const invalidId = useId();
  const externalText = value === undefined ? MIXED_PLACEHOLDER : value;

  const { draft, setDraft, flush, cancel } = useDraftCommit<string>({
    value: externalText,
    commit: (text) => {
      if (text === externalText) return;
      if (validate !== undefined && !validate(text)) return;
      onCommit(text);
    },
  });

  const display = draft ?? externalText;
  const isInvalid = validate !== undefined && invalidHint !== undefined && !validate(display);

  return (
    <div
      className="dfi-textfield"
      data-df-inspector-field={fieldName}
      data-df-state={disabled ? 'disabled' : value === undefined ? 'mixed' : 'default'}
    >
      <label className="dfi-textfield__label" htmlFor={`dfi-${fieldName}`}>
        {label}
      </label>
      {swatch === undefined ? null : (
        <span
          className="dfi-textfield__swatch"
          style={{ background: swatch }}
          data-df-swatch={fieldName}
        />
      )}
      <input
        id={`dfi-${fieldName}`}
        className="dfi-textfield__input"
        type="text"
        value={display}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        aria-invalid={isInvalid}
        aria-describedby={isInvalid ? invalidId : undefined}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            flush();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
        }}
        onBlur={() => flush()}
      />
      {isInvalid ? (
        <span id={invalidId} role="alert" className="dfi-textfield__error">
          {invalidHint}
        </span>
      ) : null}
    </div>
  );
}

/** 开关字段 props。 */
export interface SwitchFieldProps {
  label: string;
  fieldName: string;
  checked: boolean;
  onChange(next: boolean): void;
  disabled?: boolean;
  /** 禁用原因（tooltip；F15 口径）。 */
  disabledReason?: string | undefined;
}

/** 开关（role="switch"；一次点击 = 一次修改，立即提交）。 */
export function SwitchField({
  label,
  fieldName,
  checked,
  onChange,
  disabled = false,
  disabledReason,
}: SwitchFieldProps) {
  return (
    <div
      className="dfi-switch"
      data-df-inspector-field={fieldName}
      data-df-state={disabled ? 'disabled' : 'default'}
    >
      <span className="dfi-switch__label">{label}</span>
      <button
        type="button"
        className="dfi-switch__control"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

/** 下拉选项。 */
export interface SelectOption {
  value: string;
  label: string;
}

/** 下拉字段 props。 */
export interface SelectFieldProps {
  label: string;
  fieldName: string;
  /** undefined = 混选（显示「—」占位项）。 */
  value: string | undefined;
  options: readonly SelectOption[];
  onChange(value: string): void;
  disabled?: boolean | undefined;
}

/** 下拉（离散操作：选中即提交一条命令）。 */
export function SelectField({
  label,
  fieldName,
  value,
  options,
  onChange,
  disabled = false,
}: SelectFieldProps) {
  return (
    <div
      className="dfi-select"
      data-df-inspector-field={fieldName}
      data-df-state={disabled ? 'disabled' : value === undefined ? 'mixed' : 'default'}
    >
      <span className="dfi-select__label">{label}</span>
      <select
        className="dfi-select__control"
        aria-label={label}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
      >
        {value === undefined ? (
          <option value="" disabled>
            {MIXED_PLACEHOLDER}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 行容器（字段标签 + 控件横排）。 */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="dfi-row">{children}</div>;
}

/** 颜色字段 props（新组件口径：UI-kit ColorField + 门禁挂点 + 混选态）。 */
export interface ColorFieldRowProps {
  label: string;
  fieldName: string;
  /** 外部真值（hex）；undefined = 混选（控件置空并标 mixed 态）。 */
  value: string | undefined;
  /** 提交（UI-kit ColorField 仅在 hex 合法时上报；清空不上报——Inspector 不允许无填充语义）。 */
  onCommit(color: string): void;
  disabled?: boolean | undefined;
}

/**
 * 颜色字段（RW-10 迁移到 UI-kit `ColorField`：色块预览 + hex 文本，
 * 非法输入保留原文标 `aria-invalid` 且不上报）。外层单元是门禁/测试挂点
 * （`data-df-inspector-field` + `data-df-state`），控件本体样式归 `@dforge/ui`。
 */
export function ColorFieldRow({
  label,
  fieldName,
  value,
  onCommit,
  disabled = false,
}: ColorFieldRowProps) {
  const mixed = value === undefined;
  return (
    <div
      className="dfi-colorfield"
      data-df-inspector-field={fieldName}
      data-df-state={disabled ? 'disabled' : mixed ? 'mixed' : 'default'}
    >
      <UiColorField
        fieldLabel={label}
        value={mixed ? null : value}
        disabled={disabled}
        onChange={(next) => {
          if (next !== null) onCommit(next);
        }}
      />
    </div>
  );
}
