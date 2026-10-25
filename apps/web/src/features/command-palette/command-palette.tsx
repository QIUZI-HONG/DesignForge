'use client';

/**
 * 命令面板（工单 08 · 规格故事 14：`Cmd+/` 呼出、全部命令两秒可达）。
 *
 * 形态：居中浮层（`@dforge/ui` 的 Overlay——浮层栈/z 序/Esc/滚动锁/焦点入层与
 * Modal/Drawer 同源）+ 搜索框 + 分组列表 + 键盘漫游。
 *
 * 行为口径：
 * - 打开：`⌘/`（`view.commandPalette` 命令，本域登记项接管注册，快捷键串即派发串——
 *   `../editor-shell/shortcuts` 惯例）；打开后焦点入搜索框，Esc / 点遮罩关闭；
 * - 搜索：`./match` 的中文子序列/包含匹配 + 命中高亮（`span.dfg-cmdk__hit`）；
 * - 键盘：↑/↓ 在可运行条目间漫游（置灰跳过、首尾回环），Home/End 跳首/尾，
 *   ↵ 执行并关闭，Esc 关闭；
 * - 焦点回落（验收 c）：Overlay 关闭时归还打开前的焦点元素；打开前焦点本在 body
 *   （如纯键盘呼出）→ 回落到画布区域（`main[data-df-slot='canvas']`，壳层为其留
 *   `tabIndex=-1`）；
 * - 可访问性：容器 `role="dialog"`，搜索框 `role="combobox"` + `aria-activedescendant`
 *   指向高亮项，列表 `role="listbox"`、条目 `role="option"`（APG combobox 惯例——
 *   条目不是 button：避免浮层「焦点入层」落到位选项上、焦点绕过搜索框）；
 * - 空态：查询无命中显示空结果态；失败态：命令抛错**就地**显示（`role="alert"`），
 *   面板不关；
 * - **本期不做「最近使用 / 常用」默认态**（后续票做）——空查询即全命令分组清单，不撒谎。
 */
import { ChevronDownIcon, ChevronUpIcon, Overlay, SearchIcon } from '@dforge/ui';
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { t } from '@/i18n';

import { executeCommand, useCommandList, useEditorUi } from '../editor-shell';
import {
  buildPaletteGroups,
  firstEnabledIndex,
  flattenPaletteItems,
  lastEnabledIndex,
  nextEnabledIndex,
  type PaletteGroup,
  type PaletteItem,
} from './palette-model';

/** 分组 + 组内条目的全局铺平下标（aria-activedescendant 与 DOM 顺序对齐的空间）。 */
interface IndexedGroup {
  group: PaletteGroup;
  rows: Array<{ item: PaletteItem; index: number }>;
}

/** 给分组列表补全局铺平下标（渲染期不数序号，纯数据预备）。 */
function withFlatIndexes(groups: PaletteGroup[]): IndexedGroup[] {
  let index = -1;
  return groups.map((group) => ({
    group,
    rows: group.items.map((item) => {
      index += 1;
      return { item, index };
    }),
  }));
}

/** 标题按命中区段渲染（连续一段、子序列多段；无命中原样返回）。 */
function HighlightedTitle({
  title,
  ranges,
}: {
  title: string;
  ranges: ReadonlyArray<readonly [number, number]>;
}): ReactNode {
  if (ranges.length === 0) return title;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(title.slice(cursor, start));
    parts.push(
      <span key={`hit-${start}`} className="dfg-cmdk__hit">
        {title.slice(start, end)}
      </span>,
    );
    cursor = end;
  }
  if (cursor < title.length) parts.push(title.slice(cursor));
  return parts;
}

