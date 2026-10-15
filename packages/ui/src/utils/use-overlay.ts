/**
 * 浮层行为的共用实现（模态与抽屉同构：锁滚动、焦点入层、Esc、Tab 回环、关闭还原）。
 *
 * 为什么放在一起：F1（模态族）与 F2（抽屉族）只在视觉与入场动效上不同，
 * 可访问性契约完全一致；共用一个 hook 才不会两处跑偏。
 * 嵌套浮层的 Esc 归属：处理者调用 `stopPropagation`，只有最内层关闭（见组件里的 onKeyDown）。
 */
import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useEffect, useRef } from 'react';

import { getFocusableElements, trapTabKey } from './focus';

/** 浮层行为参数。 */
export interface OverlayBehaviorOptions {
  open: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
}

/**
 * 绑定浮层行为：打开时锁滚动并把焦点移入；关闭时还原滚动与焦点。
 *
 * @returns 供浮层根节点使用的 `onKeyDown`（Esc 关闭、Tab 回环）
 */
export function useOverlayBehavior({ open, onClose, containerRef }: OverlayBehaviorOptions) {
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const active = document.activeElement;
    restoreFocusRef.current = active instanceof HTMLElement ? active : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (container === null) return;
    const focusables = getFocusableElements(container);
    const target = focusables[0] ?? container;
    target.focus();
  }, [open, containerRef]);

  return {
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement> | KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        // 嵌套浮层（如抽屉上盖模态）只关最内层：不让同一次按键继续冒泡
        event.stopPropagation();
        onClose();
        return;
      }
      const container = containerRef.current;
      if (container !== null) trapTabKey(event, container);
    },
  };
}
