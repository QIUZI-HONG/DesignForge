'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * Swatch —— 色板色块（RW-07 色板最小集；色板阵列与 ColorField 预览共用）。
 *
 * 口径：色块的**填充色是调用方给的业务色值**（内联样式承载数据，不属于设计令牌
 * 管辖——设计令牌管的是色块的边框/圆角/尺寸）；缺省（无色）用斜纹形态表达，
 * 不拿任何色值占位。可点选（`onClick`）时渲染为按钮：`aria-label` 表达名称、
 * `aria-pressed` 表达「当前选中项」；纯展示时为装饰性 span（名称由调用方在别处给）。
 */
import type { CSSProperties, ReactNode } from 'react';

import { cx } from '../utils/class-names';

/** Swatch props。 */
export interface SwatchProps {
  /** 展示色（调用方给的业务色值，如 hex）；缺省 = 无色（斜纹）。 */
  color?: string | null;
  size?: 'sm' | 'md';
  /** 当前选中（色板阵列里的当前项；可点选时经 aria-pressed 表达）。 */
  selected?: boolean;
  disabled?: boolean;
  /** 可访问名（可点选时必给；纯展示时忽略）。 */
  label?: string;
  /** 给出则可点选（色板阵列）；不给则为纯展示块。 */
  onClick?: () => void;
  className?: string;
}

/** 色板色块。 */
export function Swatch({
  color,
  size = 'md',
  selected = false,
  disabled = false,
  label,
  onClick,
  className,
}: SwatchProps): ReactNode {
  const hasColor = typeof color === 'string' && color !== '';
  // 业务色值经内联样式承载数据（R1 管的是样式取值，不是展示数据）
  const fillStyle: CSSProperties | undefined = hasColor ? { backgroundColor: color } : undefined;
  const fill = (
    <span
      className={cx('dfg-swatch__fill', !hasColor && 'dfg-swatch__fill--empty')}
      style={fillStyle}
    />
  );
  const modifiers = cx(
    'dfg-swatch',
    size !== 'md' && `dfg-swatch--${size}`,
    selected && 'dfg-swatch--selected',
    className,
  );
  if (onClick === undefined) {
    return (
      <span className={modifiers} aria-hidden="true">
        {fill}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={modifiers}
      aria-label={label}
      aria-pressed={selected ? 'true' : 'false'}
      disabled={disabled}
      onClick={onClick}
    >
      {fill}
    </button>
  );
}
