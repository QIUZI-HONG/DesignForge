/**
 * 画布会话（Canvas Session）——**引擎与 UI 之间唯一的桥**。
 *
 * 职责边界（`_shared.md` §3 状态边界）：
 * - **文档真值**在 `CommandStack`（引擎）：写操作一律经 `dispatch(commands)`，会话从不直接改文档；
 * - **UI 态**在 zustand 的 vanilla store（视口/选择/工具/交互态/悬停/文本编辑会话/HUD）；
 * - 指针与键盘的**编辑语义**全部复用引擎（`interaction/`、`selection/`、`commands/helpers`），
 *   本模块不重写任何编辑数学——只做「取引擎状态 → 改 UI 态 → 把命令交给命令栈」。
 *
 * 与 React 的关系：会话不依赖 React（可在 vitest/node 中直接驱动）；
 * React 侧用 `useStore(session.store, selector)` 订阅 UI 态、用 `useSyncExternalStore` 订阅文档。
 */

import type {
  Command,
  DesignDocument,
  IdFactory,
  InteractionContext,
  InteractionState,
  Modifiers,
  NodeId,
  PageId,
  Point,
  Rect,
  SceneNode,
  ScenePage,
  Selection,
  SnapResult,
  TextEditSession,
  Viewport,
  ZOrderOp,
} from '@dforge/engine';
import {
  addToSelection,
  alignCommands,
  backspace,
  beginInteraction,
  beginTextEdit,
  type ClipboardPayload,
  CommandStack,
  type CommandStackOptions,
  cancelInteraction,
  clickSelection,
  commitInteraction,
  commitTextEdit,
  copyNodes,
  createEllipse,
  createFrame,
  createRect,
  createSelection,
  createText,
  createViewport,
  deleteForward,
  deleteNodesCommands,
  dissolveGroupCommands,
  distributeCommands,
  duplicateCommands,
  fitBounds,
  groupNodesCommands,
  ID_PREFIX,
  IDLE,
  type InsertNodeCommand,
  insertText,
  marqueeRect,
  marqueeSelectionOf,
  moveNodesByWorldCommands,
  normalizeNodeSelection,
  panBy,
  parseClipboard,
  pasteCommands,
  reorderNodeCommands,
  selectAllText,
  selectionBounds,
  selectionNodes,
  serializeClipboard,
  setTextSelection,
  systemIdFactory,
  updateInteraction,
  worldBoundsOfNodes,
  zoomByWheel,
  zoomStep,
  zoomTo100,
} from '@dforge/engine';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { clickTargetAt, type HandleHit, handleHitAt, marqueeHitIds } from '../input/hit';
import { EMPTY_PREVIEW, type PreviewPatches, previewPatchesOf, snapPreviewOf } from './preview';

/** 画布工具（引擎白名单的 `EditorTool` + 画布侧创建工具）。 */
export type CanvasTool = 'select' | 'hand' | 'rect' | 'ellipse' | 'text' | 'frame';

/** 创建类工具集合（拖画/点击创建）。 */
export const CREATION_TOOLS: readonly CanvasTool[] = ['rect', 'ellipse', 'text', 'frame'];

/** 指针按键（DOM 层 button 归一化后的口径）。 */
export type PointerButton = 'left' | 'middle' | 'right';

/** 会话 UI 态（全部是 UI 态；文档不在这里）。 */
export interface CanvasUiState {
  pageId: PageId;
  selection: Selection;
  viewport: Viewport;
  tool: CanvasTool;
  /** 空格键按下（临时手型：空格拖动画布）。 */
  spacePressed: boolean;
  interaction: InteractionState;
  /** 交互中的吸附结果（参考线/测量数据）。 */
  snap: SnapResult | null;
  hoverId: NodeId | null;
  /** 指针光标（由命中判定给出；DOM 层直接消费）。 */
  hoverCursor: string;
  /** 拖画草稿矩形（世界坐标；创建工具用）。 */
  draft: Rect | null;
  /** 标尺显隐（C8）。 */
  rulers: boolean;
  /** 吸附开关（C8 吸附可关；默认开）。 */
  snapEnabled: boolean;
  /** 文本内联编辑会话（C10；DOM 覆盖层消费）。 */
  editing: TextEditSession | null;
  /** HUD 文案（C20；FE-03 未落地时的内部实现）。 */
  hud: string | null;
  /** 最近一次错误（渲染/操作失败；界面据此提示）。 */
  error: string | null;
}

