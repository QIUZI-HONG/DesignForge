'use client';

/**
 * 命令面板（E7 清单 · ⌘K）。
 *
 * 形态（对标 Figma 本体的 ⌘K 面板）：**居中浮层 + 搜索 + 分组 + 键盘上下 + 最近使用**。
 *
 * 行为口径：
 * - 打开：⌘K（`view.commandPalette` 命令）或点击入口；打开后焦点入搜索框，Esc / 点遮罩关闭；
 * - 键盘：↑/↓ 在**可运行**条目间漫游（置灰项跳过、首尾回环），↵ 执行，Esc 关闭；
 * - 可访问性：搜索框 `role="combobox"` + `aria-activedescendant` 指向高亮项，
 *   列表 `role="listbox"`、条目 `role="option"`（读屏播报当前命令名）；
 * - 最近使用：localStorage 记忆（`state/recent-commands`），成功执行后前移；
 * - 空态：查询无命中显示空态；失败态：命令抛错**就地**显示（`role="alert"`），面板不关。
 */
import { ChevronDownIcon, ChevronUpIcon, SearchIcon } from '@dforge/ui';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { t } from '@/i18n';

import { executeCommand } from '../commands/execute';
import { useCommandList } from '../commands/use-commands';
import { pushRecentCommandId, readRecentCommandIds } from '../state/recent-commands';
import { useEditorUi } from '../state/ui';
import { cx } from '../utils/cx';
import {
  buildPaletteGroups,
  firstEnabledIndex,
  flattenPaletteItems,
  nextEnabledIndex,
} from './palette-model';

/** 命令面板（挂在编辑器壳；显隐由 `state/ui` 的 `commandPaletteOpen` 驱动）。 */
export function CommandPalette() {
  const open = useEditorUi((state) => state.commandPaletteOpen);
  const setOpen = useEditorUi((state) => state.setCommandPaletteOpen);
  const commands = useCommandList();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [failedTitle, setFailedTitle] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const listboxId = useId();

  const groups = useMemo(
    () =>
      buildPaletteGroups({
        commands,
        recentIds,
        query,
        recentLabel: t('editor.palette.recent'),
      }),
    [commands, recentIds, query],
  );
  const items = useMemo(() => flattenPaletteItems(groups), [groups]);

  // 打开时：记住原焦点、读回最近使用、清掉上次查询与失败态；关闭时还原焦点
  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setFailedTitle(null);
    setRecentIds(readRecentCommandIds());
    return () => {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open]);

  // 高亮跟随列表变化（查询/最近使用/命令表变动后落到首个可运行项）
  useEffect(() => {
    if (!open) return;
    setActiveIndex(firstEnabledIndex(items));
  }, [open, items]);

  // 焦点入搜索框（等浮层进 DOM 后再取）
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  // 高亮项滚动入视口（长列表键盘漫游；jsdom 未实现 scrollIntoView，按能力调用）
  useEffect(() => {
    if (activeIndex < 0) return;
    const option = listRef.current?.querySelector(`[data-palette-index="${activeIndex}"]`);
    if (option instanceof HTMLElement && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (!open || typeof document === 'undefined') return null;

  const runItem = async (index: number): Promise<void> => {
    const item = items[index];
    if (item === undefined || item.disabled) return;
    const result = await executeCommand(item.command.id);
    if (result.status === 'ran') {
      setRecentIds(pushRecentCommandId(item.command.id, recentIds));
      setOpen(false);
      return;
    }
    if (result.status === 'failed') {
      // 失败就地呈现：面板保持打开，用户可换一条继续
      setFailedTitle(item.command.title);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // 浮层内的 Esc 到此为止：不让外层（全局快捷键/其它浮层）再处理一次
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = nextEnabledIndex(items, activeIndex, 1);
      if (next >= 0) setActiveIndex(next);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = nextEnabledIndex(items, activeIndex, -1);
      if (next >= 0) setActiveIndex(next);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void runItem(activeIndex);
    }
  };

  const activeOptionId =
    items[activeIndex] === undefined ? undefined : `${listboxId}-option-${activeIndex}`;

  let runningIndex = -1;

  return createPortal(
    <div className="dfg-editor-palette">
      <button
        type="button"
        className="dfg-editor-palette__backdrop"
        aria-label={t('editor.palette.close')}
        tabIndex={-1}
        onClick={() => setOpen(false)}
      />
      <div
        className="dfg-editor-palette__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('editor.palette.placeholder')}
        data-df-preview="editor/command-palette"
        // 键盘事件从搜索框冒泡到此统一处理（combobox + listbox 模式，浮层内无第二处焦点陷阱）
        onKeyDown={onKeyDown}
      >
        <div className="dfg-editor-palette__search">
          <SearchIcon />
          <input
            ref={inputRef}
            className="dfg-editor-palette__input"
            type="text"
            role="combobox"
            aria-expanded={true}
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            placeholder={t('editor.palette.placeholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="dfg-editor-palette__list" role="listbox" id={listboxId} ref={listRef}>
          {items.length === 0 ? (
            <p className="dfg-editor-palette__empty" data-df-state="empty">
              {t('editor.palette.empty')}
            </p>
          ) : (
            groups.map((group) => (
              <div
                key={group.id}
                className="dfg-editor-palette__group"
                data-palette-group={group.id}
              >
                <p className="dfg-editor-palette__group-label">{group.label}</p>
                {group.items.map((item) => {
                  runningIndex += 1;
                  const index = runningIndex;
                  const selected = index === activeIndex;
                  return (
                    <button
                      key={item.command.id}
                      type="button"
                      role="option"
                      id={`${listboxId}-option-${index}`}
                      data-palette-index={index}
                      aria-selected={selected}
                      aria-disabled={item.disabled ? true : undefined}
                      data-df-command={item.command.id}
                      className={cx(
                        'dfg-editor-palette__item',
                        selected && 'dfg-editor-palette__item--active',
                        item.disabled && 'dfg-editor-palette__item--disabled',
                      )}
                      tabIndex={-1}
                      onClick={() => {
                        if (item.disabled) return;
                        setActiveIndex(index);
                        void runItem(index);
                      }}
                    >
                      <span className="dfg-editor-palette__item-title">{item.command.title}</span>
                      {item.command.shortcut === undefined ? null : (
                        <span className="dfg-editor-palette__item-shortcut">
                          {item.command.shortcut}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {failedTitle === null ? null : (
          <p className="dfg-editor-palette__error" role="alert" data-df-state="error">
            {t('editor.palette.failed', { title: failedTitle })}
          </p>
        )}

        <p className="dfg-editor-palette__hint" aria-hidden="true">
          <ChevronUpIcon size={12} />
          <ChevronDownIcon size={12} />
          <span>{t('editor.palette.hint')}</span>
        </p>
      </div>
    </div>,
    document.body,
  );
}