/** 命令面板（挂 `overlays` 插槽；显隐由 `state/ui` 的 `commandPaletteOpen` 驱动）。 */
export function CommandPalette() {
  const open = useEditorUi((state) => state.commandPaletteOpen);
  const setOpen = useEditorUi((state) => state.setCommandPaletteOpen);
  const commands = useCommandList();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [failedTitle, setFailedTitle] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const groups = useMemo(() => buildPaletteGroups({ commands, query }), [commands, query]);
  const items = useMemo(() => flattenPaletteItems(groups), [groups]);
  const indexedGroups = useMemo(() => withFlatIndexes(groups), [groups]);

  // 打开时：清掉上次的查询与失败态（每次呼出都是干净的清单）
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setFailedTitle(null);
  }, [open]);

  // 高亮跟随列表变化（查询/命令表变动后落到首个可运行项）
  useEffect(() => {
    if (!open) return;
    setActiveIndex(firstEnabledIndex(items));
  }, [open, items]);

  // 焦点入搜索框（Overlay 的「焦点入层」落第一个可聚焦元素=搜索框，此处为兜底）
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  // 焦点回落（验收 c）：Overlay 已归还原焦点元素；原焦点本是 body（纯键盘呼出）→ 落画布。
  // wasOpen 守卫：只在「真的关了一次面板」后回落，挂载期（从未打开）不动焦点。
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) return;
    document.querySelector<HTMLElement>('main[data-df-slot="canvas"]')?.focus();
  }, [open]);

  // 高亮项滚动入视口（长列表键盘漫游；jsdom 未实现 scrollIntoView，按能力调用）
  useEffect(() => {
    if (activeIndex < 0) return;
    const option = listRef.current?.querySelector(`[data-cmdk-index="${activeIndex}"]`);
    if (option instanceof HTMLElement && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const runItem = async (index: number): Promise<void> => {
    const item = items[index];
    if (item === undefined || item.disabled) return;
    const result = await executeCommand(item.command.id);
    if (result.status === 'ran') {
      setOpen(false);
      return;
    }
    if (result.status === 'failed') {
      // 失败就地呈现：面板保持打开，用户可换一条继续
      setFailedTitle(item.command.title);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = nextEnabledIndex(items, activeIndex, event.key === 'ArrowDown' ? 1 : -1);
      if (next >= 0) setActiveIndex(next);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      const next = firstEnabledIndex(items);
      if (next >= 0) setActiveIndex(next);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      const next = lastEnabledIndex(items);
      if (next >= 0) setActiveIndex(next);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void runItem(activeIndex);
    }
    // Esc 不在此处理：Overlay 的浮层行为统一收口（栈顶关闭 + 焦点交接）
  };

  const activeOptionId =
    items[activeIndex] === undefined ? undefined : `${listboxId}-option-${activeIndex}`;

  return (
    // 遮罩点击 = 点容器自身（卡片外）：只作鼠标便捷路径，键盘等价路径是 Esc
    <Overlay
      open={open}
      onOpenChange={setOpen}
      label={t('editor.command.palette')}
      className="dfg-cmdk"
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 键位统一在搜索输入框（combobox 焦点宿主），容器只接冒泡键位，不承担独立交互 */}
      <div
        className="dfg-cmdk__card"
        data-df-preview="editor/command-palette"
        // 键盘事件从搜索框冒泡到此统一处理（combobox + listbox 模式，浮层内无第二处焦点陷阱）
        onKeyDown={onKeyDown}
      >
        <div className="dfg-cmdk__search">
          <SearchIcon />
          <input
            ref={inputRef}
            className="dfg-cmdk__input"
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

        <div className="dfg-cmdk__list" role="listbox" id={listboxId} ref={listRef}>
          {items.length === 0 ? (
            <p className="dfg-cmdk__empty" data-df-state="empty">
              {t('editor.palette.empty')}
            </p>
          ) : (
            indexedGroups.map(({ group, rows }) => (
              <div key={group.id} className="dfg-cmdk__group" data-cmdk-group={group.id}>
                <p className="dfg-cmdk__group-label">{group.label}</p>
                {rows.map(({ item, index }) => {
                  const selected = index === activeIndex;
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: 键盘执行经搜索框 Enter（aria-activedescendant 漫游），option 自身不设焦点
                    <div
                      key={item.command.id}
                      role="option"
                      id={`${listboxId}-option-${index}`}
                      tabIndex={-1}
                      data-cmdk-index={index}
                      aria-selected={selected}
                      aria-disabled={item.disabled ? true : undefined}
                      data-df-command={item.command.id}
                      className={
                        'dfg-cmdk__item' +
                        (selected ? ' dfg-cmdk__item--active' : '') +
                        (item.disabled ? ' dfg-cmdk__item--disabled' : '')
                      }
                      onClick={() => {
                        if (item.disabled) return;
                        setActiveIndex(index);
                        void runItem(index);
                      }}
                    >
                      <span className="dfg-cmdk__item-title">
                        <HighlightedTitle title={item.command.title} ranges={item.ranges} />
                      </span>
                      {item.command.shortcut === undefined ? null : (
                        <kbd className="dfg-cmdk__item-shortcut">{item.command.shortcut}</kbd>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {failedTitle === null ? null : (
          <p className="dfg-cmdk__error" role="alert" data-df-state="error">
            {t('editor.palette.failed', { title: failedTitle })}
          </p>
        )}

        <p className="dfg-cmdk__hint" aria-hidden="true">
          <ChevronUpIcon size={12} />
          <ChevronDownIcon size={12} />
          <span>{t('editor.palette.hint')}</span>
        </p>
      </div>
    </Overlay>
  );
}
