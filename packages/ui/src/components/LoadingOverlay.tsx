'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

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
