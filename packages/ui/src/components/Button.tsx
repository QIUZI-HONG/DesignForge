/**
 * Button —— 主/次/幽灵/危险 × sm/md/lg，含加载与禁用（F13/F15）。
 *
 * 文案与业务语义一律由调用方给（children / loadingLabel / disabledReason），
 * 本组件不含任何界面文案；禁用原因经 Tooltip 说明（F15：灰化 + tooltip 原因）。
 */
import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';

import { cx } from '../utils/class-names';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';

/** 按钮变体。 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** 按钮尺寸（高度随主题密度：舒适档 md=32，紧凑档 md=28）。 */
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Button props。 */
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 加载中：转圈 + `aria-busy`，同时禁点（防重复提交）。 */
  loading?: boolean;
  /** 加载中的无障碍名（替换可访问名，如「正在导出」）；不给则沿用可见文本。 */
  loadingLabel?: string;
  /** 占满容器宽。 */
  fullWidth?: boolean;
  /** 前置图标（16px 线性图标）。 */
  icon?: ReactNode;
  /** 禁用原因；给出时禁用态包 Tooltip 说明原因。 */
  disabledReason?: string;
  className?: string;
}

/** 按钮。 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    loadingLabel,
    fullWidth = false,
    icon,
    disabledReason,
    className,
    disabled,
    children,
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
      className={cx(
        'dfg-btn',
        `dfg-btn--${variant}`,
        size !== 'md' && `dfg-btn--${size}`,
        fullWidth && 'dfg-btn--full',
        loading && 'dfg-btn--loading',
        className,
      )}
      disabled={isDisabled}
      aria-busy={loading ? true : undefined}
      aria-label={loading && loadingLabel !== undefined ? loadingLabel : undefined}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : icon}
      {children}
    </button>
  );
  if (disabledReason === undefined) return button;
  return <Tooltip content={disabledReason}>{button}</Tooltip>;
});
