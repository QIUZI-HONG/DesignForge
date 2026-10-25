'use client';

// 组件层统一声明客户端边界：Next App Router 下（apps/web）任何服务端组件都能直接引用本包组件，
// 无需每个消费方各自包一层 'use client' 包装器；令牌与图标仍是纯模块，可在服务端使用。

/**
 * Tree —— 树控件（图层树基础件，RW-07）。
 *
 * 语义（WAI-ARIA tree 模式）：`role="tree"` → `role="treeitem"`（可聚焦行本身）→
 * `role="group"`（子层容器）；行上标 `aria-level / aria-expanded / aria-selected /
 * aria-disabled / aria-busy`。
 *
 * 键盘（roving tabindex：仅当前行 tabIndex=0，其余 -1）：
 * ↑/↓ 在**可见行**间漫游（跳过禁用行）、→ 展开当前行（已展开则进入首个子行）、
 * ← 折叠当前行（已折叠则回到父行）、Enter/Space 选中、F2 进入重命名。
 *
 * 交互口径（对齐 Figma 图层面板）：
 * - 点击行选中；点击展开钮（纯视觉 affordance，`aria-hidden`）只开合不选中——
 *   键盘的等价路径是方向键；
 * - 重命名入口：双击或 F2 进入行内编辑，Enter/失焦提交、Esc 取消；新名由调用方
 *   经 `onRename` 落库（本包不持业务文案）；未给 `onRename` 即关闭重命名入口；
 * - 拖拽排序接口：行可拖（`draggable`），拖 A 落到 B 触发 `onReorder(source, target)`
 *   ——**落位语义（前后/内外）由图层树消费票（RW-13）与画布约定**，本组件只上报
 *   拖拽对；拖拽过程行上有 `--dragging` / `--droptarget` 修饰类供视觉表达。
 *
 * 状态族（六态，登记表 F16）：行 hover / 选中与键盘焦点（active）/ 禁用行（disabled）/
 * 子树加载中（loading，行内转圈 + `aria-busy`）/ 空树插槽（empty，文案调用方给）/
 * 子树加载失败（error，行内警示 + 点击行触发 `onRetry`）。
 */
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { AlertCircleIcon, ChevronDownIcon, ChevronRightIcon } from '../icons/index';
import { cx } from '../utils/class-names';
import { Spinner } from './Spinner';

/** 树节点（数据由调用方给；本组件不含图层业务语义）。 */
export interface TreeNodeSpec {
  id: string;
  /** 节点名（重命名经 `onRename` 上报新值，本组件不保存）。 */
  label: string;
  /** 节点类型图标（图层树消费方按图层类型给，如 Frame/Text/Group）。 */
  icon?: ReactNode;
  children?: TreeNodeSpec[];
  /** 禁用行：不可选中、不可拖拽、键盘漫游跳过。 */
  disabled?: boolean;
  /** 子树加载中：行内转圈 + `aria-busy`，子行暂不渲染。 */
  loading?: boolean;
  /** 子树加载失败：行内警示，点击行触发 `onRetry`（代替选中）。 */
  error?: boolean;
}

/** Tree props。 */
export interface TreeProps {
  /** 树的可访问名（如「图层」）。 */
  label: string;
  nodes: TreeNodeSpec[];
  /** 当前选中节点 id（受控单选；不给即无选中）。 */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** 展开集合（受控）。 */
  expandedIds?: string[];
  /** 展开集合（非受控初值）。 */
  defaultExpandedIds?: string[];
  /** 开合回调（受控/非受控都上报最新集合）。 */
  onExpandedChange?: (ids: string[]) => void;
  /** 重命名入口：给出才开放（双击/F2），提交新名。 */
  onRename?: (id: string, label: string) => void;
  /** 错误行重试（点击错误行触发）。 */
  onRetry?: (id: string) => void;
  /** 拖拽排序接口：source 落到 target（落位语义由消费方约定）。 */
  onReorder?: (sourceId: string, targetId: string) => void;
  /** 空树内容（文案与插图由调用方给）。 */
  emptyContent?: ReactNode;
  className?: string;
}

