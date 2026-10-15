/**
 * DropdownMenu —— 弹出菜单（F3 弹出菜单族）。
 *
 * 口径（清单 §1.0 / F3）：圆角 6、条目高 32（舒适档 `--dfg-row-height-md`，随主题密度变 28）、
 * 图标 16、快捷键右对齐、分组分隔线、禁用灰 + tooltip 原因。
 *
 * 交互与无障碍（WAI-ARIA menu 模式）：
 * - 触发器声明 `aria-haspopup="menu"` / `aria-expanded` / `aria-controls`，由调用方经
 *   `trigger` 渲染函数摊到自己的按钮上（本包不猜测触发器的形状与文案）；
 * - 打开后：↑/↓ 漫游（跳过禁用项、首尾回环）、Home/End 到两端、Enter/Space 选中、
 *   Esc 关闭并把焦点归还触发器、点击菜单外关闭；
 * - 禁用条目保持 DOM 可悬停（`aria-disabled` 而不是 `disabled`），这样「原因提示」能出来。
 */
import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { cx } from '../utils/class-names';
import { Tooltip } from './Tooltip';

/** 菜单条目（文案/快捷键由调用方给）。 */
export interface MenuItemSpec {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** 右侧快捷键提示（如 ⌘C）。 */
  shortcut?: string;
  disabled?: boolean;
  /** 禁用原因（悬停出提示）。 */
  disabledReason?: string;
  /** 危险语义（删除类）。 */
  danger?: boolean;
  onSelect?: () => void;
}

/** 菜单分组（有分组名时渲染组标题，组间画分隔线）。 */
export interface MenuSectionSpec {
  id: string;
  label?: ReactNode;
  items: MenuItemSpec[];
}

/** 触发器渲染状态（摊到自己按钮上即可获得完整 menu 语义）。 */
export interface MenuTriggerState {
  open: boolean;
  toggle: () => void;
  triggerProps: {
    ref: Ref<HTMLButtonElement>;
    onClick: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls': string | undefined;
  };
}

/** DropdownMenu props。 */
export interface DropdownMenuProps {
  /** 菜单的可访问名（如「文件操作」）。 */
  label: string;
  sections: MenuSectionSpec[];
  /** 触发器渲染函数（拿到语义 props 自行渲染按钮）。 */
  trigger: (state: MenuTriggerState) => ReactNode;
  /** 与触发器对齐：开始 / 末尾。 */
  align?: 'start' | 'end';
  /** 禁用原因提示的延迟（预览与截图门禁传 0）。 */
  tooltipDelay?: number;
  className?: string;
}

/** 弹出菜单。 */
export function DropdownMenu({
  label,
  sections,
  trigger,
  align = 'start',
  tooltipDelay,
  className,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocus = useRef<number | null>(null);

  // 展开后的条目是扁平序列（分组只是视觉分段），键盘漫游按扁平下标走
  const flatItems = sections.flatMap((section) => section.items);

  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    setActiveIndex(-1);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const openWithFocus = (index: number): void => {
    pendingFocus.current = index;
    setOpen(true);
  };

  // 打开后按需聚焦目标条目（先渲染再聚焦，避免聚焦不存在的节点）
  useEffect(() => {
    if (!open) return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === null) return;
    const index = target < 0 ? firstEnabledIndex(flatItems) : target;
    setActiveIndex(index);
    itemRefs.current[index]?.focus();
  }, [open, flatItems]);

  // 点击菜单外关闭（mousedown 早于 click，避免与条目点击互相打架）
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent): void => {
      if (containerRef.current?.contains(event.target as Node) === true) return;
      setOpen(false);
      setActiveIndex(-1);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const focusItem = (index: number): void => {
    setActiveIndex(index);
    itemRefs.current[index]?.focus();
  };

  const step = (from: number, direction: 1 | -1): void => {
    if (flatItems.length === 0) return;
    for (let offset = 1; offset <= flatItems.length; offset += 1) {
      const index = (from + direction * offset + flatItems.length * offset) % flatItems.length;
      if (flatItems[index]?.disabled !== true) {
        focusItem(index);
        return;
      }
    }
  };

  const activate = (index: number): void => {
    const item = flatItems[index];
    if (item === undefined || item.disabled === true) return;
    item.onSelect?.();
    close(true);
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = activeIndex < 0 ? firstEnabledIndex(flatItems) : activeIndex;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        step(current, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        step(current, -1);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(firstEnabledIndex(flatItems));
        break;
      case 'End': {
        event.preventDefault();
        let last = flatItems.length - 1;
        while (last >= 0 && flatItems[last]?.disabled === true) last -= 1;
        focusItem(last);
        break;
      }
      case 'Enter':
      case ' ':
        event.preventDefault();
        activate(current);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        // Tab 是「离开菜单」的合法路径：关闭但把焦点交给浏览器继续走
        close(false);
        break;
      default:
        break;
    }
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (open) {
      // 菜单已展开时，焦点可能还在触发器上（鼠标点开的）：方向键应把它送进菜单
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          close(true);
          break;
        case 'ArrowDown':
          event.preventDefault();
          focusItem(firstEnabledIndex(flatItems));
          break;
        case 'ArrowUp': {
          event.preventDefault();
          let last = flatItems.length - 1;
          while (last >= 0 && flatItems[last]?.disabled === true) last -= 1;
          focusItem(last);
          break;
        }
        default:
          break;
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openWithFocus(-1);
    }
  };

  const toggle = (): void => {
    if (open) close(false);
    else setOpen(true);
  };

  const triggerState: MenuTriggerState = {
    open,
    toggle,
    triggerProps: {
      ref: triggerRef,
      onClick: toggle,
      onKeyDown: handleTriggerKeyDown,
      'aria-haspopup': 'menu',
      'aria-expanded': open,
      'aria-controls': open ? menuId : undefined,
    },
  };

  return (
    <div className={cx('dfg-menu-anchor', className)} ref={containerRef}>
      {trigger(triggerState)}
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className={cx('dfg-menu', align === 'end' && 'dfg-menu--align-end')}
          onKeyDown={handleMenuKeyDown}
        >
          {sections.map((section, sectionIndex) => (
            <div key={section.id}>
              {/* 分隔线用 <hr>：自带 separator 语义（无需手写 role，也免去 div 语义补丁） */}
              {sectionIndex === 0 ? null : <hr className="dfg-menu__separator" />}
              {section.label === undefined ? null : (
                <div className="dfg-menu__group-label">{section.label}</div>
              )}
              {section.items.map((item) => {
                const index = flatItems.indexOf(item);
                const itemNode = (
                  <button
                    key={item.id}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    type="button"
                    role="menuitem"
                    aria-disabled={item.disabled === true ? true : undefined}
                    className={cx(
                      'dfg-menu__item',
                      item.danger === true && 'dfg-menu__item--danger',
                    )}
                    onClick={() => activate(index)}
                  >
                    {item.icon === undefined ? null : (
                      <span className="dfg-menu__icon">{item.icon}</span>
                    )}
                    <span className="dfg-menu__label-text">{item.label}</span>
                    {item.shortcut === undefined ? null : (
                      <span className="dfg-menu__shortcut">{item.shortcut}</span>
                    )}
                  </button>
                );
                if (item.disabledReason === undefined) return itemNode;
                return (
                  <Tooltip key={item.id} content={item.disabledReason} delay={tooltipDelay ?? 300}>
                    {itemNode}
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 首个可用条目下标（全禁用时返回 -1）。 */
function firstEnabledIndex(items: MenuItemSpec[]): number {
  return items.findIndex((item) => item.disabled !== true);
}
