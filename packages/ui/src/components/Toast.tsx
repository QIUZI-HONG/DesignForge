'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * Toast —— 底部居中胶囊（F11，含内嵌「撤销」动作）。
 *
 * 用法：`<ToastProvider>` 包住应用；任意子组件 `const toast = useToast()` 后
 * `toast.show({ message, tone, action, duration })`。
 * 为什么用 Provider 而不是单例：队列是**界面态**（不是文档态），归 React；
 * 单例会在 SSR / 多实例上下文里泄漏状态。
 * 语义：区域 `role="status" aria-live="polite"`；错误语义的胶囊另标 `role="alert"`
 * （错误必须打断播报，成功/信息不该打断）。
 * 文案全部由调用方给（含「撤销」的动作名）。
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { AlertCircleIcon, CheckCircleIcon, InfoIcon } from '../icons/index';
import { cx } from '../utils/class-names';

/** 胶囊语义色（成功/失败/信息）。 */
export type ToastTone = 'success' | 'error' | 'info';

/** 内嵌动作（如「撤销」）。 */
export interface ToastAction {
  /** 动作名（由调用方给）。 */
  label: string;
  onActivate: () => void;
}

/** 弹出参数。 */
export interface ToastOptions {
  message: ReactNode;
  tone?: ToastTone;
  /** 自动消失时长（毫秒）；`0` = 常驻（只能靠动作或手动关闭）。默认 4000。 */
  duration?: number;
  action?: ToastAction;
}

/** 命令式句柄。 */
export interface ToastHandle {
  /** 弹出一条，返回 id（可用 `dismiss` 提前收起）。 */
  show: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

/** ToastProvider props。 */
export interface ToastProviderProps {
  children: ReactNode;
  /** 默认自动消失时长（毫秒）；默认 4000。 */
  defaultDuration?: number;
}

interface ToastRecord extends ToastOptions {
  id: string;
}

const ToastContext = createContext<ToastHandle | null>(null);

const TONE_ICON: Record<ToastTone, ReactNode> = {
  success: <CheckCircleIcon />,
  error: <AlertCircleIcon />,
  info: <InfoIcon />,
};

/** Toast 队列宿主（挂在应用根部）。 */
export function ToastProvider({ children, defaultDuration = 4000 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const counter = useRef(0);

  const dismiss = useCallback((id: string): void => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (options: ToastOptions): string => {
      counter.current += 1;
      const id = `dfg-toast-${counter.current}`;
      setToasts((current) => [...current, { ...options, id }]);
      const duration = options.duration ?? defaultDuration;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [defaultDuration, dismiss],
  );

  // 卸载时清定时器：避免在已卸载的 Provider 上 setState
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const handle = useMemo<ToastHandle>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={handle}>
      {children}
      <div className="dfg-toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx('dfg-toast', toast.tone !== undefined && `dfg-toast--${toast.tone}`)}
            role={toast.tone === 'error' ? 'alert' : undefined}
          >
            {toast.tone === undefined ? null : (
              <span className="dfg-toast__icon">{TONE_ICON[toast.tone]}</span>
            )}
            <span className="dfg-toast__message">{toast.message}</span>
            {toast.action === undefined ? null : (
              <button
                type="button"
                className="dfg-toast__action"
                onClick={() => {
                  toast.action?.onActivate();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** 取 Toast 句柄（必须在 `ToastProvider` 内使用）。 */
export function useToast(): ToastHandle {
  const handle = useContext(ToastContext);
  if (handle === null) {
    throw new Error(
      'useToast 必须在 <ToastProvider> 内使用：Toast 队列是界面态，需要 Provider 持有。',
    );
  }
  return handle;
}
