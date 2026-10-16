'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

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
  /**
   * 把提示行为**直接挂到子元素本身**，不再包一层锚点 `<span>`。
   *
   * 何时必须用（FE-03 实测缺陷的根因）：容器对直接子元素有语义/布局要求时——
   * 典型是 `role="menu"` 的菜单条目：条目必须是整宽块级行、且应当直接挂在菜单下。
   * 夹一层 `inline-flex` 包裹会同时坏掉两件事：多条禁用条目并排成一行，
   * 且 `role="menuitem"` 被塞进无语义的 span 里（ARIA 父子层级被破坏）。
   * 默认（`false`）仍用包裹形态：原生 `disabled` 控件自身不派发鼠标事件，
   * 需要借外层包裹才能出提示（如禁用按钮的 F15 原因）。
   */
  asChild?: boolean;
  /** 锚点元素（单一子元素）。 */
  children: ReactNode;
  className?: string;
}

/** 组合事件处理器：先跑调用方原有的，再跑提示自己的（两者都不能丢）。 */
function compose<E extends { defaultPrevented?: boolean }>(
  theirs: ((event: E) => void) | undefined,
  ours: (event: E) => void,
): (event: E) => void {
  return (event) => {
    if (typeof theirs === 'function') theirs(event);
    ours(event);
  };
}

/** 悬停/聚焦提示。 */
export function Tooltip({
  content,
  placement = 'top',
  delay = 300,
  asChild = false,
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

  const tooltipNode = open ? (
    <span role="tooltip" id={id} className={cx('dfg-tooltip', `dfg-tooltip--${placement}`)}>
      {content}
    </span>
  ) : null;

  // asChild：提示挂到子元素自身；浮层作为**兄弟节点**紧随其后（绝对定位，不参与行布局）
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<Record<string, unknown>>;
    const { props } = child;
    const withHandlers = cloneElement(child, {
      onMouseEnter: compose(
        props.onMouseEnter as ((event: unknown) => void) | undefined,
        scheduleShow,
      ),
      onMouseLeave: compose(props.onMouseLeave as ((event: unknown) => void) | undefined, hide),
      onFocus: compose(props.onFocus as ((event: unknown) => void) | undefined, scheduleShow),
      onBlur: compose(props.onBlur as ((event: unknown) => void) | undefined, hide),
      ...(open ? { 'aria-describedby': id } : {}),
    });
    return (
      <>
        {withHandlers}
        {tooltipNode}
      </>
    );
  }

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
      {tooltipNode}
    </span>
  );
}
