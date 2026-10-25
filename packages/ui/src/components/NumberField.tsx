'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * NumberField —— 数值输入（步进 + scrubbing；RW-07，Inspector 重写票消费）。
 *
 * 口径（总纲 R-4 / 验收标准 §2）：外形沿用 Input 的包裹层（`dfg-input-wrap`，
 * 焦点环落在外层 `:focus-within`，语义档口径见 components.css）；单位后缀灰显在
 * 输入框内、不进值文本（解析时容忍用户随值键入单位）。
 *
 * 交互：
 * - **步进**：↑/↓（焦点在输入框时）与右侧上下小步进钮共用 `stepBy`——按 `step`
 *   增减、按 `min/max` 钳制、按 `precision` 取整（小数步进不积浮点尾差）；
 *   步进钮是纯视觉 affordance（`aria-hidden`），键盘等价路径就是输入框方向键；
 * - **scrubbing**（默认开）：在输入框上按住横向拖动改值——位移越过小阈值才算拖
 *   （区分「点击进入编辑」），起点为当前值、增量按 `scrubSensitivity` 折算；
 *   `onScrubStart/onScrubEnd` 供调用方挂撤销一步回退（RW-10 口径）；
 * - **键入提交**：Enter/失焦提交；空串上报 `null`（清空）；解析失败保留原文、
 *   标错（`aria-invalid` + `role="alert"` 文案）且不上报；键入值不钳制（交给
 *   调用方校验，与步进/拖拽的钳制口径分开）；
 * - **加载**：只读 + 行内转圈（引擎同步中的表达，RW-10）。
 */
