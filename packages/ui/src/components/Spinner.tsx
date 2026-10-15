'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * Spinner —— 加载转圈（F13 加载态族的最小件）。
 *
 * 颜色取 `currentColor`，因此按钮主色态下自动变白、面板内自动变灰（无需变体）。
 * a11y：给 `label` 时是可读的 `role="status"` 实时区；不给则纯装饰（按钮内已有文本）。
 */
import { cx } from '../utils/class-names';

/** 转圈尺寸档。 */
export type SpinnerSize = 'sm' | 'md' | 'lg';

/** Spinner props。 */
export interface SpinnerProps {
  /** 尺寸档；默认 md（16px，与 `--dfg-icon-size-md` 对齐）。 */
  size?: SpinnerSize;
  /** 无障碍名称；给出后成为 `role="status"`。 */
  label?: string;
  className?: string;
}

/** 加载转圈。 */
export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  const classes = cx('dfg-spinner', size !== 'md' && `dfg-spinner--${size}`, className);
  // 两个分支刻意分开：装饰性与具名状态区在无障碍树上形状不同（静态可读、便于门禁断言）
  if (label === undefined) {
    return <span className={classes} aria-hidden="true" />;
  }
  return <span className={classes} role="status" aria-label={label} />;
}
