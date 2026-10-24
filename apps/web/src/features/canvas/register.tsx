'use client';

/**
 * 编辑器工作区**接线模块**（FE-06 作为 `/editor` 宿主；工单 02 引导收口后的形状）。
 *
 * 由编辑器唯一客户端引导件 `app/editor/editor-bootstrap.tsx` import（其声明式注册表
 * 声明 `mountEditorWorkspace` 为 FE-06 登记项，渲染引导件即把本模块拉进客户端图）。
 * 本模块负责：
 *
 * 1. **命令注册**：接管 FE-03 预留的 `view.zoomFit` / `edit.undo` / `edit.redo` /
 *    `file.new` / `file.export`（修复批次 4 · D-7：死入口注册实现），注册 `view.ai`
 *    （D-6：AI 抽屉唯一入口命令），并覆盖 `view.zoomIn|zoomOut|zoom100`（让 ⌘±/⌘0
 *    直接驱动**引擎视口**，外壳缩放菜单跟随）；
 * 2. **显示态同步与门禁挂点**：视口/工具/文档名 → 外壳的单向投影、FE-05 的
 *    `window.__dfInspectorProbe`（历史 + 节点属性读点）、`window.__dfWorkspaceProbe`；
 * 3. **插槽渲染件**：声明表按 id/order 引用 `./workspace/slots` 的槽组件（挂载声明
 *    不再在本模块——插槽挂载统一声明在引导注册表，工单 02）。
 *
 * 为什么注册在挂载后（引导 effect）执行而不是模块顶层：`'use client'` 模块在服务端
 * 渲染时只产出 client reference，顶层注册会造成「服务端空槽 / 客户端有槽」的
 * hydration 不匹配（整棵树停在空槽形态）；引导统一在 effect 里注册，服务端/客户端
 * 首帧一致（服务端空槽形态 = 客户端首帧形态）。
 */

import {
  RESERVED_COMMAND_IDS,
  registerCommand,
  useEditorUi,
  useEditorView,
} from '@/features/editor-shell';
import { t } from '@/i18n';
import { withDaemonEndpoint } from '@/lib/daemon-endpoint';

import { SAVE_DOCUMENT_COMMAND_ID } from './workspace/document-bridge';
import { connectToolSync, registerWorkspaceToolCommands } from './workspace/tool-bridge';
import { useWorkspaceUi } from './workspace/ui-state';

import {
  type EditorWorkspace,
  ensureWorkspaceBootstrapped,
  getWorkspace,
  readDocumentId,
  setWorkspaceBootstrap,
} from './workspace/workspace-session';

/**
 * 一次性入口锁（查询串入口 / 文档载入）——**每个工作区实例一份**（复核 J1 修）。
 *
 * 缺陷现场：两个锁曾是模块级布尔且从不清空——`resetWorkspace()` 后不复位，
 * SPA 导航「首页→文档 A→首页→文档 B」时 B 的 `?documentId=` 不再被读，编辑器停在 A。
 * 现挂在单体上（WeakMap 随实例）：单体被替换/复位（`setWorkspace` / `resetWorkspace`）即作废。
 */
interface EntryLocks {
  /** 查询串入口是否已应用（同一单体只应用一次）。 */
  queryEntryPointsApplied: boolean;
  /** 已请求载入的文档 id（null = 尚未请求；同 id 去重、换 id 重新载入）。 */
  documentLoadRequested: string | null;
}

const entryLocks = new WeakMap<EditorWorkspace, EntryLocks>();

/** 取（必要时创建）单体对应的锁。 */
function locksOf(workspace: EditorWorkspace): EntryLocks {
  let locks = entryLocks.get(workspace);
  if (locks === undefined) {
    locks = { queryEntryPointsApplied: false, documentLoadRequested: null };
    entryLocks.set(workspace, locks);
  }
  return locks;
}

/** 中枢屏幕尺寸（缩放锚点用画布区中心；取不到时退回视口尺寸）。 */
function viewportCenter(): { x: number; y: number } {
  const workspace = getWorkspace();
  const size = workspace.canvas.store.getState().viewportSize;
  return { x: size.width / 2, y: size.height / 2 };
}

