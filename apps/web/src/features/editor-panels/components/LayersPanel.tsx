'use client';

/**
 * 图层面板（C3，RW-13 重写）——接入 @dforge/ui 的 Tree（RW-07）。
 *
 * 数据流：文档快照来自命令栈（`usePanelsDocument`，`useSyncExternalStore`），
 * 选择集/折叠集来自面板 UI store（与画布同源）；一切写入都转成引擎命令交给会话。
 *
 * Tree 消费口径（RW-13，兑现 RW-07 留给本票的约定）：
 * - **单选与双向联动**：Tree `selectedId` = 选择集 `activeId`；面板点选走 `selectLayer`
 *   （引擎 `clickSelection` 无修饰键语义），画布与面板同源读同一 store——画布写入后
 *   面板滚动定位选中行（`scrollIntoView nearest`）并自动展开折叠的祖先链。
 *   画布多选时面板只高亮主选中行（Tree v1 单选语义）。
 * - **重命名**：Tree 行内编辑（双击/F2，Enter/失焦提交、Esc 取消）提交 →
 *   `renameLayerCommands`（引擎 `node.update` 补丁，空白/同名由两侧共同把关）。
 *   右键菜单不再带「重命名」条目：Tree v1 的编辑态是组件内私有状态，外部无法触达；
 *   行内双击/F2 是更短的路径。
 * - **拖拽落位（RW-13 约定，详见 commands/tree-drop.ts）**：Tree `onReorder(source, target)`
 *   只上报拖拽对——指针 Y 由本面板在 document 级 `dragover` 自记，target 行矩形在 drop 时
 *   量取；上/下各半判定插入位置（上=之前/下=之后，无指针按「之前」降级）；跨父拖拽 =
 *   reparent（`moveLayerCommands` → `reparentPreservingWorldCommands`，世界位置保持）；
 *   一次 drop 恰好一次 `session.run`（单事务），不碰 `CommandStack.enqueue` 的微任务合并。
 *   「放入容器内部」不在 Tree v1 约定内——拖入容器 = 展开后落到它的子行上。
 * - **行级状态**：Tree 六态的 `disabled` = 实例虚节点（结构只读：不可选中/拖拽/重命名，
 *   键盘漫游跳过；选中与属性编辑走画布/Inspector）；`loading`/`error` 在同步命令栈文档下
 *   不产生（无异步子树装载），挂点透传留给后续异步装载票（不给 `onRetry` 即关闭错误行入口）。
 * - **千级图层（渲染窗口化，零依赖）**：全量 DOM 挂载（树结构/折叠/键盘漫游语义完整），
 *   屏外行的**渲染**跳过交给 CSS `content-visibility: auto`
 *   （editor-panels.css `.dfg-panels__tree .dfg-tree__node`）——不引依赖、不做 JS 窗口化：
 *   JS 窗口需要把 Tree 的嵌套 group 结构切片，会破坏键盘漫游与 aria 语义（取舍登记在 RW-13 报告）。
 */
import {
  type Command,
  findPage,
  getAncestors,
  layerTree,
  type NodeId,
  type ScenePage,
} from '@dforge/engine';
import { EmptyState, ErrorState, Skeleton, Tree } from '@dforge/ui';
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { t } from '@/i18n';
import { moveLayerCommands, renameLayerCommands } from '../commands/layer-commands';
import { resolveTreeDropPlacement } from '../commands/tree-drop';
import { usePanelsDocument, usePanelsUi } from '../state/hooks';
import { LayerContextMenu } from './LayerContextMenu';
import { layerTypeIcon } from './layer-icons';
import { buildTreeModel, type PanelTreeModel } from './layers-tree-model';
import { usePanelsSession } from './panels-context';

