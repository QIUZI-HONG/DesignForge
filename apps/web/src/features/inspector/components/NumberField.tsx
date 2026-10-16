'use client';

/**
 * NumberField —— Inspector 数值输入（C5 四交互：拖拽 scrub / 上下键步进 / Enter 提交 / Esc 取消）。
 *
 * 提交语义（配合 `useDraftCommit`）：输入与拖拽期间只改本地草稿，
 * 静默 300ms（或 Enter/blur/松手）才发一条命令——撤销粒度 = 一次修改。
 *
 * 混选（C6）：`value` 为 undefined 时显示「—」；拖拽以 `baseValue`（主选中值）为基准，
 * 提交值作用于全选。
 *
 * 禁裸值：几何与颜色一律走 `@dforge/ui` 令牌（`inspector.css` 引用 var(--dfg-*)）。
 */

import { type ChangeEvent, type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';

import { t } from '@/i18n';
import { UNAVAILABLE_PLACEHOLDER } from '@/lib/unavailable';

import { useDraftCommit } from '../model/draft';

/** 混选占位（C6：混合值显示「—」）。 */
/** 混合值占位（值来自单点 `@/lib/unavailable`，复核 J5）。 */
export const MIXED_PLACEHOLDER = UNAVAILABLE_PLACEHOLDER;

/** 数值格式化：按精度四舍五入并去掉尾随零（10 → "10"，1.50 → "1.5"）。 */
export function formatFieldNumber(value: number, precision = 2): string {
  const rounded = roundTo(value, precision);
  return String(rounded);
}

/** 四舍五入到指定小数位。 */
export function roundTo(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

/** 数值输入 props。 */
export interface NumberFieldProps {
  /** 显示名（如 X / Y / W / H，i18n 文本）。 */
  label: string;
  /** 取样名（data-df-inspector-field，门禁挂点）。 */
  fieldName: string;
  /** 外部真值；undefined = 混选（显示「—」）。 */
  value: number | undefined;
  /** 混选时的拖拽/步进起始基准（主选中节点的值）。 */
  baseValue?: number | undefined;
  /** 步进量（默认 1；Shift 为 10 倍）。 */
  step?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
  /** 显示与提交的小数位（默认 2）。 */
  precision?: number | undefined;
  /** 单位后缀（如 %），显示在输入框右侧。 */
  suffix?: string | undefined;
  disabled?: boolean;
  /** 提交回调（提交时刻才调用；值已夹取与取整）。 */
  onCommit(value: number): void;
}

/** 拖拽会话。 */
interface ScrubSession {
  active: boolean;
  startX: number;
  startValue: number;
}

/** 数值输入控件。 */
export function NumberField({
  label,
  fieldName,
  value,
  baseValue,
  step = 1,
  min,
  max,
  precision = 2,
  suffix,
  disabled = false,
  onCommit,
}: NumberFieldProps) {
  const scrubRef = useRef<ScrubSession>({ active: false, startX: 0, startValue: 0 });
  // 行内提示（G3）：拒绝/限制都要说一声——「已恢复原值」/「已限制为 N」；
  // 下一次编辑即清除（不长期驻留，也不挡住数字）。
  const [notice, setNotice] = useState<string | null>(null);
  const externalText =
    value === undefined ? MIXED_PLACEHOLDER : formatFieldNumber(value, precision);

  const clampValue = (candidate: number): number => {
    let next = candidate;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    return roundTo(next, precision);
  };

  const { draft, setDraft, setDraftLive, flush, cancel } = useDraftCommit<string>({
    value: externalText,
    // 提交时刻：解析 → 夹取 → 无变化则静默回滚（不产生空命令）
    commit: (text) => {
      const trimmed = text.trim();
      const parsed = Number(trimmed);
      if (trimmed === '' || !Number.isFinite(parsed)) {
        setNotice(t('inspector.number.reverted'));
        return;
      }
      const next = clampValue(parsed);
      // 负值口径：坐标（X/Y 无 min）允许负值（画布原点可负，Figma 同口径）；
      // 尺寸类（min 0）越界即夹取，并明确告知夹取结果，不静默改值。
      const outOfRange = (min !== undefined && parsed < min) || (max !== undefined && parsed > max);
      setNotice(
        outOfRange
          ? t('inspector.number.clamped', { value: formatFieldNumber(next, precision) })
          : null,
      );
      if (value !== undefined && next === value) return;
      onCommit(next);
    },
  });

  const display = draft ?? externalText;

  /** 当前数值基准：草稿 > 外部值 > 混选基准 > 0。 */
  const currentNumber = (): number => {
    if (draft !== null) {
      const parsed = Number(draft.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
    return value ?? baseValue ?? 0;
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setNotice(null); // 用户重新编辑：旧提示立即退场
    setDraft(event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      flush();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const direction = event.key === 'ArrowUp' ? 1 : -1;
      const magnitude = step * (event.shiftKey ? 10 : 1);
      setDraft(formatFieldNumber(clampValue(currentNumber() + direction * magnitude), precision));
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLElement>): void => {
    if (disabled) return;
    event.preventDefault();
    scrubRef.current = { active: true, startX: event.clientX, startValue: currentNumber() };
    // jsdom 无指针捕获（可选调用）；真实浏览器里保证拖出元素仍收到 move/up
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>): void => {
    const session = scrubRef.current;
    if (!session.active || disabled) return;
    const dx = event.clientX - session.startX;
    const scale = event.shiftKey ? 10 : 1;
    // 拖拽期间只改草稿（不安排自动提交）：连续位移最终由松手时的 flush 收口
    setDraftLive(formatFieldNumber(clampValue(session.startValue + dx * step * scale), precision));
  };

  const handlePointerUp = (): void => {
    if (!scrubRef.current.active) return;
    scrubRef.current.active = false;
    flush();
  };

  return (
    // 外层单元（cell）：门禁/测试的字段挂点 + 状态都在这一个元素上（单点），
    // 内层仍是原来的控件盒子（几何不变，见 inspector.css 的 .dfi-numberfield-cell）
    <div
      className="dfi-numberfield-cell"
      data-df-inspector-field={fieldName}
      data-df-state={disabled ? 'disabled' : value === undefined ? 'mixed' : 'default'}
    >
      <div className="dfi-numberfield">
        {/* 标签双击即拖拽改值（Figma 惯例）；键盘用户走输入框的上下键 */}
        {/* 标签即拖拽把手：Figma 惯例；键盘步进由输入框的上下键承担（把手不进 Tab 序列） */}
        <button
          type="button"
          className="dfi-numberfield__label"
          data-testid={`numberfield-scrub-${fieldName}`}
          data-df-scrub=""
          tabIndex={-1}
          aria-disabled={disabled}
          data-df-state={disabled ? 'disabled' : 'default'}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            scrubRef.current.active = false;
          }}
          onDoubleClick={(event) => event.preventDefault()}
        >
          {label}
        </button>
        <input
          className="dfi-numberfield__input"
          type="text"
          inputMode="decimal"
          aria-label={label}
          value={display}
          disabled={disabled}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => flush()}
        />
        {suffix === undefined ? null : <span className="dfi-numberfield__suffix">{suffix}</span>}
      </div>
      {notice === null ? null : (
        <p className="dfi-hint dfi-numberfield__notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
