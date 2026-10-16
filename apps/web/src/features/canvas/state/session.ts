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
  panDelta,
  parseClipboard,
  pasteCommands,
  reorderNodeCommands,
  resolveNode,
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
  /** 视口尺寸（CSS 像素；缩放档位/适应画布/覆盖层定位共用）。 */
  viewportSize: { width: number; height: number };
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

/**
 * 选择集端口（跨票同源用）。
 *
 * 编辑器工作区里选择集的宿主是 FE-04 的面板 UI store（图层面板要读它高亮）；
 * 画布把选择读写委托给它，就得到「画布选中 = 面板高亮」的同源联动，
 * 而不需要两处各存一份再互相同步。
 */
export interface SelectionPort {
  get(): Selection;
  set(selection: Selection): void;
  subscribe(listener: () => void): () => void;
}

/** 会话构造选项。 */
export interface CanvasSessionOptions {
  /**
   * 现成命令栈（**文档真值共享**）：编辑器工作区把 FE-04 面板会话的命令栈注入进来，
   * 使画布与面板读写同一份文档；省略则自建（画布可独立运行，`/_canvas` 与单测走这条）。
   */
  stack?: CommandStack;
  /** 文档（未注入 `stack` 时用它建栈；注入时必须与栈内文档一致）。 */
  document: DesignDocument;
  /** 选择集端口（缺省：选择集只住在画布会话里）。 */
  selectionPort?: SelectionPort;
  pageId?: PageId;
  viewport?: Viewport;
  ids?: IdFactory;
  /** 自建命令栈时的选项（注入现成 `stack` 时忽略）。 */
  stackOptions?: CommandStackOptions;
  clipboard?: ClipboardPort;
  rulers?: boolean;
  /** 吸附开关（默认开；测试与「自由定位」场景可关）。 */
  snapEnabled?: boolean;
  /** 视口变化回调（编辑器壳的缩放菜单/状态栏跟随；`_canvas` 宿主不需要）。 */
  onViewportChange?: (viewport: Viewport) => void;
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
  /** 适应画布（尺寸缺省取最近一次 resize 写入的视口尺寸）。 */
  zoomToFit(screenSize?: { width: number; height: number }): void;
  /** 缩放至 100%（以视口中心为锚点）。 */
  zoom100(screenSize?: { width: number; height: number }): void;
  /** 记录视口尺寸（CanvasStage 在 resize 时调用）。 */
  setViewportSize(size: { width: number; height: number }): void;

  beginTextEditing(nodeId: NodeId, options?: { selectAll?: boolean }): void;
  /** 覆盖层整段替换（DOM 缓冲 → 引擎会话；保留排版属性）。 */
  replaceEditingContent(characters: string, selection: { start: number; end: number }): void;
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
  const stack = options.stack ?? new CommandStack(options.document, options.stackOptions ?? {});
  const initialPageId = (options.document.pages[0] as ScenePage).id;
  const clipboardPort = options.clipboard;

  /** 内部剪贴板载荷（系统剪贴板不可用时的兜底；同实例内 ⌘C→⌘V 始终可用）。 */
  let clipboardPayload: ClipboardPayload | null = null;

  /** 视口变化 → 通知宿主（缩放菜单/状态栏跟随）。 */
  const emitViewport = (): void => {
    options.onViewportChange?.(store.getState().viewport);
  };