import '../editor-panels.css';

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

  const page = findPage(doc, session.pageId);
  const model = useMemo<PanelTreeModel>(
    () => buildTreeModel(page === undefined ? [] : layerTree(page)),
    [page],
  );
  // Tree 受控展开集 = 全部容器 − 折叠集（面板 store 持「折叠」语义，Figma 默认全展开）
  const expandedIds = useMemo(
    () => model.containerIds.filter((id) => !collapsedIds.has(id)),
    [model, collapsedIds],
  );

  const treeRef = useRef<HTMLDivElement | null>(null);
  /** 拖拽期间自记的指针 Y（document dragover；drop 时与 target 行矩形合成落点证据）。 */
  const lastDragY = useRef<number | null>(null);
  const [menu, setMenu] = useState<{ rowId: NodeId; x: number; y: number } | null>(null);

  const run = useCallback(
    (commands: Command[], labelKey: string) => {
      if (commands.length === 0) return;
      session.run(commands, t(labelKey));
    },
    [session],
  );

  /** 取最新页面（写操作必须基于最新文档构造命令）。 */
  const currentPage = useCallback(
    (): ScenePage | undefined => findPage(session.stack.document, session.pageId),
    [session],
  );

  // 拖拽期间记录指针 Y（HTML5 drag 事件冒泡到 document；Tree 行内的 preventDefault 不阻断冒泡）。
  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      // 合成事件（测试环境）可能没有坐标——只记录有效数值，缺省时落位按「之前」降级
      if (typeof event.clientY === 'number') lastDragY.current = event.clientY;
    };
    const onDragStart = (): void => {
      lastDragY.current = null;
    };
    document.addEventListener('dragstart', onDragStart);
    document.addEventListener('dragover', onDragOver);
    return () => {
      document.removeEventListener('dragstart', onDragStart);
      document.removeEventListener('dragover', onDragOver);
    };
  }, []);

  // 画布选中 → 面板定位（一）：折叠的祖先链自动展开（让画布选中的节点可见）
  const activeId = selection.activeId;
  useEffect(() => {
    if (activeId === null) return;
    const current = currentPage();
    if (current === undefined) return;
    const ui = session.ui.getState();
    for (const ancestor of getAncestors(current, activeId)) {
      if (ui.collapsedIds.has(ancestor)) ui.toggleCollapsed(ancestor);
    }
  }, [activeId, currentPage, session]);

  // 画布选中 → 面板定位（二）：选中行滚动进可视区（nearest：已可见则不动；展开后行存在再滚）
  useEffect(() => {
    if (activeId === null) return;
    const rowElement = treeRef.current?.querySelector(`[data-node-id="${activeId}"]`) ?? null;
    if (rowElement === null) return;
    if (typeof rowElement.scrollIntoView !== 'function') return;
    rowElement.scrollIntoView({ block: 'nearest' });
  }, [activeId, collapsedIds]);

  const onSelect = useCallback(
    (id: string) => {
      session.ui.getState().selectLayer(id as NodeId);
    },
    [session],
  );

  const onExpandedChange = useCallback(
    (ids: string[]) => {
      // Tree 一次只开合一个节点：与当前展开集做差，把差量折算回「折叠集」的翻转
      const ui = session.ui.getState();
      const nextSet = new Set(ids);
      const added = ids.find((id) => !expandedIds.includes(id));
      const removed = expandedIds.find((id) => !nextSet.has(id));
      if (added !== undefined) ui.toggleCollapsed(added as NodeId);
      else if (removed !== undefined) ui.toggleCollapsed(removed as NodeId);
    },
    [expandedIds, session],
  );

  const onRename = useCallback(
    (id: string, label: string) => {
      const current = currentPage();
      if (current === undefined) return;
      run(renameLayerCommands(current, session.pageId, id as NodeId, label), 'panels.history.rename');
    },
    [currentPage, run, session],
  );

  const onReorder = useCallback(
    (sourceId: string, targetId: string) => {
      const current = currentPage();
      if (current === undefined) return;
      // 落位证据：自记的指针 Y + target 行矩形（jsdom 无布局时矩形为 0，降级按「之前」）
      const rowElement = treeRef.current?.querySelector(`[data-node-id="${targetId}"]`) ?? null;
      const rect = rowElement?.getBoundingClientRect();
      const pointer =
        rect !== undefined && rect.bottom > rect.top && lastDragY.current !== null
          ? { y: lastDragY.current, rowTop: rect.top, rowBottom: rect.bottom }
          : null;
      const placement = resolveTreeDropPlacement(
        current,
        sourceId as NodeId,
        targetId as NodeId,
        pointer,
      );
      if (placement === null) return;
      run(
        moveLayerCommands(current, session.pageId, sourceId as NodeId, placement.parentId, placement.index),
        'panels.history.move',
      );
    },
    [currentPage, run, session],
  );

  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // Tree 行带 data-node-id：右键命中行即出菜单；未选中的行先选上（Figma 语义）
      const hit = (event.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
      const id = hit?.dataset['nodeId'];
      if (id === undefined) return;
      event.preventDefault();
      const ui = session.ui.getState();
      if (!ui.selection.ids.includes(id)) ui.selectLayer(id as NodeId);
      setMenu({ rowId: id as NodeId, x: event.clientX, y: event.clientY });
    },
    [session],
  );

  const emptyContent: ReactNode = (
    <div data-df-sample="layers/empty">
      <EmptyState title={t('panels.layers.empty.title')} description={t('panels.layers.empty.desc')} />
    </div>
  );

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
      ) : (
        <div
          ref={treeRef}
          data-df-layer-count={model.totalCount}
          className="dfg-panels__body dfg-panels__tree"
          onContextMenu={onContextMenu}
        >
          <Tree
            label={t('panels.layers.tree.label')}
            nodes={model.nodes}
            selectedId={activeId}
            onSelect={onSelect}
            expandedIds={expandedIds}
            onExpandedChange={onExpandedChange}
            onRename={onRename}
            onReorder={onReorder}
            emptyContent={emptyContent}
          />
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
