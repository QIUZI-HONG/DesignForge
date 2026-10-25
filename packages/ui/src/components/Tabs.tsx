'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * Tabs / TabPanel —— 页签（RW-07；Inspector 分区与设置页消费）。
 *
 * 语义（WAI-ARIA tabs 模式）：`role="tablist"` → `role="tab"`（`aria-selected` +
 * `aria-controls`）↔ `role="tabpanel"`（`aria-labelledby`，`hidden` 切换显示、
 * DOM 保留不卸载）。页签与面板经同一个 useId 前缀互相关联——TabPanel 必须放在
 * `<Tabs>` 的 children 里才能拿到关联。
 *
 * 键盘（roving tabindex：仅选中页签 tabIndex=0）：←/→（含 ↑/↓）漫游并**自动激活**
 * （Figma 面板口径：移动即切换，免二次确认）、Home/End 到两端、跳过禁用页签。
 *
 * 禁用口径（F15）：用 `aria-disabled` 而非 `disabled`——原生 disabled 控件不派发
 * 鼠标事件，会吞掉「禁用原因」提示（与 DropdownMenu 条目同一结论，回归见
 * `menu-item-layout.test.tsx`）；禁用页签的点击在组件内吞掉。
 */
import {
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useContext,
  useId,
  useRef,
} from 'react';

import { cx } from '../utils/class-names';
import { Tooltip } from './Tooltip';

/** 页签（文案由调用方给）。 */
export interface TabSpec {
  id: string;
  label: ReactNode;
  disabled?: boolean;
  /** 禁用原因（悬停出提示）。 */
  disabledReason?: string;
}

/** Tabs 与 TabPanel 的关联上下文（id 前缀 + 当前选中）。 */
interface TabsContextValue {
  idPrefix: string;
  value: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

/** Tabs props。 */
export interface TabsProps {
  /** 页签组的可访问名（如「检查器」）。 */
  label: string;
  tabs: TabSpec[];
  /** 当前选中页签 id（受控）。 */
  value: string;
  onChange: (id: string) => void;
  /** 面板区（TabPanel 必须放在这里才能与页签关联）。 */
  children?: ReactNode;
  /** 禁用原因提示的延迟（预览与截图门禁传 0）。 */
  tooltipDelay?: number;
  className?: string;
}

/** 页签组。 */
export function Tabs({
  label,
  tabs,
  value,
  onChange,
  children,
  tooltipDelay,
  className,
}: TabsProps) {
  const idPrefix = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number): void => {
    const tab = tabs[index];
    if (tab === undefined || tab.disabled === true) return;
    onChange(tab.id);
    tabRefs.current[index]?.focus();
  };

  const step = (from: number, direction: 1 | -1): void => {
    for (let offset = 1; offset <= tabs.length; offset += 1) {
      const index = (((from + direction * offset) % tabs.length) + tabs.length) % tabs.length;
      if (tabs[index]?.disabled !== true) {
        select(index);
        return;
      }
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const current = tabs.findIndex((tab) => tab.id === value);
    if (current < 0) return;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        step(current, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        step(current, -1);
        break;
      case 'Home': {
        event.preventDefault();
        const first = tabs.findIndex((tab) => tab.disabled !== true);
        if (first >= 0) select(first);
        break;
      }
      case 'End': {
        event.preventDefault();
        let last = tabs.length - 1;
        while (last >= 0 && tabs[last]?.disabled === true) last -= 1;
        if (last >= 0) select(last);
        break;
      }
      default:
        break;
    }
  };

  return (
    <TabsContext.Provider value={{ idPrefix, value }}>
      <div className={cx('dfg-tabs', className)}>
        <div
          role="tablist"
          aria-label={label}
          className="dfg-tabs__list"
          onKeyDown={handleKeyDown}
        >
          {tabs.map((tab, index) => {
            const selected = tab.id === value;
            const tabButton = (
              <button
                key={tab.id}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`${idPrefix}-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`${idPrefix}-panel-${tab.id}`}
                aria-disabled={tab.disabled === true ? 'true' : undefined}
                tabIndex={selected ? 0 : -1}
                className={cx(
                  'dfg-tabs__tab',
                  selected && 'dfg-tabs__tab--selected',
                  tab.disabled === true && 'dfg-tabs__tab--disabled',
                )}
                onClick={() => {
                  if (tab.disabled === true || selected) return;
                  onChange(tab.id);
                }}
              >
                {tab.label}
              </button>
            );
            if (tab.disabledReason === undefined) return tabButton;
            // asChild：提示直接挂页签（tablist 之下不得夹无语义包裹层）
            return (
              <Tooltip
                key={tab.id}
                content={tab.disabledReason}
                delay={tooltipDelay ?? 300}
                asChild
              >
                {tabButton}
              </Tooltip>
            );
          })}
        </div>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

/** TabPanel props。 */
export interface TabPanelProps {
  /** 对应页签 id。 */
  tab: string;
  children?: ReactNode;
  className?: string;
}

/** 页签面板（放在 `<Tabs>` 的 children 里，随选中显示/隐藏，DOM 保留）。 */
export function TabPanel({ tab, children, className }: TabPanelProps) {
  const context = useContext(TabsContext);
  const idPrefix = context?.idPrefix;
  return (
    <div
      role="tabpanel"
      id={idPrefix === undefined ? undefined : `${idPrefix}-panel-${tab}`}
      aria-labelledby={idPrefix === undefined ? undefined : `${idPrefix}-tab-${tab}`}
      hidden={context !== null && context.value !== tab ? true : undefined}
      className={cx('dfg-tabpanel', className)}
    >
      {children}
    </div>
  );
}
