/**
 * Tooltip —— 悬停/聚焦提示。
 *
 * 交互（清单 F3/F15 口径）：鼠标悬停与键盘聚焦都出现（可达性不只鼠标），Esc 关闭；
 * 延迟默认 300ms（避免扫过时闪动），预览与门禁里传 `delay={0}`。
 * 语义：`role="tooltip"` + 把 `aria-describedby` 注入锚点子元素（不是外层包裹 span），
 * 这样读屏在焦点落在真实控件上时能读到说明；禁用态也能出提示（禁用不改鼠标事件冒泡）。
 */
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { cx } from '../utils/class-names';

/** 提示方位。 */
export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

/** Tooltip props。 */
export interface TooltipProps {
  /** 提示内容（文案由调用方给，本包不含业务文案）。 */
  content: ReactNode;
  placement?: TooltipPlacement;
  /** 出现延迟（毫秒）；默认 300。 */
  delay?: number;
  /** 锚点元素（单一子元素）。 */
  children: ReactNode;
  className?: string;
}

/** 悬停/聚焦提示。 */
export function Tooltip({
  content,
  placement = 'top',
  delay = 300,
  children,
  className,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const scheduleShow = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [clearTimer, delay]);

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  // 卸载时清掉未触发的定时器，避免在已卸载组件上 setState
  useEffect(() => clearTimer, [clearTimer]);

  // 打开期间监听全局 Esc：提示可能是在鼠标悬停时打开的（焦点不在锚点上），
  // 只绑锚点键盘事件会漏掉这种情形。
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const anchor =
    open && isValidElement(children)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          'aria-describedby': id,
        })
      : children;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 包裹层只观察悬停/聚焦，交互都不落在它身上；必须挂外层是因为禁用控件自身不派发事件（F15 禁用原因提示正需要这种包裹）。
    <span
      className={cx('dfg-tooltip-anchor', className)}
      onMouseEnter={scheduleShow}
      onMouseLeave={hide}
      onFocus={scheduleShow}
      onBlur={hide}
    >
      {anchor}
      {open ? (
        <span role="tooltip" id={id} className={cx('dfg-tooltip', `dfg-tooltip--${placement}`)}>
          {content}
        </span>
      ) : null}
    </span>
  );
}
