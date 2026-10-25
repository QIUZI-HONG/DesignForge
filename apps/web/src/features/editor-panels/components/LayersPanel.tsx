'use client';

/**
 * 图层面板（C3）。
 *
 * 数据流：文档快照来自命令栈（`usePanelsDocument`，`useSyncExternalStore`），
 * 选择集/折叠/重命名目标来自面板 UI store（与画布同源）；一切写入都转成引擎命令交给会话。
 *
 * 交互实现要点：
 * - 键盘漫游（↑/↓ 行走、←/→ 收起/展开、Enter/F2 重命名、Home/End 两端）——
 *   行是 `role="treeitem"`，roving tabindex 落在当前行；
 * - 拖拽用指针序列（pointerdown/move/up）自管，不依赖 HTML5 DnD：
 *   pointerdown 只记录候选，位移超过阈值才进入拖拽（并顺手选中该行）；
 *   落点计算交给 `commands/drop-target.ts`（纯函数、可单测），指针按下时缓存行几何（避免拖动中反复测量）；
 * - 长列表（>200 节点）：行样式带 `content-visibility: auto`，屏外行不参与渲染（不引重依赖）。
 */
import {
  type Command,
  findPage,
  layerTree,
  type NodeId,
  parentIdOf,
  type ScenePage,
} from '@dforge/engine';
import { EmptyState, ErrorState, Skeleton } from '@dforge/ui';
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';

import { t } from '@/i18n';
import {
  type DropRow,
  type DropTarget,
  isNoopDrop,
  resolveDropTarget,
} from '../commands/drop-target';
import {
  moveLayerCommands,
  renameLayerCommands,
  toggleLockCommands,
  toggleVisibilityCommands,
} from '../commands/layer-commands';
import { usePanelsDocument, usePanelsUi } from '../state/hooks';
import { LayerContextMenu } from './LayerContextMenu';
import { type DropEdge, LayerRow } from './LayerRow';
import { buildLayerRows, type LayerRowModel } from './layer-rows';
import { usePanelsSession } from './panels-context';

import '../editor-panels.css';

/** 拖拽阈值（几何常量）：超过才判定为拖拽，避免点击被误认为微拖。 */
const DRAG_THRESHOLD = 4;

/** 图层面板 props（loading/error 是验收标准 §5 的状态挂点，由壳层喂数据态）。 */
export interface LayersPanelProps {
  /** 文档加载中（骨架行）。 */
  loading?: boolean;
  /** 加载失败文案（错误态 + 重试）。 */
  error?: string | null;
  onRetry?: () => void;
  /** 与左栏页签组合时隐藏自带标题（页签即标题）。 */
  hideHeader?: boolean;
  className?: string;
}

