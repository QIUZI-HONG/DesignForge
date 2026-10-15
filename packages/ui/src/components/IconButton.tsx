/**
 * IconButton —— 纯图标按钮（工具条/面板头/关闭键）。
 *
 * `label` 必填：纯图标按钮没有可见文本，必须有可访问名（a11y 硬约束，TS 层强制）。
 * `pressed` 用于开关类按钮（网格开关、面板开合）——经 `aria-pressed` 表达，
 * 视觉上走选中共色 `--dfg-color-selection`。
 */
import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';

import { cx } from '../utils/class-names';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';

/** 图标按钮变体。 */
export type IconButtonVariant = 'ghost' | 'secondary' | 'primary' | 'danger';

/** 图标按钮尺寸（方形边长随主题密度：舒适档 md=32）。 */
export type IconButtonSize = 'sm' | 'md';

/** IconButton props。 */
export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> {
  /** 可访问名（必填；文案由调用方给）。 */
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** 开关态（`aria-pressed`）。 */
  pressed?: boolean;
  /** 加载中：转圈 + 禁点。 */
  loading?: boolean;
  /** 禁用原因（F15：灰化 + tooltip 原因）。 */
  disabledReason?: string;
  className?: string;
}

/** 图标按钮。 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon,
    variant = 'ghost',
    size = 'md',
    pressed,
    loading = false,
    disabledReason,
    className,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled === true || loading;
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      aria-busy={loading ? true : undefined}
      className={cx(
        'dfg-iconbtn',
        variant !== 'ghost' && `dfg-iconbtn--${variant}`,
        size !== 'md' && `dfg-iconbtn--${size}`,
        loading && 'dfg-btn--loading',
        className,
      )}
      disabled={isDisabled}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : icon}
    </button>
  );
  if (disabledReason === undefined) return button;
  return <Tooltip content={disabledReason}>{button}</Tooltip>;
});
