'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * Overlay —— **全视口浮层**（模态族 / 抽屉族之外的第三种形态：「整屏视图层」）。
 *
 * 为什么需要它（D-4 的根因修复）：应用里的整屏浮层（版本并排对比、演示舞台等）
 * 如果各自写死 `position: fixed` + `z-index: var(--dfg-z-modal)`，就与 Modal/Drawer 的
 * **浮层栈（LIFO，栈序即层序）**脱钩：两者 z 值相同、而抽屉的内容经 portal 后挂在 body 末尾，
 * 于是「后挂的抽屉」在层序上盖住了「后开的对比浮层」——可见但点不动
 * （指针命中点落在抽屉 body 上，正是本票 C1 的实测缺陷）。
 *
 * 本组件把这类浮层接入同一条栈：z 序由栈序推导（后开必在上）、Esc 只关最内层、
 * 焦点入层/交接、滚动锁与 Modal/Drawer 同源。于是「抽屉 + 对比浮层」「抽屉 + 演示」
 * 这类组合的层级与指针行为不再依赖谁先挂到 body。
 *
 * 与 Modal/Drawer 的差别：**不带遮罩、不居中、不预设视觉**——内容自己铺满或自定定位
 * （`className`/`style` 由调用方给，本包不含业务样式与文案）。
 *
 * 可访问性：`role="dialog"` + `aria-modal="true"`，可访问名取 `label`；
 * 容器 `tabIndex={-1}`（无可聚焦内容时焦点落在容器自身，读屏能播报层名）。
 */
import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from 'react';
import { useRef } from 'react';
import { createPortal } from 'react-dom';

import { cx } from '../utils/class-names';
import { OverlayDepthContext, useOverlayBehavior } from '../utils/use-overlay';

/** Overlay props。 */
export interface OverlayProps
  extends Omit<ComponentPropsWithoutRef<'div'>, 'className' | 'style' | 'role' | 'children'> {
  open: boolean;
  /** 请求打开/关闭（Esc 关闭时回调 `false`；栈顶时才触发）。 */
  onOpenChange?: (open: boolean) => void;
  /** 可访问名（`aria-label`）。整屏视图层必须有名字——读屏需要知道进了哪一层。 */
  label?: string;
  children?: ReactNode;
  className?: string;
  /** 额外内联样式（视觉由调用方给；组件只注入 z 序）。 */
  style?: CSSProperties;
  /** Esc（栈顶时）是否关闭本层；默认 true。 */
  closeOnEsc?: boolean;
}

/** 整屏浮层。 */
export function Overlay({
  open,
  onOpenChange,
  label,
  children,
  className,
  style,
  closeOnEsc = true,
  ...rest
}: OverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const behavior = useOverlayBehavior({
    open,
    onClose: () => onOpenChange?.(false),
    containerRef,
    closeOnEsc,
  });

  if (!open || typeof document === 'undefined') return null;

  const content = (
    // 嵌套深度经 React 树提供（portal 之后 DOM 上不再是父子，深度只能从树上取）
    <OverlayDepthContext.Provider value={behavior.depth}>
      <div
        {...rest}
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cx('dfg-overlay', className)}
        style={{ ...style, zIndex: behavior.zIndex }}
        tabIndex={-1}
        onKeyDown={behavior.onKeyDown}
      >
        {children}
      </div>
    </OverlayDepthContext.Provider>
  );

  return createPortal(content, document.body);
}