/** 注册命令（幂等：同 id 重复注册只覆盖，不叠加）。 */
export function registerWorkspaceCommands(): void {
  const workspace = getWorkspace();
  const { canvas } = workspace;

  // 画布视口 → 外壳视图态（缩放菜单/状态栏跟随；一处真源）
  useEditorView.getState().setZoom(canvas.viewport().zoom);

  registerCommand({
    id: RESERVED_COMMAND_IDS.zoomFit,
    title: t('canvas.action.zoomFit'),
    group: t('editor.group.view'),
    shortcut: '⇧1',
    run: () => {
      canvas.zoomToFit();
    },
  });
  registerCommand({
    id: RESERVED_COMMAND_IDS.undo,
    title: t('canvas.action.undo'),
    group: t('editor.group.edit'),
    shortcut: '⌘Z',
    enabled: () => canvas.stack.canUndo,
    run: () => {
      canvas.undo();
    },
  });
  registerCommand({
    id: RESERVED_COMMAND_IDS.redo,
    title: t('canvas.action.redo'),
    group: t('editor.group.edit'),
    shortcut: '⇧⌘Z',
    enabled: () => canvas.stack.canRedo,
    run: () => {
      canvas.redo();
    },
  });
  // 覆盖壳层默认缩放实现（注册表 last wins）：⌘±/⌘0 作用于引擎视口
  registerCommand({
    id: 'view.zoomIn',
    title: t('canvas.action.zoomIn'),
    group: t('editor.group.view'),
    shortcut: '⌘+',
    run: () => {
      canvas.zoomIn(viewportCenter());
    },
  });
  registerCommand({
    id: 'view.zoomOut',
    title: t('canvas.action.zoomOut'),
    group: t('editor.group.view'),
    shortcut: '⌘-',
    run: () => {
      canvas.zoomOut(viewportCenter());
    },
  });
  registerCommand({
    id: 'view.zoom100',
    title: t('canvas.action.zoomReset'),
    group: t('editor.group.view'),
    shortcut: '⇧0',
    run: () => {
      canvas.zoom100();
    },
  });

  // 工具命令接管（D-1）：同 id 覆盖壳层默认实现，工具态落到**画布会话**（唯一真源）。
  // 覆盖后：工具栏/快捷键/命令面板三处入口同一条命令 → 会话切工具 → 外壳高亮经
  // `connectWorkspaceSync` 单向跟随（见 `workspace/tool-bridge.ts` 头注释）。
  registerWorkspaceToolCommands(workspace);

  // 保存命令（D-2）：顶栏按钮 / ⌘S / 命令面板三处同一命令；保存中置灰防重复提交。
  registerCommand({
    id: SAVE_DOCUMENT_COMMAND_ID,
    title: t('editor.action.save'),
    group: t('editor.group.file'),
    shortcut: '⌘S',
    enabled: () => workspace.documents.store.getState().status !== 'saving',
    run: () => {
      void workspace.documents.save();
    },
  });

  // AI 抽屉入口（D-6 / UX-10）：命令面板（视图组）与工具栏入口按钮共用这一条命令；
  // 开合状态写 `useWorkspaceUi`（命令的 run 是非 React 闭包，见 `workspace/ui-state.ts`）。
  // `pressed` + `subscribe` 让入口渲染 aria-pressed 并在状态变化时重取快照。
  registerCommand({
    id: AI_DRAWER_COMMAND_ID,
    title: t('ai.title'),
    group: t('editor.group.view'),
    pressed: () => useWorkspaceUi.getState().aiDrawerOpen,
    subscribe: (notify) => useWorkspaceUi.subscribe(() => notify()),
    run: () => {
      const ui = useWorkspaceUi.getState();
      ui.setAiDrawerOpen(!ui.aiDrawerOpen);
    },
  });

  // 导出…（D-7 死入口修复）：切到右栏「导出」页签（导出格式与落盘检查在页签内，
  // 未落盘时页签明确提示「先保存」，不给会失败的按钮）。
  registerCommand({
    id: RESERVED_COMMAND_IDS.exportFile,
    title: t('editor.menu.export'),
    group: t('editor.group.file'),
    run: () => {
      useWorkspaceUi.getState().setRightPanelTab('export');
    },
  });

  // 新建设计文件（D-7 死入口修复）：回到首页的新建入口（`?create=1` 自动打开新建对话框，
  // 创建流程与错误分因文案都在首页）；经 `withDaemonEndpoint` 续写当前端点参数（B 口径）。
  registerCommand({
    id: RESERVED_COMMAND_IDS.newFile,
    title: t('editor.menu.newFile'),
    group: t('editor.group.file'),
    run: () => {
      window.location.assign(newFileEntryHref());
    },
  });
}

