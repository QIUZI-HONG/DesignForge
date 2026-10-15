'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * EmptyState —— 空态（F12 空态族）。
 *
 * 口径（清单 §1.0 / B7 / F12）：居中插图 + 标题 + 单行说明 + 可选主按钮；
 * 标题字号 18、说明 13（浅色基准的字号层级）。文案与按钮全由调用方给。
 */
import type { ReactNode } from 'react';

import { BoxIcon } from '../icons/index';
import { cx } from '../utils/class-names';

/** EmptyState props。 */
export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** 插图；不给用默认空盒图标（48px）。 */
  art?: ReactNode;
  /** 动作区（通常一个主按钮，由调用方给）。 */
  action?: ReactNode;
  className?: string;
}

/** 空态占位。 */
export function EmptyState({ title, description, art, action, className }: EmptyStateProps) {
  return (
    <div className={cx('dfg-state', className)}>
      <div className="dfg-state__art">{art ?? <BoxIcon size={48} />}</div>
      <div className="dfg-state__title">{title}</div>
      {description === undefined ? null : <p className="dfg-state__desc">{description}</p>}
      {action === undefined ? null : <div className="dfg-state__action">{action}</div>}
    </div>
  );
}
