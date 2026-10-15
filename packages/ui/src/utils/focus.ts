/**
 * 焦点工具（模态/抽屉共用）。
 *
 * 为什么不用 focus-trap 库：需求只有「列可聚焦元素 + Tab 首尾回环」，
 * 且必须与 React 生命周期可控（打开时聚焦、关闭时还原），自持实现更透明。
 */
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/** 可聚焦元素选择器（覆盖原生可聚焦与显式 tabindex）。 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** 列出容器内可聚焦且可见的元素（DOM 顺序）。 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * 截获 Tab：在首尾之间回环，把焦点留在容器内（模态/抽屉的焦点陷阱）。
 *
 * @returns 是否消费了本次按键
 */
export function trapTabKey(
  event: ReactKeyboardEvent | KeyboardEvent,
  container: HTMLElement,
): boolean {
  if (event.key !== 'Tab') return false;
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    return true;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (first === undefined || last === undefined) return false;
  const active = container.ownerDocument.activeElement;
  if (event.shiftKey) {
    if (active === first || active === container) {
      event.preventDefault();
      last.focus();
      return true;
    }
    return false;
  }
  if (active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