/** 剪贴板端口（系统剪贴板；测试注入替身）。 */
export interface ClipboardPort {
  write(text: string): Promise<void>;
  read(): Promise<string | null>;
}

/** 会话构造选项。 */
export interface CanvasSessionOptions {
  document: DesignDocument;
  pageId?: PageId;
  viewport?: Viewport;
  ids?: IdFactory;
  stack?: CommandStackOptions;
  clipboard?: ClipboardPort;
  rulers?: boolean;
  /** 吸附开关（默认开；测试与「自由定位」场景可关）。 */
  snapEnabled?: boolean;
}

/** 指针按下输入（DOM 无关）。 */
export interface PointerDownInput {
  world: Point;
  screen: Point;
  button: PointerButton;
  modifiers?: Modifiers;
  /** 穿透选择（⌘/Ctrl 点击 = 选中最深节点，Figma 手感）。 */
  deep?: boolean;
}

/** 指针移动/松开输入。 */
export interface PointerMoveInput {
  world: Point;
  screen: Point;
  modifiers?: Modifiers;
}

/** 滚轮输入。 */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  /** 缩放修饰键（⌘/Ctrl + 滚轮 = 缩放；否则平移）。 */
  zoom?: boolean;
  screen: Point;
}

/** 一帧渲染输入（palette/字体由组件补齐）。 */
export interface SessionFrameInput {
  page: ScenePage;
  viewport: Viewport;
  selection: readonly NodeId[];
  hoverId: NodeId | null;
  interaction: InteractionState;
  preview: PreviewPatches;
  marquee: Rect | null;
  draft: Rect | null;
  rulers: boolean;
  editing: TextEditSession | null;
}

/** 画布会话。 */
export interface CanvasSession {
  readonly stack: CommandStack;
  readonly store: StoreApi<CanvasUiState>;
  readonly ids: IdFactory;

  page(): ScenePage;
  document(): DesignDocument;
  selection(): Selection;
  viewport(): Viewport;
  selectionBounds(): Rect | null;
  selectedNodes(): SceneNode[];
  context(): InteractionContext;
  preview(): PreviewPatches;
  marquee(): Rect | null;

  setSelection(ids: readonly NodeId[], activeId?: NodeId): void;
  addNodeToSelection(id: NodeId): void;
  selectAll(): void;
  clearSelection(): void;
  singleSelectionId(): NodeId | null;

  pointerDown(input: PointerDownInput): void;
  pointerMove(input: PointerMoveInput): void;
  pointerUp(input: PointerMoveInput): void;
  doubleClick(input: PointerDownInput): void;
  cancelActiveInteraction(): void;
  wheel(input: WheelInput): void;

  setTool(tool: CanvasTool): void;
  setSpacePressed(pressed: boolean): void;
  setRulers(visible: boolean): void;
  /** 吸附开关（C8）。 */
  setSnapEnabled(enabled: boolean): void;

  copy(): void;
  paste(): Promise<void>;
  duplicate(): void;

  reorder(op: ZOrderOp): void;
  group(): void;
  ungroup(): void;
  undo(): void;
  redo(): void;
  deleteSelection(): void;
  align(op: AlignOpName, relativeTo?: 'selection' | 'parent'): void;
  distribute(op: 'horizontal' | 'vertical'): void;
  nudge(dx: number, dy: number): void;

  zoomIn(screenCenter: Point): void;
  zoomOut(screenCenter: Point): void;
  zoomToFit(screenSize: { width: number; height: number }): void;
  zoom100(screenSize: { width: number; height: number }): void;

  beginTextEditing(nodeId: NodeId, options?: { selectAll?: boolean }): void;
  insertTextAtCaret(text: string): void;
  deleteBackward(): void;
  deleteForwardAtCaret(): void;
  selectAllEditingText(): void;
  setEditingSelection(selection: { start: number; end: number }): void;
  commitText(): void;
  cancelText(): void;

