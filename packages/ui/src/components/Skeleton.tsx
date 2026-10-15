'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * Skeleton —— 骨架屏（F13 加载态族）。
 *
 * 口径（清单 B8）：卡片骨架 3–5 块、行骨架；骨架是**装饰**（读屏不念），
 * 语义由所在区块的加载状态（`Spinner`/`Progress`/`aria-busy`）承担。
 * 尺寸一律走令牌（默认高度取 `--dfg-space-3`），宽度可给百分比或令牌引用。
 */
import { cx } from '../utils/class-names';

/** 单块骨架 props。 */
export interface SkeletonProps {
  /** 宽度（CSS 长度；默认 100%）。 */
  width?: string;
  /** 高度覆盖（默认由类名给：块 12px）。 */
  height?: string;
  className?: string;
}

/** 单块骨架。 */
export function Skeleton({ width = '100%', height, className }: SkeletonProps) {
  return <span className={cx('dfg-skeleton', className)} style={{ width, height }} aria-hidden />;
}

/** SkeletonText props。 */
export interface SkeletonTextProps {
  /** 行数（默认 3，对应 B8「卡片骨架 3–5 块」）。 */
  lines?: number;
  className?: string;
}

/** 多行文本骨架（末行收短，模仿真实文本）。 */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <span className={cx('dfg-skeleton__lines', className)} aria-hidden>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={`line-${String(index)}`}
          className={cx('dfg-skeleton--text')}
          width={index === lines - 1 && lines > 1 ? '60%' : '100%'}
        />
      ))}
    </span>
  );
}

/** SkeletonCard props。 */
export interface SkeletonCardProps {
  /** 是否画缩略图块（文件卡片默认要）。 */
  showThumb?: boolean;
  className?: string;
}

/** 文件卡片骨架（缩略图 + 两行文字）。 */
export function SkeletonCard({ showThumb = true, className }: SkeletonCardProps) {
  return (
    <span className={cx('dfg-skeleton__card', className)} aria-hidden>
      {showThumb ? <span className="dfg-skeleton__thumb" /> : null}
      <Skeleton className="dfg-skeleton--text" width="80%" />
      <Skeleton className="dfg-skeleton--text" width="50%" />
    </span>
  );
}
