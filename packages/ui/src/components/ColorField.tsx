'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * ColorField —— 颜色输入（色块预览 + hex 文本；RW-07 色板最小集，Inspector 消费）。
 *
 * 口径：外形沿用 Input 包裹层；色块预览复用 Swatch（无色/非法时斜纹）；
 * hex 是编辑器色值的交换格式——提交时归一为小写规范形；允许清空
 * （`allowEmpty`，空值上报 `null` = 无填充）由调用方开关。
 * 非法输入保留原文标错（`aria-invalid` + `role="alert"`）且不上报。
 */
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useId, useState } from 'react';

import { cx } from '../utils/class-names';
import { Swatch } from './Swatch';

/** hex 色值（3/4/6/8 位；提交时归一小写）。 */
const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/;

/** ColorField props。 */
export interface ColorFieldProps {
  /** 字段名（给出后渲染 label 并与控件关联，如「填充」）。 */
  fieldLabel?: ReactNode;
  /** 当前色（受控；hex 字符串；`null` = 无色）。 */
  value?: string | null;
  /** 初值（非受控）。 */
  defaultValue?: string | null;
  onChange?: (value: string | null) => void;
  /** 允许清空为无色（空串提交 → `null`；默认关——清空即标错）。 */
  allowEmpty?: boolean;
  disabled?: boolean;
  /** 外部校验错误（与解析失败共用错误样式）。 */
  invalid?: boolean;
  /** 校验错误文案（给出即错误态，读屏播报；文案由调用方给）。 */
  errorMessage?: ReactNode;
  /** 正常态辅助说明。 */
  hint?: ReactNode;
  id?: string;
  className?: string;
}

/** 解析输入文本：`undefined` = 非法；`null` = 无色。 */
function parseColor(raw: string, allowEmpty: boolean): string | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return allowEmpty ? null : undefined;
  return HEX_PATTERN.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

/** 颜色输入控件。 */
export function ColorField({
  fieldLabel,
  value,
  defaultValue = null,
  onChange,
  allowEmpty = false,
  disabled = false,
  invalid = false,
  errorMessage,
  hint,
  id,
  className,
}: ColorFieldProps) {
  const autoId = useId();
  const inputId = id ?? `dfg-colorfield-${autoId}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  const controlled = value !== undefined;
  const [innerValue, setInnerValue] = useState<string | null>(defaultValue);
  const committed = controlled ? (value as string | null) : innerValue;
  const [draft, setDraft] = useState<string | null>(null); // 编辑中草稿；null = 非编辑态
  const [parseInvalid, setParseInvalid] = useState(false);

  const isInvalid = invalid || parseInvalid;
  const describedBy =
    errorMessage !== undefined ? errorId : hint !== undefined ? hintId : undefined;
  const display = draft ?? committed ?? '';

  const emit = (next: string | null): void => {
    if (!controlled) setInnerValue(next);
    onChange?.(next);
  };

  const commit = (): void => {
    if (draft === null) return;
    const parsed = parseColor(draft, allowEmpty);
    if (parsed === undefined) {
      // 非法输入：保留原文让用户看到错在哪，标错且不上报
      setParseInvalid(true);
      return;
    }
    setDraft(null);
    setParseInvalid(false);
    if (parsed !== committed) emit(parsed);
  };

  // 预览跟随编辑：草稿是合法色就即时预览，否则回显当前值（无色/非法 → 斜纹）
  const previewColor =
    draft !== null && parseColor(draft, allowEmpty) !== undefined ? draft : committed;

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  };

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
          'dfg-colorfield',
          isInvalid && 'dfg-colorfield--invalid',
          disabled && 'dfg-input-wrap--disabled',
        )}
      >
        <Swatch color={previewColor} className="dfg-colorfield__swatch" />
        <input
          id={inputId}
          type="text"
          className="dfg-input"
          spellCheck={false}
          value={display}
          aria-invalid={isInvalid ? 'true' : 'false'}
          aria-describedby={describedBy}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          onBlur={commit}
        />
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