/** 图层面板。 */
export function LayersPanel({
  loading = false,
  error = null,
  onRetry,
  hideHeader = false,
  className,
}: LayersPanelProps) {
  const session = usePanelsSession();
  const doc = usePanelsDocument(session);
  const collapsedIds = usePanelsUi(session, (state) => state.collapsedIds);
  const selection = usePanelsUi(session, (state) => state.selection);
  const renamingId = usePanelsUi(session, (state) => state.renamingId);

  const page = findPage(doc, session.pageId);
  const rows = useMemo(
    () => (page === undefined ? [] : buildLayerRows(layerTree(page), { collapsedIds, selection })),
    [page, collapsedIds, selection],
  );

  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<NodeId, HTMLDivElement>());
  const [focusedId, setFocusedId] = useState<NodeId | null>(null);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [drag, setDrag] = useState<{ dragId: NodeId; target: DropTarget | null } | null>(null);
  const [menu, setMenu] = useState<{ rowId: NodeId; x: number; y: number } | null>(null);
  const dragRef = useRef<{
    dragId: NodeId;
    startY: number;
    metrics: DropRow[];
    active: boolean;
    target: DropTarget | null;
  } | null>(null);

  const effectiveFocusId =
    focusedId !== null && rows.some((row) => row.id === focusedId)
      ? focusedId
      : (rows[0]?.id ?? null);

  const registerRef = useCallback((id: NodeId, element: HTMLDivElement | null) => {
    if (element === null) rowRefs.current.delete(id);
    else rowRefs.current.set(id, element);
  }, []);

  const run = useCallback(
    (commands: Command[], labelKey: string) => {
      if (commands.length === 0) return;
      session.run(commands, t(labelKey));
    },
    [session],
  );

  /** 取最新页面（写操作必须基于最新文档构造命令）。 */
  const currentPage = (): ScenePage | undefined => findPage(session.stack.document, session.pageId);

  const onActivate = useCallback(
    (id: NodeId, modifiers: { shift: boolean; meta: boolean }) => {
      session.ui.getState().selectLayer(id, modifiers);
    },
    [session],
  );

  const onToggleCollapsed = useCallback(
    (id: NodeId) => {
      session.ui.getState().toggleCollapsed(id);
    },
    [session],
  );

  const onToggleVisibility = useCallback(
    (id: NodeId) => {
      const current = currentPage();
      if (current === undefined) return;
      run(toggleVisibilityCommands(current, session.pageId, id), 'panels.history.visibility');
    },
    [run, session],
  );

  const onToggleLock = useCallback(
    (id: NodeId) => {
      const current = currentPage();
      if (current === undefined) return;
      run(toggleLockCommands(current, session.pageId, id), 'panels.history.lock');
    },
    [run, session],
  );

  const onBeginRename = useCallback(
    (id: NodeId) => {
      session.ui.getState().selectLayer(id);
      session.ui.getState().beginRename(id);
    },
    [session],
  );

  const onCancelRename = useCallback(() => {
    session.ui.getState().endRename();
  }, [session]);

  const onCommitRename = useCallback(
    (id: NodeId, name: string) => {
      const current = currentPage();
      if (current !== undefined) {
        run(renameLayerCommands(current, session.pageId, id, name), 'panels.history.rename');
      }
      session.ui.getState().endRename();
    },
    [run, session],
  );

  const onContextMenu = useCallback(
    (id: NodeId, position: { x: number; y: number }) => {
      // Figma 语义：右键未选中的行先把它选上，菜单动作作用在（可能是多选的）选择集上
      if (!session.ui.getState().selection.ids.includes(id)) {
        session.ui.getState().selectLayer(id);
      }
      setMenu({ rowId: id, x: position.x, y: position.y });
    },
    [session],
  );

  /** 指针按下时缓存行几何（拖动过程中不再测量 DOM）。 */
  const measureRows = useCallback((): DropRow[] => {
    if (page === undefined) return [];
    return rows.map((row) => {
      const element = rowRefs.current.get(row.id);
      const rect = element?.getBoundingClientRect();
      return {
        id: row.id,
        parentId: parentIdOf(page, row.id),
        depth: row.depth,
        // 落点「放入」只认可接收的真实容器（空画板也接得住，见 layer-rows 的 droppable）
        container: row.droppable,
        top: rect?.top ?? 0,
        bottom: rect?.bottom ?? 0,
      };
    });
  }, [page, rows]);

  const onRowPointerDown = useCallback(
    (id: NodeId, event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      // 鼠标交互不进「键盘模式」：点击行只出选中底，不画焦点环
      setKeyboardFocus(false);
      const row = rows.find((candidate) => candidate.id === id);
      if (row === undefined || row.readOnly) return;
      dragRef.current = {
        dragId: id,
        startY: event.clientY,
        metrics: measureRows(),
        active: false,
        target: null,
      };
    },
    [rows, measureRows],
  );

  const onListPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = dragRef.current;
      if (dragState === null || page === undefined) return;
      if (!dragState.active) {
        if (Math.abs(event.clientY - dragState.startY) < DRAG_THRESHOLD) return;
        dragState.active = true;
        // 拖动即选中（Figma 同款）；也顺势结束可能存在的重命名
        session.ui.getState().selectLayer(dragState.dragId);
        session.ui.getState().endRename();
        const target = listRef.current;
        try {
          target?.setPointerCapture?.(event.pointerId);
        } catch {
          // 指针捕获不是所有环境都实现（jsdom）：拿不到也不影响基本拖拽
        }
      }
      const target = resolveDropTarget(dragState.metrics, page, dragState.dragId, event.clientY);
      dragState.target = target;
      setDrag({ dragId: dragState.dragId, target });
    },
    [page, session],
  );

  const finishDrag = useCallback(() => {
    const dragState = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (dragState === null || !dragState.active || dragState.target === null) return;
    const current = currentPage();
    if (current === undefined) return;
    if (isNoopDrop(current, dragState.dragId, dragState.target)) return;
    run(
      moveLayerCommands(
        current,
        session.pageId,
        dragState.dragId,
        dragState.target.parentId,
        dragState.target.index,
      ),
      'panels.history.move',
    );
  }, [run, session]);

  /** 键盘漫游（roving tabindex；焦点与选中分离——选中归引擎选择模型）。 */
  const onRowKeyDown = useCallback(
    (id: NodeId, event: KeyboardEvent<HTMLDivElement>) => {
      const index = rows.findIndex((row) => row.id === id);
      const row = rows[index];
      if (row === undefined) return;
      const focusRow = (nextIndex: number): void => {
        const clamped = Math.max(0, Math.min(rows.length - 1, nextIndex));
        const nextId = rows[clamped]?.id;
        if (nextId === undefined) return;
        setKeyboardFocus(true);
        setFocusedId(nextId);
        rowRefs.current.get(nextId)?.focus();
      };
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          focusRow(index + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          focusRow(index - 1);
          break;
        case 'Home':
          event.preventDefault();
          focusRow(0);
          break;
        case 'End':
          event.preventDefault();
          focusRow(rows.length - 1);
          break;
        case 'ArrowRight':
          if (row.container) {
            event.preventDefault();
            if (row.collapsed) session.ui.getState().toggleCollapsed(id);
            else focusRow(index + 1);
          }
          break;
        case 'ArrowLeft':
          if (row.container && !row.collapsed) {
            event.preventDefault();
            session.ui.getState().toggleCollapsed(id);
          } else if (page !== undefined) {
            event.preventDefault();
            const parentId = parentIdOf(page, id);
            const parentIndex = rows.findIndex((candidate) => candidate.id === parentId);
            if (parentIndex >= 0) focusRow(parentIndex);
          }
          break;
        case 'Enter':
        case 'F2':
          if (!row.readOnly) {
            event.preventDefault();
            onBeginRename(id);
          }
          break;
        default:
          break;
      }
    },
    [rows, page, session, onBeginRename],
  );

  const dropIndicatorFor = (row: LayerRowModel): DropEdge | null => {
    if (drag === null || drag.target === null || page === undefined) return null;
    if (isNoopDrop(page, drag.dragId, drag.target)) return null;
    if (drag.target.indicator.rowId !== row.id) return null;
    return drag.target.indicator.edge;
  };

  return (
    <section
      aria-label={t('panels.layers.title')}
      aria-busy={loading}
      data-df-panel="layers"
      className={className === undefined ? 'dfg-panels__panel' : `${className} dfg-panels__panel`}
    >
      {hideHeader ? null : (
        <header className="dfg-panels__header">
          <span className="dfg-panels__header-title">{t('panels.layers.title')}</span>
          <span className="dfg-panels__header-spacer" />
        </header>
      )}

      {error !== null ? (
        <div data-df-sample="layers/error" className="dfg-panels__body">
          <ErrorState
            title={t('panels.layers.error.title')}
            description={t('panels.layers.error.desc')}
            {...(onRetry === undefined ? {} : { onRetry })}
            retryLabel={t('panels.layers.retry')}
          />
        </div>
      ) : loading ? (
        <div data-df-sample="layers/loading" className="dfg-panels__body">
          <span className="dfg-visually-hidden" role="status">
            {t('panels.layers.loading')}
          </span>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={`skeleton-${String(index)}`} className="dfg-panels__skeleton-row">
              <Skeleton height="var(--dfg-row-height-md)" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div data-df-sample="layers/empty" className="dfg-panels__body">
          <EmptyState
            title={t('panels.layers.empty.title')}
            description={t('panels.layers.empty.desc')}
          />
        </div>
      ) : (
        <div
          ref={listRef}
          role="tree"
          aria-label={t('panels.layers.tree.label')}
          data-df-layer-count={rows.length}
          className="dfg-panels__body dfg-panels__layer-list"
          onPointerMove={onListPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          {rows.map((row) => (
            <LayerRow
              key={row.id}
              row={row}
              focused={effectiveFocusId === row.id}
              keyboardFocus={keyboardFocus}
              renaming={renamingId === row.id}
              dropEdge={dropIndicatorFor(row)}
              dragging={drag?.dragId === row.id}
              registerRef={registerRef}
              onPointerDown={onRowPointerDown}
              onActivate={onActivate}
              onKeyDown={onRowKeyDown}
              onToggleCollapsed={onToggleCollapsed}
              onToggleVisibility={onToggleVisibility}
              onToggleLock={onToggleLock}
              onBeginRename={onBeginRename}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}

      {menu === null ? null : (
        <LayerContextMenu
          rowId={menu.rowId}
          position={{ x: menu.x, y: menu.y }}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
    </section>
  );
}
