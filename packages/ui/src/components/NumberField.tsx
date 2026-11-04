'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * NumberField —— 数值编辑 deep module（arch-02：把 Inspector 的活件提为 DS 单一实现）。
 *
 * interface（调用方只学这一套）：
 * - `value` / `onCommit`：外部真值与提交时刻（一次调用 = 一条命令）；
 * - `min` / `max` / `step` / `precision`：范围、键盘步进与显示/提交取整；
 * - 可选 scrub：`onScrubStart` / `onScrubEnd` 括约一段拖拽会话（拖拽中零写入、松手单次提交）；
 * - `label` / `fieldName`：可访问名与门禁挂点；
 * - `mixedPlaceholder` / `messages`：调用方文案（本包不含业务文案；混选占位与提示均经 i18n 注入）。
 *
 * implementation（隐藏在本 module 内）：
 * - 草稿态 + 300ms trailing debounce——连续输入/连续拖拽只落**一次**提交（撤销粒度 = 一次修改）；
 * - Enter/blur/松手 flush；Esc 丢弃草稿（取消不得变成提交）；↑/↓（Shift ×10）键盘步进；
 * - 夹取/取整、非法输入回滚与行内提示（文案由调用方注入）。
 *
 * 视觉：本 module 由 Inspector 活件提升而来，票面冻结外观——造型规则随包分发在
 * `packages/ui/src/components.css` 的 NumberField 段（arch-fix2 发现 A：不再依赖
 * `apps/web/.../inspector.css`）；类名沿用 `dfi-*` 以逐字保持既有外观与 app 侧布局选择器。
 */

import { type ChangeEvent, type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';

import { useDraftCommit } from '../utils/use-draft-commit';

/** 数值格式化：按精度四舍五入并去掉尾随零（10 → "10"，1.50 → "1.5"）。 */
export function formatFieldNumber(value: number, precision = 2): string {
  return String(roundTo(value, precision));
}

/** 四舍五入到指定小数位。 */
function roundTo(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

/** 数值编辑器的界面文案（由调用方经 i18n 目录提供；本包不含业务文案）。 */
export interface NumberFieldMessages {
  /** 空/非法输入被拒绝后的回滚提示。 */
  reverted: string;
  /** 越界被夹取后的提示；参数为夹取后的显示值。 */
  clamped(value: string): string;
}

/** 数值输入 props（interface 只暴露调用方需要知道的语义）。 */
export interface NumberFieldProps {
  /** 显示名（如 X / Y / W / H，i18n 文本；同时作为输入框的可访问名）。 */
  label: string;
  /** 取样名（data-df-inspector-field，门禁挂点）。 */
  fieldName: string;
  /** 外部真值；undefined = 混选（显示调用方给的占位）。 */
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
  /** 混选占位（生产从 `@/lib/unavailable` 单点传入）。 */
  mixedPlaceholder: string;
  /** 行内提示文案（调用方 i18n）。 */
  messages: NumberFieldMessages;
  disabled?: boolean;
  /** 是否开启拖拽改值（默认开；关闭后标签不再是拖拽把手，键入路径不受影响）。 */
  scrubbing?: boolean | undefined;
  /** 提交回调（提交时刻才调用；值已夹取与取整）。 */
  onCommit(value: number): void;
  /**
   * 拖拽会话开启（pointerdown 即开，与引擎 interaction 会话的 begin 同语义；
   * RW-10：调用方用它括约「拖拽中不写文档、松手单事务提交」）。
   */
  onScrubStart?: (() => void) | undefined;
  /** 拖拽会话收口（在唯一一次提交之后 / 值未变化即松手时；与 commit/end 成对）。 */
  onScrubEnd?: (() => void) | undefined;
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
  mixedPlaceholder,
  messages,
  disabled = false,
  scrubbing = true,
  onCommit,
  onScrubStart,
  onScrubEnd,
}: NumberFieldProps) {
  const scrubRef = useRef<ScrubSession>({ active: false, startX: 0, startValue: 0 });
  // 行内提示（G3）：拒绝/限制都要说一声——「已恢复原值」/「已限制为 N」；
  // 下一次编辑即清除（不长期驻留，也不挡住数字）。
  const [notice, setNotice] = useState<string | null>(null);
  const externalText = value === undefined ? mixedPlaceholder : formatFieldNumber(value, precision);

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
        setNotice(messages.reverted);
        return;
      }
      const next = clampValue(parsed);
      // 负值口径：坐标（X/Y 无 min）允许负值（画布原点可负，Figma 同口径）；
      // 尺寸类（min 0）越界即夹取，并明确告知夹取结果，不静默改值。
      const outOfRange = (min !== undefined && parsed < min) || (max !== undefined && parsed > max);
      setNotice(outOfRange ? messages.clamped(formatFieldNumber(next, precision)) : null);
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
    if (disabled || !scrubbing) return;
    event.preventDefault();
    scrubRef.current = { active: true, startX: event.clientX, startValue: currentNumber() };
    // 会话开启先于任何提交（RW-10：拖拽中不写文档的括约起点）
    onScrubStart?.();
    // jsdom 无指针捕获（可选调用）；真实浏览器里保证拖出元素仍收到 move/up
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>): void => {
    const session = scrubRef.current;
    if (!session.active || disabled || !scrubbing) return;
    const dx = event.clientX - session.startX;
    const scale = event.shiftKey ? 10 : 1;
    // 拖拽期间只改草稿（不安排自动提交）：连续位移最终由松手时的 flush 收口
    setDraftLive(formatFieldNumber(clampValue(session.startValue + dx * step * scale), precision));
  };

  const handlePointerUp = (): void => {
    if (!scrubRef.current.active) return;
    scrubRef.current.active = false;
    flush();
    // 会话收口在唯一一次提交之后（值未变化即松手时也收口，括约必成对）
    onScrubEnd?.();
  };

  return (
    // 外层单元（cell）：门禁/测试的字段挂点 + 状态都在这一个元素上（单点），
    // 内层仍是原来的控件盒子（几何不变，见 components.css 的 .dfi-numberfield-cell）
    <div
      className="dfi-numberfield-cell"
      data-df-inspector-field={fieldName}
      data-df-state={disabled ? 'disabled' : value === undefined ? 'mixed' : 'default'}
    >
      <div className="dfi-numberfield">
        {/* 标签即拖拽把手：按下即起拖（Figma 惯例；onDoubleClick 仅抑制双击选中文本的默认行为）；
            键盘步进由输入框的上下键承担（把手不进 Tab 序列） */}
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
            onScrubEnd?.(); // 异常终止也收口（零提交，括约仍成对）
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
        <p className="dfi-numberfield__notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