  createRect(bounds: Rect): NodeId;
  createEllipse(bounds: Rect): NodeId;
  createTextAt(point: Point): NodeId;
  createFrameAt(bounds: Rect): NodeId;

  showHud(text: string): void;
  hideHud(): void;
  setError(message: string | null): void;

  frameInput(): SessionFrameInput;
}

/** 对齐操作名（与引擎 `AlignOp` 同集）。 */
export type AlignOpName = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** 拖画最小尺寸（小于该尺寸视为点空取消）。 */
const MIN_DRAFT_SIZE = 1;

/** 创建会话。 */
export function createCanvasSession(options: CanvasSessionOptions): CanvasSession {
  const ids: IdFactory = options.ids ?? systemIdFactory;
  const stack = new CommandStack(options.document, options.stack ?? {});
  const initialPageId = (options.document.pages[0] as ScenePage).id;
  const clipboardPort = options.clipboard;

  /** 内部剪贴板载荷（系统剪贴板不可用时的兜底；同实例内 ⌘C→⌘V 始终可用）。 */
  let clipboardPayload: ClipboardPayload | null = null;

  const store = createStore<CanvasUiState>(() => ({
    pageId: options.pageId ?? initialPageId,
    selection: createSelection([]),
    viewport: options.viewport ?? createViewport(1, 0, 0),
    tool: 'select',
    spacePressed: false,
    interaction: IDLE,
    snap: null,
    hoverId: null,
    hoverCursor: 'default',
    draft: null,
    rulers: options.rulers ?? true,
    snapEnabled: options.snapEnabled ?? true,
    editing: null,
    hud: null,
    error: null,
  }));

  const page = (): ScenePage => {
    const state = store.getState();
    const found = stack.getSnapshot().pages.find((candidate) => candidate.id === state.pageId);
    if (found === undefined) throw new Error(`页面不存在：${state.pageId}`);
    return found;
  };

  const context = (): InteractionContext => {
    const state = store.getState();
    const current = page();
    const ctx: InteractionContext = {
      page: current,
      pageId: state.pageId,
      zoom: state.viewport.zoom,
      snapEnabled: state.snapEnabled,
    };
    if (current.grid.snapToGrid) ctx.grid = { size: current.grid.size, snapToGrid: true };
    return ctx;
  };

  /** 选择集规约（父子同选 → 只留上层；失效 id 剔除）。 */
  const applySelection = (input: Selection): void => {
    const normalized = normalizeNodeSelection(page(), input.ids);
    if (normalized.length === input.ids.length) {
      store.setState({ selection: input });
      return;
    }
    const activeId =
      input.activeId !== null && normalized.includes(input.activeId) ? input.activeId : undefined;
    store.setState({
      selection:
        activeId === undefined
          ? createSelection(normalized)
          : createSelection(normalized, activeId),
    });
  };

  /** HUD 文案（拖动/缩放/旋转出现，松手消失；C20）。 */
  const hudFor = (interaction: InteractionState): string | null => {
    switch (interaction.kind) {
      case 'move': {
        const bounds = worldBoundsOfNodes(page(), interaction.nodeIds);
        if (bounds === null) return null;
        const x = round2(bounds.x + interaction.delta.x);
        const y = round2(bounds.y + interaction.delta.y);
        return `X ${x} · Y ${y}`;
      }
      case 'resize':
        return `${round2(interaction.nextBounds.width)} × ${round2(interaction.nextBounds.height)}`;
      case 'rotate':
        return `${round2(interaction.rotation)}°`;
      default:
        return null;
    }
  };

  const labelOfInteraction = (interaction: InteractionState): string => {
    switch (interaction.kind) {
      case 'move':
        return '移动';
      case 'resize':
        return '缩放';
      case 'rotate':
        return '旋转';
      default:
        return '编辑';
    }
  };

  /** 命中（手柄优先；无手柄时取点击目标）。 */
  const hitContext = (
    world: Point,
    deep: boolean,
  ): { handle: HandleHit | null; target: NodeId | null } => {
    const state = store.getState();
    const handle = handleHitAt(page(), state.selection.ids, world, state.viewport.zoom);
    if (handle !== null) return { handle, target: null };
    return { handle: null, target: clickTargetAt(page(), world, { deep }) };
  };

  /** 顶层插入节点并选中。 */
  const insertNode = (node: SceneNode, label = '新建'): NodeId => {
    const state = store.getState();
    const command: Command = {
      type: 'node.insert',
      pageId: state.pageId,
      node,
      parentId: null,
    };
    stack.dispatch([command], { label });
    applySelection(createSelection([node.id]));
    return node.id;
  };

  /** 拖画草稿 → 节点。 */
  const commitDraft = (draft: Rect): NodeId | null => {
    const normalized: Rect = {
      x: Math.min(draft.x, draft.x + draft.width),
      y: Math.min(draft.y, draft.y + draft.height),
      width: Math.abs(draft.width),
      height: Math.abs(draft.height),
    };
    if (normalized.width < MIN_DRAFT_SIZE && normalized.height < MIN_DRAFT_SIZE) return null;
    const state = store.getState();
    const bounds = {
      ...normalized,
      width: Math.max(1, normalized.width),
      height: Math.max(1, normalized.height),
    };
    if (state.tool === 'ellipse') return session.createEllipse(bounds);
    if (state.tool === 'frame') return session.createFrameAt(bounds);
    return session.createRect(bounds);
  };

  const session: CanvasSession = {
    stack,
    store,
    ids,

    page,
    document: () => stack.getSnapshot(),
    selection: () => store.getState().selection,
    viewport: () => store.getState().viewport,
    selectionBounds: () => selectionBounds(page(), store.getState().selection),
    selectedNodes: () => selectionNodes(page(), store.getState().selection),
    context,
    preview: () => previewPatchesOf(store.getState().interaction, context()),
    marquee: () => {
      const interaction = store.getState().interaction;
      return interaction.kind === 'marquee' ? marqueeRect(interaction) : null;
    },

    setSelection(selectionIds, activeId) {
      applySelection(
        activeId === undefined
          ? createSelection(selectionIds)
          : createSelection(selectionIds, activeId),
      );
    },
    addNodeToSelection(id) {
      applySelection(addToSelection(store.getState().selection, id));
    },
    selectAll() {
      applySelection(createSelection([...page().rootIds]));
    },
    clearSelection() {
      store.setState({ selection: createSelection([]) });
    },
    singleSelectionId() {
      const selection = store.getState().selection;
      return selection.ids.length === 1 ? (selection.ids[0] as NodeId) : null;
    },

    pointerDown(input) {
      const state = store.getState();
      if (state.editing !== null) return; // 文本编辑中由 DOM 覆盖层接管

      // 中键 / 空格 / 手型 → 画布平移（白名单第 5 类）
      if (input.button === 'middle' || state.spacePressed || state.tool === 'hand') {
        store.setState({
          interaction: beginInteraction(
            IDLE,
            {
              type: 'pointer.down',
              point: input.world,
              screen: input.screen,
              selection: state.selection.ids,
              clickTarget: null,
              handle: null,
              tool: 'hand',
            },
            context(),
          ),
          snap: null,
        });
        return;
      }
      if (input.button === 'right') return; // 右键菜单归 DOM 层（C11）

      // 创建工具：按下开始拖画（矩形/椭圆/画板）
      if (state.tool === 'rect' || state.tool === 'ellipse' || state.tool === 'frame') {
        store.setState({
          draft: { x: input.world.x, y: input.world.y, width: 0, height: 0 },
          interaction: IDLE,
          snap: null,
        });
        return;
      }
      if (state.tool === 'text') {
        const nodeId = session.createTextAt(input.world);
        store.setState({ tool: 'select' });
        session.beginTextEditing(nodeId, { selectAll: true });
        return;
      }

      const { handle, target } = hitContext(input.world, input.deep === true);

      // 选择更新（引擎规则：Shift 切换 / 点击已选保持集合 / 点空清空）
      if (handle === null) {
        applySelection(
          clickSelection(state.selection, target, {
            shift: input.modifiers?.shift === true,
            meta: input.modifiers?.meta === true,
          }),
        );
      }

      store.setState({
        interaction: beginInteraction(
          IDLE,
          {
            type: 'pointer.down',
            point: input.world,
            screen: input.screen,
            selection: store.getState().selection.ids,
            clickTarget: target,
            handle,
            tool: 'select',
            ...(input.modifiers === undefined ? {} : { modifiers: input.modifiers }),
          },
          context(),
        ),
        snap: null,
      });
    },

    pointerMove(input) {
      const state = store.getState();
      if (state.editing !== null) return;

      if (state.draft !== null) {
        store.setState({
          draft: {
            x: state.draft.x,
            y: state.draft.y,
            width: input.world.x - state.draft.x,
            height: input.world.y - state.draft.y,
          },
        });
        return;
      }

      if (state.interaction.kind === 'idle') {
        const { handle, target } = hitContext(input.world, false);
        const hoverId = handle === null ? target : null;
        const hoverCursor =
          handle === null
            ? target === null
              ? 'default'
              : 'move'
            : handle.mode === 'rotate'
              ? 'grab'
              : 'pointer';
        if (hoverId !== state.hoverId || hoverCursor !== state.hoverCursor) {
          store.setState({ hoverId, hoverCursor });
        }
        return;
      }

      const next = updateInteraction(
        state.interaction,
        {
          type: 'pointer.move',
          point: input.world,
          screen: input.screen,
          ...(input.modifiers === undefined ? {} : { modifiers: input.modifiers }),
        },
        context(),
      );
      store.setState({ interaction: next, snap: snapPreviewOf(next), hud: hudFor(next) });
    },

    pointerUp(input) {
      const state = store.getState();
      if (state.editing !== null) return;

      if (state.draft !== null) {
        commitDraft(state.draft);
        store.setState({ draft: null, tool: 'select', hud: null });
        return;
      }
      if (state.interaction.kind === 'idle') return;

      const settled = updateInteraction(
        state.interaction,
        {
          type: 'pointer.up',
          point: input.world,
          screen: input.screen,
          ...(input.modifiers === undefined ? {} : { modifiers: input.modifiers }),
        },
        context(),
      );

      // 框选结算（引擎 marqueeSelectionOf：交集命中 + Shift 追加）
      if (settled.kind === 'marquee') {
        const hits = marqueeSelectionOf(settled, context(), (p, rect) => marqueeHitIds(p, rect));
        if (hits.length > 0 || !settled.additive) applySelection(createSelection(hits));
        store.setState({ interaction: IDLE, snap: null, hud: null });
        return;
      }

      const { commands } = commitInteraction(settled, context());
      if (commands.length > 0) stack.dispatch(commands, { label: labelOfInteraction(settled) });
      store.setState({ interaction: IDLE, snap: null, hud: null });
    },

    doubleClick(input) {
      const state = store.getState();
      if (state.tool !== 'select' && state.tool !== 'hand') return;
      const deep = clickTargetAt(page(), input.world, { deep: true });
      if (deep === null) return;
      const node = page().nodes[deep];
      if (node !== undefined && node.type === 'text') {
        session.beginTextEditing(deep, { selectAll: true });
        return;
      }
      // 非文本：进入容器内部（选中被嵌套的深层对象）
      applySelection(createSelection([deep]));
    },

    cancelActiveInteraction() {
      const state = store.getState();
      if (state.editing !== null) {
        store.setState({ editing: null });
        return;
      }
      store.setState({
        interaction: cancelInteraction(state.interaction),
        snap: null,
        draft: null,
        hud: null,
      });
    },

    wheel(input) {
      const state = store.getState();
      if (state.editing !== null) return;
      if (input.zoom === true) {
        store.setState({ viewport: zoomByWheel(state.viewport, input.deltaY, input.screen) });
        return;
      }
      store.setState({ viewport: panBy(state.viewport, -input.deltaX, -input.deltaY) });
    },

    setTool(tool) {
      store.setState({ tool, draft: null, snap: null });
    },
    setSpacePressed(pressed) {
      store.setState({ spacePressed: pressed });
    },
    setRulers(visible) {
      store.setState({ rulers: visible });
    },
    setSnapEnabled(enabled) {
      store.setState({ snapEnabled: enabled });
    },

    copy() {
      const current = page();
      const selection = store.getState().selection;
      if (selection.ids.length === 0) return;
      clipboardPayload = copyNodes(current, current.id, selection.ids);
      if (clipboardPort !== undefined) {
        void clipboardPort.write(serializeClipboard(clipboardPayload)).catch(() => undefined);
      }
    },

    async paste() {
      let payload = clipboardPayload;
      if (clipboardPort !== undefined) {
        try {
          const text = await clipboardPort.read();
          if (payload === null && text !== null && text.length > 0) payload = parseClipboard(text);
        } catch {
          // 系统剪贴板不可用（无权限/无实现）：落回内部载荷
        }
      }
      if (payload === null) return;
      const commands = pasteCommands(payload, { pageId: store.getState().pageId, ids });
      if (commands.length === 0) return;
      stack.dispatch(commands, { label: '粘贴' });
      const inserted: NodeId[] = [];
      for (const command of commands) {
        if (command.type === 'node.insert') inserted.push(command.node.id);
      }
      if (inserted.length > 0) applySelection(createSelection(inserted));
    },

    duplicate() {
      const current = page();
      const selection = store.getState().selection;
      if (selection.ids.length === 0) return;
      const commands = duplicateCommands(current, current.id, selection.ids, { ids });
      if (commands.length === 0) return;
      stack.dispatch(commands, { label: '副本' });
    },

    reorder(op) {
      const state = store.getState();
      const current = page();
      const commands: Command[] = [];
      for (const id of state.selection.ids) {
        if (current.nodes[id] === undefined) continue;
        commands.push(...reorderNodeCommands(state.pageId, id, op));
      }
      if (commands.length === 0) return;
      stack.dispatch(commands, { label: '层级调整' });
    },

    group() {
      const state = store.getState();
      const current = page();
      if (state.selection.ids.length < 2) return;
      try {
        const commands = groupNodesCommands(current, state.pageId, state.selection.ids, { ids });
        if (commands.length === 0) return;
        stack.dispatch(commands, { label: '编组' });
        const inserted = commands.find(
          (command): command is InsertNodeCommand => command.type === 'node.insert',
        );
        if (inserted !== undefined) applySelection(createSelection([inserted.node.id]));
      } catch (error) {
        session.setError(errorText(error));
      }
    },

    ungroup() {
      const state = store.getState();
      const current = page();
      const commands: Command[] = [];
      const released: NodeId[] = [];
      for (const id of state.selection.ids) {
        const node = current.nodes[id];
        if (node === undefined || node.type !== 'group') continue;
        commands.push(...dissolveGroupCommands(current, state.pageId, id));
        released.push(...node.children);
      }
      if (commands.length === 0) return;
      stack.dispatch(commands, { label: '解组' });
      if (released.length > 0) applySelection(createSelection(released));
    },

    undo() {
      stack.undo();
    },
    redo() {
      stack.redo();
    },

    deleteSelection() {
      const state = store.getState();
      if (state.selection.ids.length === 0) return;
      const commands = deleteNodesCommands(page(), state.pageId, state.selection.ids);
      if (commands.length === 0) return;
      stack.dispatch(commands, { label: '删除' });
      applySelection(createSelection([]));
    },

    align(op, relativeTo = 'selection') {
      const state = store.getState();
      if (state.selection.ids.length === 0) return;
      if (relativeTo === 'selection' && state.selection.ids.length < 2) return;
      try {
        const commands = alignCommands(page(), state.pageId, state.selection.ids, op, {
          relativeTo,
        });
        if (commands.length === 0) return;
        stack.dispatch(commands, { label: '对齐' });
      } catch (error) {
        session.setError(errorText(error));
      }
    },

    distribute(op) {
      const state = store.getState();
      if (state.selection.ids.length < 3) return;
      const commands = distributeCommands(page(), state.pageId, state.selection.ids, op);
      if (commands.length === 0) return;
      stack.dispatch(commands, { label: '分布' });
    },

    nudge(dx, dy) {
      const state = store.getState();
      if (state.selection.ids.length === 0 || (dx === 0 && dy === 0)) return;
      const commands = moveNodesByWorldCommands(page(), state.pageId, state.selection.ids, {
        x: dx,
        y: dy,
      });
      if (commands.length === 0) return;
      stack.dispatch(commands, { label: '微移' });
    },

    zoomIn(screenCenter) {
      store.setState({ viewport: zoomStep(store.getState().viewport, 1, screenCenter) });
    },
    zoomOut(screenCenter) {
      store.setState({ viewport: zoomStep(store.getState().viewport, -1, screenCenter) });
    },
    zoomToFit(screenSize) {
      store.setState({
        viewport: fitBounds(pageBounds(page()), screenSize, { padding: 40, maxZoom: 1 }),
      });
    },
    zoom100(screenSize) {
      store.setState({ viewport: zoomTo100(store.getState().viewport, screenSize) });
    },

    beginTextEditing(nodeId, editOptions = {}) {
      const state = store.getState();
      try {
        store.setState({
          editing: beginTextEdit(page(), state.pageId, nodeId, editOptions),
          error: null,
        });
      } catch (error) {
        session.setError(errorText(error));
      }
    },
    insertTextAtCaret(text) {
      const editing = store.getState().editing;
      if (editing === null) return;
      store.setState({ editing: insertText(editing, text) });
    },
    deleteBackward() {
      const editing = store.getState().editing;
      if (editing === null) return;
      store.setState({ editing: backspace(editing) });
    },
    deleteForwardAtCaret() {
      const editing = store.getState().editing;
      if (editing === null) return;
      store.setState({ editing: deleteForward(editing) });
    },
    selectAllEditingText() {
      const editing = store.getState().editing;
      if (editing === null) return;
      store.setState({ editing: selectAllText(editing) });
    },
    setEditingSelection(selection) {
      const editing = store.getState().editing;
      if (editing === null) return;
      store.setState({ editing: setTextSelection(editing, selection) });
    },
    commitText() {
      const editing = store.getState().editing;
      if (editing === null) return;
      const commands = commitTextEdit(editing);
      if (commands.length > 0) stack.dispatch(commands, { label: '文本' });
      store.setState({ editing: null });
    },
    cancelText() {
      store.setState({ editing: null });
    },

    createRect(bounds) {
      return insertNode(
        createRect({
          id: ids.next(ID_PREFIX.node),
          x: bounds.x,
          y: bounds.y,
          width: Math.max(1, bounds.width),
          height: Math.max(1, bounds.height),
        }),
      );
    },
    createEllipse(bounds) {
      return insertNode(
        createEllipse({
          id: ids.next(ID_PREFIX.node),
          x: bounds.x,
          y: bounds.y,
          width: Math.max(1, bounds.width),
          height: Math.max(1, bounds.height),
        }),
      );
    },
    createTextAt(point) {
      return insertNode(
        createText({
          id: ids.next(ID_PREFIX.node),
          x: point.x,
          y: point.y,
          width: 120,
          height: 20,
        }),
      );
    },
    createFrameAt(bounds) {
      return insertNode(
        createFrame({
          id: ids.next(ID_PREFIX.frame),
          x: bounds.x,
          y: bounds.y,
          width: Math.max(1, bounds.width),
          height: Math.max(1, bounds.height),
        }),
      );
    },

    showHud(text) {
      store.setState({ hud: text });
    },
    hideHud() {
      store.setState({ hud: null });
    },
    setError(message) {
      store.setState({ error: message });
    },

    frameInput() {
      const state = store.getState();
      return {
        page: page(),
        viewport: state.viewport,
        selection: state.selection.ids,
        hoverId: state.hoverId,
        interaction: state.interaction,
        preview: previewPatchesOf(state.interaction, context()),
        marquee: state.interaction.kind === 'marquee' ? marqueeRect(state.interaction) : null,
        draft: state.draft,
        rulers: state.rulers,
        editing: state.editing,
      };
    },
  };

  return session;
}

/** 页面顶层对象的世界包围盒（适应画布用）。 */
function pageBounds(page: ScenePage): Rect {
  return worldBoundsOfNodes(page, page.rootIds) ?? { x: 0, y: 0, width: 100, height: 100 };
}

/** 错误文本。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 两位小数。 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export { EMPTY_PREVIEW };
