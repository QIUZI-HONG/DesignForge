'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * Scrubber —— 横向拖拽改值抓手（RW-07；Inspector 标签等场景复用）。
 *
 * 口径（总纲 R-4「数值 scrubbing」：Figma 有，实现质量目标 = 超越其发现性）：
 * 抓手是数值的**增量输入器**——鼠标按住横向拖动逐段上报增量，键盘方向键是等价路径
 * （可达性不只鼠标）；数值本体与展示由调用方承载（如旁边的 NumberField）。
 * 抓手渲染为按钮（原生焦点 + 具名 `aria-label`，名称由调用方给）。
 */
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

import { cx } from '../utils/class-names';
import { useHorizontalScrub } from '../utils/use-scrub';

/** Scrubber props。 */
export interface ScrubberProps {
  /** 可访问名（如「宽度」）。 */
  label: string;
  /** 抓手承载内容（通常是字段名文本，由调用方给）。 */
  children?: ReactNode;
  /** 键盘每击增量（默认 1）。 */
  step?: number;
  /** 每像素位移的值增量系数（默认 1；0.1 表示拖 10 像素改 1）。 */
  sensitivity?: number;
  disabled?: boolean;
  /** 增量上报（调用方负责钳制与取整；拖拽与键盘共用一条路径）。 */
  onDelta: (delta: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  className?: string;
}

/** 拖拽改值抓手。 */
export function Scrubber({
  label,
  children,
  step = 1,
  sensitivity = 1,
  disabled = false,
  onDelta,
  onScrubStart,
  onScrubEnd,
  className,
}: ScrubberProps) {
  const scrub = useHorizontalScrub({
    disabled,
    threshold: 0,
    onStart: onScrubStart,
    onMove: (delta) => {
      onDelta(delta * sensitivity);
    },
    onEnd: onScrubEnd,
  });

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    let direction: 1 | -1 | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') direction = 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') direction = -1;
    if (direction === null) return;
    event.preventDefault();
    onDelta(direction * step);
  };

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={cx('dfg-scrubber', scrub.dragging && 'dfg-scrubber--dragging', className)}
      onMouseDown={scrub.onMouseDown}
      onKeyDown={handleKeyDown}
    >
      {children}
    </button>
  );
}