/** 扁平化的可见行（键盘漫游、roving tabindex 与递归渲染按同一口径走）。 */
interface VisibleRow {
  node: TreeNodeSpec;
  level: number;
  parentId: string | null;
  /** 声明了子节点（无论是否加载中）。 */
  hasChildren: boolean;
  /** 当前是否展开（仅可开合行可能为真）。 */
  expanded: boolean;
}

/** 单节点的可见行推导（收集与渲染共用的唯一口径）。 */
function rowFor(
  node: TreeNodeSpec,
  level: number,
  parentId: string | null,
  expandedSet: ReadonlySet<string>,
): VisibleRow {
  const hasChildren = node.children !== undefined && node.children.length > 0;
  const expandable = hasChildren && node.loading !== true && node.error !== true;
  return { node, level, parentId, hasChildren, expanded: expandable && expandedSet.has(node.id) };
}

/** 递归收集可见行（展开集合驱动；加载/失败行不再下钻）。 */
function collectVisible(
  nodes: TreeNodeSpec[],
  level: number,
  parentId: string | null,
  expandedSet: ReadonlySet<string>,
  out: VisibleRow[],
): void {
  for (const node of nodes) {
    const row = rowFor(node, level, parentId, expandedSet);
    out.push(row);
    if (row.expanded && node.children !== undefined) {
      collectVisible(node.children, level + 1, node.id, expandedSet, out);
    }
  }
}

