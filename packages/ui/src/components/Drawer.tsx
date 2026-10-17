'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * Drawer —— 右侧滑入抽屉（F2 抽屉族）。
 *
 * 口径（清单 §1.0 / F2）：右侧滑入、宽度分级（sm/md/lg）、可关闭、
 * **关闭记忆**——给出 `rememberKey` 后把开合状态持久化（默认 localStorage），
 * 下次挂载（非受控用法）按存储值恢复（AI 面板 / 出图面板的「上次开着就还开着」）。
 * 存储后端可注入（`storage`），便于测试与非浏览器环境。
 * 嵌套：与 Modal 共用浮层栈（Esc 与遮罩点击只关最内层、焦点在最内层、z 序随栈序）。
 */
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { CloseIcon } from '../icons/index';
import { cx } from '../utils/class-names';
import { OverlayDepthContext, useOverlayBehavior } from '../utils/use-overlay';
import { IconButton } from './IconButton';

/** 抽屉宽度分级（对应 `--dfg-size-drawer-*`）。 */
export type DrawerWidth = 'sm' | 'md' | 'lg';

/** 最小存储接口（`localStorage` 的形状子集，便于注入）。 */
export interface DrawerStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/** Drawer props。 */
export interface DrawerProps {
  /** 受控开合；不给则非受控（配合 `defaultOpen` 与 `rememberKey`）。 */
  open?: boolean;
  /** 非受控初值（`rememberKey` 存在且存储有值时以存储值优先）。 */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 标题（同时是抽屉的可访问名）。 */
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: DrawerWidth;
  /** 关闭按钮的可访问名；不给则不渲染关闭按钮。 */
  closeLabel?: string;
  /** 关闭记忆的存储键（如 `dfg-drawer-ai`）。 */
  rememberKey?: string;
  /** 存储后端；默认 `localStorage`（浏览器外无值则不记忆）。 */
  storage?: DrawerStorage;
  className?: string;
}

/** 右侧抽屉。 */
export function Drawer({
  open,
  defaultOpen,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'md',
  closeLabel,
  rememberKey,
  storage,
  className,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(() => {
    if (defaultOpen === true) return true;
    if (rememberKey === undefined) return false;
    const store = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    return store?.getItem(rememberKey) === 'true';
  });

  const controlled = open !== undefined;
  const isOpen = controlled ? open : uncontrolledOpen;

  const setOpen = (next: boolean): void => {
    if (!controlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  // 关闭记忆：状态变化即落盘（受控用法也落，调用方只负责受控值）
  useEffect(() => {
    if (rememberKey === undefined) return;
    const store = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    store?.setItem(rememberKey, String(isOpen));
  }, [isOpen, rememberKey, storage]);

  const behavior = useOverlayBehavior({
    open: isOpen,
    onClose: () => setOpen(false),
    containerRef: panelRef,
  });

  if (!isOpen || typeof document === 'undefined') return null;

  const content = (
    // 嵌套深度经 React 树提供（portal 之后 DOM 上不再是父子，深度只能从树上取）
    <OverlayDepthContext.Provider value={behavior.depth}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 遮罩点击只是「点外面关掉」的鼠标便捷路径（键盘等价路径是 Esc 与关闭按钮）；遮罩不是控件，给它 role 反而污染无障碍树。 */}
      <div
        className="dfg-drawer-backdrop"
        style={{ zIndex: behavior.zIndex }}
        onClick={(event) => {
          // 外部点击只作用于栈顶：内层浮层开着时，点遮罩不应把外层一并关掉
          if (behavior.isTop() && event.target === event.currentTarget) setOpen(false);
        }}
        onKeyDown={behavior.onKeyDown}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description === undefined ? undefined : descId}
          className={cx('dfg-drawer', width !== 'md' && `dfg-drawer--${width}`, className)}
          tabIndex={-1}
        >
          <div className="dfg-drawer__header">
            <div className="dfg-drawer__title" id={titleId}>
              {title}
            </div>
            {closeLabel === undefined ? null : (
              <IconButton label={closeLabel} icon={<CloseIcon />} onClick={() => setOpen(false)} />
            )}
          </div>
          <div className="dfg-drawer__body">
            {description === undefined ? null : (
              <p className="dfg-modal__desc" id={descId}>
                {description}
              </p>
            )}
            {children}
          </div>
          {footer === undefined ? null : <div className="dfg-drawer__footer">{footer}</div>}
        </div>
      </div>
    </OverlayDepthContext.Provider>
  );

  return createPortal(content, document.body);
}
