'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * SegmentedControl —— 分段切换（视图切换、模式切换）。
 *
 * 语义用**原生单选**（`input[type=radio]` + `label` 包裹，容器 `role="radiogroup"`）：
 * 分段控件是「单选一个取值」而不是「页签切换面板」，用 tab 语义会误导读屏用户；
 * 用原生控件还能免费拿到 checked/disabled 语义与读屏支持（视觉隐藏输入、样式落在 label 上）。
 * 键盘：方向键漫游（跳过禁用项）、Home/End 到两端——jsdom 不实现原生方向键漫游，
 * 因此这里显式实现，保证测试与真实浏览器行为一致。
 */
import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';

import { cx } from '../utils/class-names';
import { Tooltip } from './Tooltip';

/** 分段项。 */
export interface SegmentedOption {
  value: string;
  /** 项文案/图标（由调用方给）。 */
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** 禁用原因（给出后该项悬停出提示）。 */
  disabledReason?: string;
}

/** SegmentedControl props。 */
export interface SegmentedControlProps {
  /** 组的可访问名（如「视图」）。 */
  label: string;
  options: SegmentedOption[];
  /** 当前值（受控）。 */
  value: string;
  onChange: (value: string) => void;
  /** 原生单选的组名（不传则自动生成）。 */
  name?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** 分段切换控件。 */
export function SegmentedControl({
  label,
  options,
  value,
  onChange,
  name,
  size = 'md',
  className,
}: SegmentedControlProps) {
  const autoName = useId();
  const groupName = name ?? `dfg-segmented-${autoName}`;
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const select = (index: number): void => {
    const option = options[index];
    if (option === undefined || option.disabled === true) return;
    onChange(option.value);
    inputRefs.current[index]?.focus();
  };

  const step = (from: number, direction: 1 | -1): void => {
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index = (from + direction * offset + options.length) % options.length;
      if (options[index]?.disabled !== true) {
        select(index);
        return;
      }
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = options.findIndex((option) => option.value === value);
    if (current < 0) return;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        step(current, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        step(current, -1);
        break;
      case 'Home':
        event.preventDefault();
        select(options.findIndex((option) => option.disabled !== true));
        break;
      case 'End': {
        event.preventDefault();
        let last = options.length - 1;
        while (last >= 0 && options[last]?.disabled === true) last -= 1;
        select(last);
        break;
      }
      default:
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('dfg-segmented', size === 'sm' && 'dfg-segmented--sm', className)}
      onKeyDown={handleKeyDown}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        const item = (
          <label
            key={option.value}
            className="dfg-segmented__item"
            data-selected={selected ? 'true' : 'false'}
            data-disabled={option.disabled === true ? 'true' : 'false'}
          >
            <input
              ref={(node) => {
                inputRefs.current[index] = node;
              }}
              type="radio"
              className="dfg-visually-hidden"
              name={groupName}
              value={option.value}
              checked={selected}
              disabled={option.disabled === true}
              onChange={() => {
                if (!selected) onChange(option.value);
              }}
            />
            {option.icon}
            {option.label}
          </label>
        );
        if (option.disabledReason === undefined) return item;
        return (
          <Tooltip key={option.value} content={option.disabledReason}>
            {item}
          </Tooltip>
        );
      })}
    </div>
  );
}