import {
  forwardRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react';

import { ChevronDownIcon, ChevronUpIcon } from '../icons/index';
import { PRIMITIVES } from '../tokens';
import { cx } from '../utils/class-names';
import { useHorizontalScrub } from '../utils/use-scrub';
import { Spinner } from './Spinner';

/** 默认小数位（步进/拖拽取整，避免浮点尾差）。 */
const DEFAULT_PRECISION = 2;

/** 拖拽激活阈值（位移超过才算 scrubbing，与「点击进入编辑」区分）。 */
const SCRUB_THRESHOLD = 2;

/** NumberField props。 */
export interface NumberFieldProps {
  /** 字段名（给出后渲染 label 并与控件关联，如「宽度」）。 */
  fieldLabel?: ReactNode;
  /** 当前值（受控；`null` = 无值）。 */
  value?: number | null;
  /** 初值（非受控）。 */
  defaultValue?: number | null;
  onChange?: (value: number | null) => void;
  /** 步进增量（方向键与步进钮共用；默认 1）。 */
  step?: number;
  min?: number;
  max?: number;
  /** 步进/拖拽结果的小数位（默认 2；仅作用于生成的值，不重排键入文本）。 */
  precision?: number;
  /** 单位后缀（灰显，如 px；解析时容忍随值键入）。 */
  unit?: string;
  disabled?: boolean;
  /** 加载中：只读 + 转圈（引擎同步中）。 */
  loading?: boolean;
  /** 外部校验错误（与解析失败共用错误样式）。 */
  invalid?: boolean;
  /** 校验错误文案（给出即错误态，读屏播报；文案由调用方给）。 */
  errorMessage?: ReactNode;
  /** 正常态辅助说明。 */
  hint?: ReactNode;
  /** 是否开启拖拽改值（默认开）。 */
  scrubbing?: boolean;
  /** 每像素位移的值增量系数（默认 1；0.1 表示拖 10 像素改 1）。 */
  scrubSensitivity?: number;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  size?: 'sm' | 'md';
  id?: string;
  className?: string;
  /** 交互层类名（状态强制类与截图门禁取样用，同 Input.wrapClassName）。 */
  wrapClassName?: string;
}

/** 按小数位取整（消浮点尾差）。 */
function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

/** 区间钳制。 */
function clampTo(value: number, min: number | undefined, max: number | undefined): number {
  if (min !== undefined && value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}

/** 解析输入文本：`undefined` = 非法；`null` = 空（无值）。 */
function parseValue(raw: string, unit: string | undefined): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  let body = trimmed;
  if (unit !== undefined && body.toLowerCase().endsWith(unit.toLowerCase())) {
    body = body.slice(0, -unit.length);
  }
  const parsed = Number(body.trim());
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** 数值输入控件。 */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  {
    fieldLabel,
    value,
    defaultValue = null,
    onChange,
    step = 1,
    min,
    max,
    precision = DEFAULT_PRECISION,
    unit,
    disabled = false,
    loading = false,
    invalid = false,
    errorMessage,
    hint,
    scrubbing = true,
    scrubSensitivity = 1,
    onScrubStart,
    onScrubEnd,
    size = 'md',
    id,
    className,
    wrapClassName,
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? `dfg-numfield-${autoId}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  const controlled = value !== undefined;
  const [innerValue, setInnerValue] = useState<number | null>(defaultValue);
  const committed = controlled ? (value as number | null) : innerValue;
  const [draft, setDraft] = useState<string | null>(null); // 编辑中草稿；null = 非编辑态
  const [parseInvalid, setParseInvalid] = useState(false);
  const scrubBase = useRef(0);

  const isDisabled = disabled || loading;
  const isInvalid = invalid || parseInvalid;
  const describedBy =
    errorMessage !== undefined ? errorId : hint !== undefined ? hintId : undefined;

  const emit = (next: number | null): void => {
    if (!controlled) setInnerValue(next);
    onChange?.(next);
  };

  const scrub = useHorizontalScrub({
    disabled: isDisabled || !scrubbing,
    threshold: SCRUB_THRESHOLD,
    onStart: () => {
      scrubBase.current = committed ?? 0;
      setDraft(null);
      setParseInvalid(false);
      onScrubStart?.();
    },
    onMove: (_delta, total) => {
      emit(clampTo(roundTo(scrubBase.current + total * scrubSensitivity, precision), min, max));
    },
    onEnd: onScrubEnd,
  });

  const commit = (): void => {
    if (draft === null) return;
    const parsed = parseValue(draft, unit);
    if (parsed === undefined) {
      // 非法输入：保留原文让用户看到错在哪，标错且不上报
      setParseInvalid(true);
      return;
    }
    setDraft(null);
    setParseInvalid(false);
    if (parsed !== committed) emit(parsed);
  };

  const stepBy = (direction: 1 | -1): void => {
    if (isDisabled) return;
    const base = committed ?? (min !== undefined ? min : 0);
    const next = clampTo(roundTo(base + direction * step, precision), min, max);
    setDraft(null);
    setParseInvalid(false);
    if (next !== committed) emit(next);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      stepBy(1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      stepBy(-1);
    } else if (event.key === 'Enter') {
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
          'dfg-numfield',
          size === 'sm' && 'dfg-input-wrap--sm',
          isInvalid && 'dfg-numfield--invalid',
          isDisabled && 'dfg-input-wrap--disabled',
          scrub.dragging && 'dfg-numfield--scrubbing',
          wrapClassName,
        )}
      >
        <input
          ref={ref}
          id={inputId}
          type="text"
          inputMode="decimal"
          role="spinbutton"
          className="dfg-input dfg-numfield__input"
          value={draft ?? (committed === null ? '' : String(committed))}
          aria-valuenow={committed === null ? undefined : committed}
          aria-valuetext={
            unit !== undefined && committed !== null ? `${committed}${unit}` : undefined
          }
          aria-valuemin={min}
          aria-valuemax={max}
          aria-invalid={isInvalid ? 'true' : 'false'}
          aria-describedby={describedBy}
          disabled={disabled}
          readOnly={loading || undefined}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          onMouseDown={(event: ReactMouseEvent<HTMLInputElement>) => {
            // 点击＝进入编辑；拖动＝改值（阈值判定在钩子里）
            scrub.onMouseDown(event);
          }}
        />
        {unit === undefined ? null : <span className="dfg-numfield__unit">{unit}</span>}
        {loading ? (
          <span className="dfg-numfield__status">
            <Spinner size="sm" />
          </span>
        ) : (
          <span className="dfg-numfield__steppers">
            <button
              type="button"
              className="dfg-numfield__step"
              tabIndex={-1}
              aria-hidden="true"
              disabled={isDisabled}
              onClick={() => {
                stepBy(1);
              }}
            >
              <ChevronUpIcon size={PRIMITIVES.iconSize.sm} />
            </button>
            <button
              type="button"
              className="dfg-numfield__step"
              tabIndex={-1}
              aria-hidden="true"
              disabled={isDisabled}
              onClick={() => {
                stepBy(-1);
              }}
            >
              <ChevronDownIcon size={PRIMITIVES.iconSize.sm} />
            </button>
          </span>
        )}
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