/** AI 抽屉命令 id（命令面板 / 入口按钮 / 门禁共用一处定义）。 */
export const AI_DRAWER_COMMAND_ID = 'view.ai';

/**
 * `file.new` 的落点：首页新建入口（`/?create=1`，首页挂载后自动打开新建对话框）。
 * 经单点续写当前 daemon 端点参数（`@/lib/daemon-endpoint`，D-3/UX-01 口径）。
 */
export function newFileEntryHref(): string {
  return withDaemonEndpoint('/?create=1');
}

/**
 * 查询串驱动的入口（D2/D3）：`?shortcuts=1` 打开快捷键说明、`?ai=1` 打开 AI 抽屉。
 *
 * 用于站内跳转落地即达的场景（首页「键盘快捷键」→ 编辑器快捷键说明；首页「打开 AI 助手」
 * → 编辑器 AI 抽屉）。幂等只应用一次（同一工作区实例内）——见下方 `locksOf` 的锁口径。
 */
export function connectQueryEntryPoints(): void {
  if (typeof window === 'undefined') return;
  const locks = locksOf(getWorkspace());
  if (locks.queryEntryPointsApplied) return;
  locks.queryEntryPointsApplied = true;
  const params = new URLSearchParams(window.location.search);
  if (params.get('shortcuts') === '1') useEditorUi.getState().setShortcutsOpen(true);
  if (params.get('ai') === '1') useWorkspaceUi.getState().setAiDrawerOpen(true);
}

/**
 * 会话 → 外壳的显示态同步（画布是引擎真值的唯一持有者，外壳只做投影）：
 * - 视口缩放 → 缩放菜单/状态栏的百分比；
 * - 当前工具 → 工具条 active 高亮（拖画落节点后会话回选择工具，高亮必须跟着回）；
 * - 文档名 → 顶栏 `h1`（未落盘为 null → 占位「未命名设计文件」）。
 */
function connectWorkspaceSync(): () => void {
  const workspace = getWorkspace();
  const syncZoom = (): void => {
    useEditorView.getState().setZoom(workspace.canvas.viewport().zoom);
  };
  const syncDocumentName = (): void => {
    const state = workspace.documents.store.getState();
    useEditorView.getState().setDocumentName(state.documentId === null ? null : state.name);
  };
  syncZoom();
  syncDocumentName();
  const unsubscribeZoom = workspace.canvas.store.subscribe((state, previous) => {
    if (state.viewport.zoom !== (previous as typeof state).viewport.zoom) syncZoom();
  });
  const unsubscribeTool = connectToolSync(workspace);
  const unsubscribeDocument = workspace.documents.store.subscribe(syncDocumentName);
  return () => {
    unsubscribeZoom();
    unsubscribeTool();
    unsubscribeDocument();
  };
}

