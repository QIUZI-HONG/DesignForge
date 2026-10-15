/**
 * LoadingOverlay —— 阻塞遮罩（F13：页面级/区块级阻塞加载）。
 *
 * 绝对定位铺满**最近的定位祖先**（卡片/画布容器），因此不抢占整页；
 * 需要整页阻塞时由调用方把祖先设为相对定位并铺满视口。
 * 语义：`role="status"` 具名状态区（`label` 必给场景由调用方文案提供，如「正在导出」）。
 */
import { cx } from '../utils/class-names';
import { Spinner } from './Spinner';

/** LoadingOverlay props。 */
export interface LoadingOverlayProps {
  /** 状态名（读屏播报）。 */
  label: string;
  className?: string;
}

/** 阻塞遮罩。 */
export function LoadingOverlay({ label, className }: LoadingOverlayProps) {
  return (
    <div className={cx('dfg-loading-overlay', className)} role="status" aria-label={label}>
      <Spinner size="lg" />
      <span>{label}</span>
    </div>
  );
}
