/**
 * Progress —— 进度条（F13 页面级进度）。
 *
 * `value` 给定时是确定进度（`aria-valuenow/min/max` 齐全），不给则是不确定进度
 * （`--indeterminate` 动画，且**不带** valuenow——带值会被读屏读成假进度）。
 * 语义色档给成功/失败收尾（导出完成/失败）。
 */
import { cx } from '../utils/class-names';

/** 进度语义色。 */
export type ProgressTone = 'primary' | 'success' | 'danger';

/** Progress props。 */
export interface ProgressProps {
  /** 当前值；不给即不确定进度。 */
  value?: number;
  /** 上限（默认 100）。 */
  max?: number;
  /** 可访问名（页面级进度应有名字，如「导出进度」）。 */
  label?: string;
  tone?: ProgressTone;
  className?: string;
}

/** 进度条。 */
export function Progress({ value, max = 100, label, tone = 'primary', className }: ProgressProps) {
  const determinate = value !== undefined;
  const ratio = determinate ? Math.min(Math.max(value / max, 0), 1) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? max : undefined}
      aria-valuenow={determinate ? value : undefined}
      className={cx(
        'dfg-progress',
        tone !== 'primary' && `dfg-progress--${tone}`,
        !determinate && 'dfg-progress--indeterminate',
        className,
      )}
    >
      <div
        className="dfg-progress__bar"
        style={determinate ? { width: `${String(ratio * 100)}%` } : undefined}
      />
    </div>
  );
}