/**
 * 路由侧文档接线（D-2）：读 `?documentId=` 从 daemon 载入。
 *
 * 文档 id 来自首页卡片契约（`/editor?documentId=…`）。载入失败不静默：文档桥把原因
 * 落进保存态，顶栏可见。
 *
 * 去重口径（复核 J1 修）：锁**记已请求的文档 id**（不是布尔），且**随工作区实例持有**——
 * - 同一挂载里重复调用（bootstrap effect 与槽组件触发的引导各一次）不重复载入：同 id 去重；
 * - **导航到另一文档必须重新载入**（SPA「首页→文档 A→首页→文档 B」时单例与锁都活着，
 *   旧实现的模块级布尔会把 B 挡在门外——这就是「B 不载入」的现场）；
 * - `resetWorkspace()` / `setWorkspace(next)` 换掉单体时锁随之作废（WeakMap 随实例）。
 */
export function connectDocumentBridge(): void {
  const workspace = getWorkspace();
  const locks = locksOf(workspace);
  const documentId = readDocumentId(window.location.search);
  if (documentId === null || locks.documentLoadRequested === documentId) return;
  locks.documentLoadRequested = documentId;
  void workspace.documents.load(documentId);
}

/**
 * 工作区读点（跨票调试/门禁）：面板侧选择集 vs 画布侧选择集——
 * 两者必须始终一致（选择集同源），否则「画布选中 ≠ 面板高亮」。
 */
function installWorkspaceProbe(): () => void {
  const workspace = getWorkspace();
  (globalThis as Record<string, unknown>).__dfWorkspaceProbe = {
    panelsSelection: () => [...workspace.panels.ui.getState().selection.ids],
    canvasSelection: () => [...workspace.canvas.selection().ids],
    sameStore: () => workspace.panels.stack === workspace.canvas.stack,
  };
  return () => {
    delete (globalThis as Record<string, unknown>).__dfWorkspaceProbe;
  };
}

/** FE-05 门禁挂点：命令栈历史 + 节点属性读点。 */
function installInspectorProbe(): () => void {
  const workspace = getWorkspace();
  const probe = {
    undo: (): string[] => workspace.canvas.stack.history().undo,
    redo: (): string[] => workspace.canvas.stack.history().redo,
    node: (id: string): Record<string, unknown> | undefined => {
      const node = workspace.canvas.page().nodes[id];
      return node === undefined ? undefined : ({ ...node } as unknown as Record<string, unknown>);
    },
  };
  (globalThis as Record<string, unknown>).__dfInspectorProbe = probe;
  return () => {
    delete (globalThis as Record<string, unknown>).__dfInspectorProbe;
  };
}

/**
 * 工作区登记项（编辑器引导注册表声明执行；声明见 `app/editor/editor-bootstrap.tsx`）。
 *
 * 序列 = 原 `WorkspaceBootstrap` effect 体去掉插槽挂载（插槽挂载已收口到引导注册表）：
 * 命令注册 → 显示态同步 → 门禁探针 → 工作区一次性引导 → 文档桥 / 查询串入口。
 * 幂等：重复执行无副作用（注册表同 id 覆盖、探针重复赋同一形状、锁按工作区实例去重）。
 */
export function mountEditorWorkspace(): void {
  registerWorkspaceCommands();
  connectWorkspaceSync();
  installInspectorProbe();
  installWorkspaceProbe();
  ensureWorkspaceBootstrapped();
  connectDocumentBridge();
  connectQueryEntryPoints();
}

// 引导实现注入（`ensureWorkspaceBootstrapped` 由槽组件在挂载后调用）：命令/视口同步/门禁探针
// 生产路径上编辑器引导注册表已先行执行 `mountEditorWorkspace`，这里是「槽组件先于页面
// 引导挂载」时的兜底重挂（测试里直接渲染槽组件的路径也走这里）。
setWorkspaceBootstrap(() => {
  // 幂等：重复调用无副作用（注册表同 id 覆盖、探针重复赋值同一形状）
  registerWorkspaceCommands();
  connectWorkspaceSync();
  installInspectorProbe();
  installWorkspaceProbe();
  connectDocumentBridge();
  connectQueryEntryPoints();
});

/** 缩放百分比（供状态栏/调试）。 */
export function currentZoomLabel(): string {
  return `${String(Math.round(getWorkspace().canvas.viewport().zoom * 100))}%`;
}
