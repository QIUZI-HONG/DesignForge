'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * Collapse —— 折叠面板（RW-07；Inspector 分区与设置页消费）。
 *
 * 口径：单节折叠（多节手风琴由调用方堆叠）——触发器是按钮（`aria-expanded` +
 * `aria-controls`），内容区 `hidden` 切换显示、**DOM 保留不卸载**（内部输入状态
 * 不丢，Inspector 调值中途折叠再展开不回跳）。标题文案由调用方给；
 * 开合支持受控（`open`/`onToggle`）与非受控（`defaultOpen`）。
 */
import { type ReactNode, useId, useState } from 'react';

import { ChevronDownIcon, ChevronRightIcon } from '../icons/index';
import { cx } from '../utils/class-names';

/** Collapse props。 */
export interface CollapseProps {
  /** 折叠头标题（同时是触发器的可访问名；文案由调用方给）。 */
  title: ReactNode;
  /** 初值（非受控）。 */
  defaultOpen?: boolean;
  /** 当前展开态（受控）。 */
  open?: boolean;
  /** 开合回调（受控/非受控都上报目标态）。 */
  onToggle?: (open: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
}

/** 折叠面板。 */
export function Collapse({
  title,
  defaultOpen = false,
  open,
  onToggle,
  disabled = false,
  children,
  className,
}: CollapseProps) {
  const contentId = useId();
  const controlled = open !== undefined;
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const expanded = controlled ? (open as boolean) : innerOpen;

  const toggle = (): void => {
    if (disabled) return;
    const next = !expanded;
    if (!controlled) setInnerOpen(next);
    onToggle?.(next);
  };

  return (
    <div className={cx('dfg-collapse', className)}>
      <button
        type="button"
        className="dfg-collapse__trigger"
        aria-expanded={expanded}
        aria-controls={contentId}
        disabled={disabled || undefined}
        onClick={toggle}
      >
        {/* 开合指示用两枚图标直陈状态（不用 transform 旋转，行为可断言） */}
        {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <span className="dfg-collapse__title">{title}</span>
      </button>
      <div id={contentId} className="dfg-collapse__content" hidden={expanded ? undefined : true}>
        {children}
      </div>
    </div>
  );
}
