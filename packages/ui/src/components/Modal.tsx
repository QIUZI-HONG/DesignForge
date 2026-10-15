'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * Modal —— 模态对话框（F1 模态族）。
 *
 * 口径（清单 §1.0 / F1）：遮罩 + 居中卡片（圆角 13，`--dfg-radius-xl`）、
 * 主次/危险按钮由调用方经 `footer` 给、Esc 关闭、焦点陷阱。
 * 行为（`useOverlayBehavior`）：打开锁滚动 + 焦点入层，关闭把焦点还原给打开它的元素；
 * Tab 在卡内回环；遮罩点击可关（`closeOnBackdrop`，默认 true）。
 * 关闭按钮只在给了 `closeLabel` 时渲染——「关闭」这类文案由调用方给，本包不含界面文案。
 */
import { type ReactNode, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import { CloseIcon } from '../icons/index';
import { cx } from '../utils/class-names';
import { useOverlayBehavior } from '../utils/use-overlay';
import { IconButton } from './IconButton';

/** 模态尺寸档（对应 `--dfg-size-modal-*`）。 */
export type ModalSize = 'sm' | 'md' | 'lg';

/** Modal props。 */
export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 标题（同时是对话框的可访问名）。 */
  title: ReactNode;
  /** 描述（关联到 `aria-describedby`）。 */
  description?: ReactNode;
  children?: ReactNode;
  /** 底部动作区（按钮由调用方给）。 */
  footer?: ReactNode;
  size?: ModalSize;
  /** 遮罩点击是否关闭；默认 true。 */
  closeOnBackdrop?: boolean;
  /** 关闭按钮的可访问名；不给则不渲染关闭按钮。 */
  closeLabel?: string;
  className?: string;
}

/** 模态对话框。 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  closeLabel,
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const behavior = useOverlayBehavior({
    open,
    onClose: () => onOpenChange(false),
    containerRef: dialogRef,
  });

  if (!open || typeof document === 'undefined') return null;

  const content = (
    // biome-ignore lint/a11y/noStaticElementInteractions: 遮罩点击只是「点外面关掉」的鼠标便捷路径（键盘等价路径是 Esc 与关闭按钮）；遮罩不是控件，给它 role 反而污染无障碍树。
    <div
      className="dfg-backdrop"
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onOpenChange(false);
      }}
      onKeyDown={behavior.onKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descId}
        className={cx('dfg-modal', size !== 'md' && `dfg-modal--${size}`, className)}
        tabIndex={-1}
      >
        <div className="dfg-modal__header">
          <div>
            <div className="dfg-modal__title" id={titleId}>
              {title}
            </div>
            {description === undefined ? null : (
              <div className="dfg-modal__desc" id={descId}>
                {description}
              </div>
            )}
          </div>
          {closeLabel === undefined ? null : (
            <IconButton
              label={closeLabel}
              icon={<CloseIcon />}
              onClick={() => onOpenChange(false)}
            />
          )}
        </div>
        {children === undefined ? null : <div className="dfg-modal__body">{children}</div>}
        {footer === undefined ? null : <div className="dfg-modal__footer">{footer}</div>}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