  const store = createStore<CanvasUiState>(() => ({
    pageId: options.pageId ?? initialPageId,
    selection: options.selectionPort?.get() ?? createSelection([]),
    viewport: options.viewport ?? createViewport(1, 0, 0),
    tool: 'select',
    spacePressed: false,
    interaction: IDLE,
    snap: null,
    hoverId: null,
    hoverCursor: 'default',
    draft: null,
    viewportSize: { width: 0, height: 0 },
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
    const next =
      normalized.length === input.ids.length
        ? input
        : (() => {
            const activeId =
              input.activeId !== null && normalized.includes(input.activeId)
                ? input.activeId
                : undefined;
            return activeId === undefined
              ? createSelection(normalized)
              : createSelection(normalized, activeId);
          })();
    store.setState({ selection: next });
    // 同源回写：选择集的真源在宿主（编辑器工作区 = FE-04 面板 UI store）
    options.selectionPort?.set(next);
  };

  // 端口 → 画布：宿主的其它入口（图层面板点击等）改选择时同步进来
  if (options.selectionPort !== undefined) {
    const port = options.selectionPort;
    port.subscribe(() => {
      const incoming = port.get();
      const current = store.getState().selection;
      if (
        incoming.ids.length === current.ids.length &&
        incoming.ids.every((id, index) => id === current.ids[index]) &&
        incoming.activeId === current.activeId
      ) {
        return;
      }
      store.setState({ selection: incoming });
    });
  }

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

  /** 只保留合法的节点 id（外部调用方可能传脏值；引擎的解析函数不容忍 undefined）。 */
  const saneIds = (values: readonly NodeId[]): NodeId[] =>
    values.filter((value) => typeof value === 'string' && value.length > 0);

  /** 记录可观测错误（覆盖层/门禁/调试句柄都读它；**不吞静默**）。 */
  const reportError = (error: unknown): void => {
    store.setState({ error: errorText(error) });
  };

  /**
   * 按**文档真值**修剪 id 集合：剔除已不存在的节点。
   *
   * 为什么需要：撤销/重做、删除、外部 actor（MCP/AI/面板）都会让选择集里的 id 指向
   * 幽灵节点；引擎的「按 id 移动/变换」命令对不存在的节点是**结构化错误**（CommandError），
   * 一旦下发就会从 `session.nudge` / 事件处理器里逃逸出去（一因两果）。
   * 所有会产出文档写入的入口统一先在这里对账：失效 id 不参与运算。
   */
  const liveIdsOf = (values: readonly NodeId[]): NodeId[] => {
    const current = page();
    return values.filter((id) => resolveNode(current, id) !== undefined);
  };

  /** 选择集的有效子集（派生视图/命令生成共用；失效 id 自动收敛，不写回 UI 态）。 */
  const liveSelectionIds = (): NodeId[] => liveIdsOf(store.getState().selection.ids);

  /**
   * 交互状态 ⇄ 文档真值对账：拖动途中节点可能被撤销/删除（⌘Z、外部 actor）。
   * 剔除失效节点，节点全没了 → 回到空闲态（松手不再产出指向幽灵节点的命令）。
   * 预览/提交/吸附随后都只看存活节点，得到「不抛错 + 不留半成品命令」的一致结果。
   */
  const reconcileInteraction = (interaction: InteractionState): InteractionState => {
    switch (interaction.kind) {
      case 'move':
      case 'resize':
      case 'rotate': {
        const alive = liveIdsOf(interaction.nodeIds);
        if (alive.length === interaction.nodeIds.length) return interaction;
        if (alive.length === 0) return IDLE;
        return { ...interaction, nodeIds: alive };
      }
      default:
        return interaction;
    }
  };

  /**
   * 命令下发**唯一守卫**：异常不得逃逸出会话。
   *
   * 引擎的 CommandError 是结构化失败（应当被上层看见），但 UI 层的种子是「事件处理器里
   * 冒泡出去 = 整棵树崩掉」——所以统一在这里转成会话错误态（可观测）+ 交互回到一致态。
   * 注意：这是**兜底**，不是主要手段：调用点仍先用 `liveSelectionIds()` 做根因修剪。
   */
  const dispatchGuarded = (commands: readonly Command[], label: string): boolean => {
    if (commands.length === 0) return false;
    try {
      stack.dispatch(commands, { label });
      return true;
    } catch (error) {
      reportError(error);
      store.setState({ interaction: IDLE, snap: null, draft: null, hud: null });
      return false;
    }
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
      const ids = saneIds(selectionIds);
      applySelection(
        activeId === undefined ? createSelection(ids) : createSelection(ids, activeId),
      );
    },
    addNodeToSelection(id) {
      if (typeof id !== 'string' || id.length === 0) return;
      applySelection(addToSelection(store.getState().selection, id));
    },
    selectAll() {
      applySelection(createSelection([...page().rootIds]));
    },
    clearSelection() {
      store.setState({ selection: createSelection([]) });
      options.selectionPort?.set(createSelection([]));
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
              selection: liveSelectionIds(),
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
            // 只把**文档真值里仍存在**的 id 交给交互机：失效 id 不得进入移动/缩放/旋转集合
            selection: liveSelectionIds(),
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

      // 拖动途中节点被撤销/删除 → 交互集合按文档真值收敛（不再计算/提交幽灵节点）
      const interaction = reconcileInteraction(state.interaction);
      if (interaction !== state.interaction) {
        store.setState({ interaction, snap: null, hud: null });
        if (interaction.kind === 'idle') return;
      }

      // 画布平移（白名单第 6 类）：拖动中**实时**移动视口
      if (interaction.kind === 'pan') {
        const delta = panDelta({ ...interaction, currentScreen: input.screen });
        store.setState({
          viewport: panBy(state.viewport, delta.x, delta.y),
          interaction: {
            ...interaction,
            startScreen: input.screen,
            currentScreen: input.screen,
          },
        });
        emitViewport();
        return;
      }

      if (interaction.kind === 'idle') {
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
        interaction,
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

      // 松手前同样对账：节点可能在拖动途中消失（⌘Z / 外部删除）
      const interaction = reconcileInteraction(state.interaction);
      if (interaction !== state.interaction) {
        store.setState({ interaction, snap: null, hud: null });
      }
      if (interaction.kind === 'idle') return;

      const settled = updateInteraction(
        interaction,
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
      dispatchGuarded(commands, labelOfInteraction(settled));
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
        emitViewport();
        return;
      }
      store.setState({ viewport: panBy(state.viewport, -input.deltaX, -input.deltaY) });
      emitViewport();
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
      const ids = liveSelectionIds();
      if (ids.length === 0) return;
      clipboardPayload = copyNodes(current, current.id, ids);
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
      if (!dispatchGuarded(commands, '粘贴')) return;
      const inserted: NodeId[] = [];
      for (const command of commands) {
        if (command.type === 'node.insert') inserted.push(command.node.id);
      }
      if (inserted.length > 0) applySelection(createSelection(inserted));
    },

    duplicate() {
      const current = page();
      const live = liveSelectionIds();
      if (live.length === 0) return;
      const commands = duplicateCommands(current, current.id, live, { ids });
      if (commands.length === 0) return;
      dispatchGuarded(commands, '副本');
    },

    reorder(op) {
      const state = store.getState();
      const current = page();
      const commands: Command[] = [];
      for (const id of liveSelectionIds()) {
        if (current.nodes[id] === undefined) continue;
        commands.push(...reorderNodeCommands(state.pageId, id, op));
      }
      if (commands.length === 0) return;
      dispatchGuarded(commands, '层级调整');
    },

    group() {
      const state = store.getState();
      const current = page();
      const live = liveSelectionIds();
      if (live.length < 2) return;
      try {
        const commands = groupNodesCommands(current, state.pageId, live, { ids });
        if (commands.length === 0) return;
        if (!dispatchGuarded(commands, '编组')) return;
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
      for (const id of liveSelectionIds()) {
        const node = current.nodes[id];
        if (node === undefined || node.type !== 'group') continue;
        commands.push(...dissolveGroupCommands(current, state.pageId, id));
        released.push(...node.children);
      }
      if (commands.length === 0) return;
      if (!dispatchGuarded(commands, '解组')) return;
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
      const live = liveSelectionIds();
      if (live.length === 0) return;
      const commands = deleteNodesCommands(page(), state.pageId, live);
      if (commands.length === 0) return;
      dispatchGuarded(commands, '删除');
      applySelection(createSelection([]));
    },

    align(op, relativeTo = 'selection') {
      const state = store.getState();
      const live = liveSelectionIds();
      if (live.length === 0) return;
      if (relativeTo === 'selection' && live.length < 2) return;
      try {
        const commands = alignCommands(page(), state.pageId, live, op, {
          relativeTo,
        });
        if (commands.length === 0) return;
        dispatchGuarded(commands, '对齐');
      } catch (error) {
        session.setError(errorText(error));
      }
    },

    distribute(op) {
      const state = store.getState();
      const live = liveSelectionIds();
      if (live.length < 3) return;
      const commands = distributeCommands(page(), state.pageId, live, op);
      if (commands.length === 0) return;
      dispatchGuarded(commands, '分布');
    },

    nudge(dx, dy) {
      const state = store.getState();
      // 失效选择（撤销后的幽灵 id）不参与微移：按文档真值修剪，剩余为空即空操作
      const live = liveSelectionIds();
      if (live.length === 0 || (dx === 0 && dy === 0)) return;
      const commands = moveNodesByWorldCommands(page(), state.pageId, live, {
        x: dx,
        y: dy,
      });
      if (commands.length === 0) return;
      dispatchGuarded(commands, '微移');
    },

    zoomIn(screenCenter) {
      store.setState({ viewport: zoomStep(store.getState().viewport, 1, screenCenter) });
      emitViewport();
    },
    zoomOut(screenCenter) {
      store.setState({ viewport: zoomStep(store.getState().viewport, -1, screenCenter) });
      emitViewport();
    },
    zoomToFit(screenSize) {
      const size = screenSize ?? store.getState().viewportSize;
      store.setState({
        // padding 是世界单位留白（几何参数，非 UI 间距令牌）
        viewport: fitBounds(pageBounds(page()), size, { padding: 40, maxZoom: 1 }), // guard-tokens:allow 画布留白为世界单位
      });
      emitViewport();
    },
    zoom100(screenSize) {
      const size = screenSize ?? store.getState().viewportSize;
      store.setState({ viewport: zoomTo100(store.getState().viewport, size) });
      emitViewport();
    },
    setViewportSize(size) {
      store.setState({ viewportSize: size });
      emitViewport();
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
    replaceEditingContent(characters, selection) {
      const editing = store.getState().editing;
      if (editing === null) return;
      // 整段替换：引擎的 insertText 接受 TextContent（保留排版属性），再校正选区
      const replaced = insertText(editing, { ...editing.content, characters });
      store.setState({ editing: setTextSelection(replaced, selection) });
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
      // 编辑中的文本节点可能已被撤销/删除：节点不在了就直接收摊（不进历史、不抛错）
      if (resolveNode(page(), editing.nodeId) === undefined) {
        store.setState({ editing: null });
        return;
      }
      const commands = commitTextEdit(editing);
      if (commands.length > 0) dispatchGuarded(commands, '文本');
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
        // 渲染消费**有效选择集**：撤销/删除留下的幽灵 id 不画高亮框（选择集自动收敛）
        selection: liveSelectionIds(),
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
