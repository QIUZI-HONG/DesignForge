'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * ErrorState —— 错误态（F14 错误态族）。
 *
 * 口径：重试按钮 + 错误码（借鉴 A9「错误标签页 7 类」的形状：标题 + 描述 + 重试）；
 * `retrying` 时重试按钮进加载态（不拆按钮，避免页面跳动）。
 * 文案（标题/描述/重试名）与错误码全由调用方给。
 */
import type { ReactNode } from 'react';

import { AlertTriangleIcon } from '../icons/index';
import { cx } from '../utils/class-names';
import { Button } from './Button';

/** ErrorState props。 */
export interface ErrorStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** 错误码（如 `E_NET_503`）；便于用户报障与日志定位。 */
  code?: string;
  /** 重试回调；与 `retryLabel` 同时给出才渲染重试按钮。 */
  onRetry?: () => void;
  /** 重试按钮文案（由调用方给）。 */
  retryLabel?: string;
  /** 重试进行中。 */
  retrying?: boolean;
  /** 插图；不给用默认警告三角。 */
  art?: ReactNode;
  className?: string;
}

/** 错误态占位。 */
export function ErrorState({
  title,
  description,
  code,
  onRetry,
  retryLabel,
  retrying = false,
  art,
  className,
}: ErrorStateProps) {
  const showRetry = onRetry !== undefined && retryLabel !== undefined;
  return (
    <div className={cx('dfg-state', 'dfg-state--error', className)}>
      <div className="dfg-state__art">{art ?? <AlertTriangleIcon size={48} />}</div>
      <div className="dfg-state__title">{title}</div>
      {description === undefined ? null : <p className="dfg-state__desc">{description}</p>}
      {code === undefined ? null : <span className="dfg-state__code">{code}</span>}
      {showRetry ? (
        <div className="dfg-state__action">
          <Button variant="secondary" loading={retrying} onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