/** 树控件。 */
export function Tree({
  label,
  nodes,
  selectedId = null,
  onSelect,
  expandedIds,
  defaultExpandedIds,
  onExpandedChange,
  onRename,
  onRetry,
  onReorder,
  emptyContent,
  className,
}: TreeProps) {
  const controlled = expandedIds !== undefined;
  const [innerExpanded, setInnerExpanded] = useState<string[]>(defaultExpandedIds ?? []);
  const expandedList = controlled ? (expandedIds as string[]) : innerExpanded;
  const expandedSet = useMemo(() => new Set(expandedList), [expandedList]);

  const visibleRows = useMemo<VisibleRow[]>(() => {
    const out: VisibleRow[] = [];
    collectVisible(nodes, 1, null, expandedSet, out);
    return out;
  }, [nodes, expandedSet]);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const renameOriginal = useRef('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // 进入重命名即程序化聚焦输入框（autoFocus 的副作用等价替代，biome noAutofocus）
  useEffect(() => {
    if (renamingId !== null) renameInputRef.current?.focus();
  }, [renamingId]);

  const focusRow = useCallback((id: string): void => {
    rowRefs.current.get(id)?.focus();
  }, []);

  const toggleExpanded = useCallback(
    (id: string): void => {
      const next = expandedList.includes(id)
        ? expandedList.filter((existing) => existing !== id)
        : [...expandedList, id];
      if (!controlled) setInnerExpanded(next);
      onExpandedChange?.(next);
    },
    [controlled, expandedList, onExpandedChange],
  );

  /** 行激活（点击/键盘共用）：错误行语义是「重试」，其余是「选中」。 */
  const activate = useCallback(
    (node: TreeNodeSpec): void => {
      if (node.disabled === true) return;
      if (node.error === true) {
        onRetry?.(node.id);
        return;
      }
      onSelect?.(node.id);
    },
    [onRetry, onSelect],
  );

  const startRename = useCallback(
    (node: TreeNodeSpec): void => {
      if (onRename === undefined) return;
      if (node.disabled === true || node.loading === true || node.error === true) return;
      renameOriginal.current = node.label;
      setDraft(node.label);
      setRenamingId(node.id);
    },
    [onRename],
  );

  const finishRename = useCallback(
    (commit: boolean): void => {
      if (renamingId === null) return;
      const id = renamingId;
      const text = draft.trim();
      setRenamingId(null);
      // 回焦点到行：编辑结束不把焦点丢给 body（键盘连续操作）
      focusRow(id);
      if (commit && text !== '' && text !== renameOriginal.current) onRename?.(id, text);
    },
    [draft, focusRow, onRename, renamingId],
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // 重命名编辑态由输入框自理（Enter/Escape 在输入框上 stopPropagation）
    if (renamingId !== null) return;
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    const id = item?.dataset.nodeId;
    if (id === undefined) return;
    const index = visibleRows.findIndex((row) => row.node.id === id);
    const current = visibleRows[index];
    if (current === undefined) return;
    const total = visibleRows.length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        // 环形漫游，跳过禁用行
        for (let offset = 1; offset <= total; offset += 1) {
          const idx = (((index + direction * offset) % total) + total) % total;
          const candidate = visibleRows[idx];
          if (candidate !== undefined && candidate.node.disabled !== true) {
            focusRow(candidate.node.id);
            break;
          }
        }
        break;
      }
      case 'ArrowRight':
        event.preventDefault();
        if (
          current.hasChildren &&
          current.node.loading !== true &&
          current.node.error !== true
        ) {
          if (!current.expanded) {
            toggleExpanded(current.node.id);
          } else {
            // 已展开：右方向键进入首个子行
            const child = visibleRows[index + 1];
            if (child !== undefined && child.level > current.level) focusRow(child.node.id);
          }
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (current.hasChildren && current.expanded) {
          toggleExpanded(current.node.id);
        } else if (current.parentId !== null) {
          // 已折叠（或叶子）：左方向键回到父行
          focusRow(current.parentId);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        activate(current.node);
        break;
      case 'F2':
        event.preventDefault();
        startRename(current.node);
        break;
      default:
        break;
    }
  };

  /** 点击归属判定：子行冒泡与展开钮点击都不当代本行的激活。 */
  const isOwnRowClick = (node: TreeNodeSpec, event: ReactMouseEvent<HTMLDivElement>): boolean => {
    if ((event.target as HTMLElement).closest('.dfg-tree__toggle') !== null) return false;
    const hit = (event.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    return hit?.dataset.nodeId === node.id;
  };

  /** 渲染单行（行即 treeitem；展开钮是纯视觉 affordance，键盘等价路径是方向键）。 */
  const renderNode = (row: VisibleRow): ReactNode => {
    const { node, level } = row;
    const selected = node.id === selectedId && node.disabled !== true;
    const isRenaming = renamingId === node.id;
    const draggable = onReorder !== undefined && node.disabled !== true && !isRenaming;
    return (
      <div
        key={node.id}
        ref={(element) => {
          if (element === null) rowRefs.current.delete(node.id);
          else rowRefs.current.set(node.id, element);
        }}
        role="treeitem"
        data-node-id={node.id}
        aria-level={level}
        aria-expanded={
          row.hasChildren && node.loading !== true && node.error !== true
            ? row.expanded
              ? 'true'
              : 'false'
            : undefined
        }
        aria-selected={node.disabled === true ? undefined : selected ? 'true' : 'false'}
        aria-disabled={node.disabled === true ? 'true' : undefined}
        aria-busy={node.loading === true ? 'true' : undefined}
        className={cx(
          'dfg-tree__node',
          selected && 'dfg-tree__node--selected',
          node.disabled === true && 'dfg-tree__node--disabled',
          node.error === true && 'dfg-tree__node--error',
          draggingId === node.id && 'dfg-tree__node--dragging',
          dropTargetId === node.id && 'dfg-tree__node--droptarget',
        )}
        tabIndex={node.disabled === true || node.id !== activeId ? -1 : 0}
        onClick={(event) => {
          if (isRenaming || !isOwnRowClick(node, event)) return;
          activate(node);
        }}
        onKeyDown={(event) => {
          // 点击激活的键盘等价路径（Enter/Space，useKeyWithClickEvents）：就地激活并
          // 拦截冒泡，避免容器级 onKeyDown 对同一击再激活一次（onRetry 会重放两次）
          if (isRenaming || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          event.stopPropagation();
          activate(node);
        }}
        draggable={draggable}
        onDragStart={(event) => {
          if (!draggable) return;
          setDraggingId(node.id);
          setDropTargetId(null);
          // jsdom 无 dataTransfer；真实浏览器里顺带塞入文本兜底
          if (event.dataTransfer !== undefined) {
            event.dataTransfer.setData('text/plain', node.id);
            event.dataTransfer.effectAllowed = 'move';
          }
        }}
        onDragOver={(event) => {
          if (draggingId === null || draggingId === node.id || node.disabled === true) return;
          event.preventDefault();
          setDropTargetId(node.id);
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (draggingId !== null && draggingId !== node.id && node.disabled !== true) {
            onReorder?.(draggingId, node.id);
          }
          setDraggingId(null);
          setDropTargetId(null);
        }}
        onDragEnd={() => {
          setDraggingId(null);
          setDropTargetId(null);
        }}
        onDoubleClick={(event) => {
          // 双击展开钮不算重命名入口（行本体双击才算）
          if (isOwnRowClick(node, event)) startRename(node);
        }}
      >
        {node.loading === true ? (
          <span className="dfg-tree__status">
            <Spinner size="sm" />
          </span>
        ) : node.error === true ? (
          <span className="dfg-tree__status">
            <AlertCircleIcon />
          </span>
        ) : row.hasChildren ? (
          <button
            type="button"
            className="dfg-tree__toggle"
            tabIndex={-1}
            aria-hidden="true"
            onClick={(event) => {
              event.stopPropagation();
              toggleExpanded(node.id);
            }}
          >
            {row.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </button>
        ) : (
          <span className="dfg-tree__toggle-gap" aria-hidden="true" />
        )}
        {node.icon === undefined ? null : <span className="dfg-tree__icon">{node.icon}</span>}
        {isRenaming ? (
          <input
            className="dfg-tree__rename"
            ref={renameInputRef}
            value={draft}
            aria-label={node.label}
            onChange={(event) => setDraft(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={() => finishRename(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                finishRename(true);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                finishRename(false);
              }
            }}
          />
        ) : (
          <span className="dfg-tree__label">{node.label}</span>
        )}
      </div>
    );
  };

  /** 渲染行及其子层（展开时子行挂在行内的 role="group" 容器里，缩进由组级联）。 */
  const renderWithChildren = (row: VisibleRow): ReactNode => {
    const { node } = row;
    const children = row.expanded && node.children !== undefined ? node.children : undefined;
    return (
      <Fragment key={node.id}>
        {renderNode(row)}
        {children === undefined ? null : (
          // biome-ignore lint/a11y/useSemanticElements: 子层容器是 WAI-ARIA tree 模式固定结构 role=group；等价语义元素 fieldset 自带默认边框/内边距，会引入视觉回归
          <div role="group" className="dfg-tree__group">
            {children.map((child) =>
              renderWithChildren(rowFor(child, row.level + 1, node.id, expandedSet)),
            )}
          </div>
        )}
      </Fragment>
    );
  };

  // roving tabindex 的锚点：选中行优先，否则第一个可用行
  const activeId = useMemo<string | null>(() => {
    const selectedRow = visibleRows.find((row) => row.node.id === selectedId);
    if (selectedRow !== undefined && selectedRow.node.disabled !== true) return selectedRow.node.id;
    return visibleRows.find((row) => row.node.disabled !== true)?.node.id ?? null;
  }, [visibleRows, selectedId]);

  return (
    <div
      role="tree"
      aria-label={label}
      className={cx('dfg-tree', className)}
      onKeyDown={handleKeyDown}
    >
      {nodes.length === 0 && emptyContent !== undefined ? (
        <div className="dfg-tree__empty">{emptyContent}</div>
      ) : (
        visibleRows
          .filter((row) => row.level === 1)
          .map((row) => renderWithChildren(row))
      )}
    </div>
  );
}
