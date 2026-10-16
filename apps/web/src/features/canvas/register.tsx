'use client';

/**
 * 编辑器工作区挂载入口（FE-06 作为 `/editor` 宿主的**注册模块**）。
 *
 * 由 `app/editor/page.tsx` 顶部 `import '@/features/canvas/register';` 引入（FE-03 约定：
 * 各票在自己目录里注册，不改壳层代码）。本模块负责三件事：
 *
 * 1. **插槽挂载**：`canvas` / `left-panel` / `right-panel` / `toolbar`（AI 入口）/
 *    `overlays`（FE-06 画布 · FE-04 面板 · FE-05 Inspector · FE-08 检查导出 · FE-10 AI/MCP）；
 * 2. **命令注册**：接管 FE-03 预留的 `view.zoomFit` / `edit.undo` / `edit.redo` /
 *    `file.new` / `file.export`（修复批次 4 · D-7：死入口注册实现），注册 `view.ai`
 *    （D-6：AI 抽屉唯一入口命令），并覆盖 `view.zoomIn|zoomOut|zoom100`（让 ⌘±/⌘0
 *    直接驱动**引擎视口**，外壳缩放菜单跟随）；
 * 3. **门禁挂点**：FE-05 的 `window.__dfInspectorProbe`（历史 + 节点属性读点）。
 */

import { useEffect } from 'react';
import {
  RESERVED_COMMAND_IDS,
  registerCommand,
  registerEditorSlotItem,
  useEditorUi,
  useEditorView,
} from '@/features/editor-shell';
import { t } from '@/i18n';
import { withDaemonEndpoint } from '@/lib/daemon-endpoint';

import { SAVE_DOCUMENT_COMMAND_ID } from './workspace/document-bridge';
import { DocumentSaveControl } from './workspace/save-control';
import {
  AiEntryButton,
  CanvasSlot,
  LeftPanelSlot,
  OverlaysSlot,
  RightPanelSlot,
} from './workspace/slots';
import { connectToolSync, registerWorkspaceToolCommands } from './workspace/tool-bridge';
import { useWorkspaceUi } from './workspace/ui-state';

import {
  ensureWorkspaceBootstrapped,
  getWorkspace,
  readDocumentId,
  setWorkspaceBootstrap,
} from './workspace/workspace-session';

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
 * → 编辑器 AI 抽屉）。幂等只应用一次：跳转后的会话内再次调用不重复触发浮层。
 */
let queryEntryPointsApplied = false;

export function connectQueryEntryPoints(): void {
  if (queryEntryPointsApplied || typeof window === 'undefined') return;
  queryEntryPointsApplied = true;
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
 * 只在浏览器侧执行一次（`ensureWorkspaceBootstrapped` 幂等）；文档 id 来自首页卡片契约
 * （`/editor?documentId=…`）。载入失败不静默：文档桥把原因落进保存态，顶栏可见。
 */
let documentLoadRequested = false;

function connectDocumentBridge(): void {
  if (documentLoadRequested) return;
  documentLoadRequested = true;
  const workspace = getWorkspace();
  const documentId = readDocumentId(window.location.search);
  if (documentId === null) return;
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

/** 注册插槽（幂等：同槽同 id 覆盖）。 */
export function registerWorkspaceSlots(): void {
  registerEditorSlotItem('topbar-center', {
    id: 'fe-06-document-save',
    order: 0,
    render: () => <DocumentSaveControl />,
  });
  registerEditorSlotItem('canvas', { id: 'fe-06-canvas', order: 0, render: () => <CanvasSlot /> });
  registerEditorSlotItem('left-panel', {
    id: 'fe-04-panels',
    order: 0,
    render: () => <LeftPanelSlot />,
  });
  registerEditorSlotItem('right-panel', {
    id: 'fe-06-right',
    order: 0,
    render: () => <RightPanelSlot />,
  });
  // AI 抽屉入口（D1）：工具栏按钮（命令面板走 `view.ai`，两处同一命令）
  registerEditorSlotItem('toolbar', {
    id: 'fe-10-ai-entry',
    order: 0,
    render: () => <AiEntryButton />,
  });
  registerEditorSlotItem('overlays', {
    id: 'fe-10-overlays',
    order: 10,
    render: () => <OverlaysSlot />,
  });
}

/**
 * 工作区引导组件（`app/editor/page.tsx` 渲染它即完成挂载）。
 *
 * 为什么必须是**客户端组件 + 挂载后注册**，而不是「页面顶层 import 即注册」：
 * `'use client'` 模块在服务端渲染时只产出 client reference，**顶层代码不会在服务端执行**；
 * 顶层注册会造成「服务端空槽 / 客户端有槽」的 hydration 不匹配，结果是整棵树停在空槽形态
 * （插槽永远不出现）。放在 effect 里则服务端与客户端首帧一致，挂载后经注册表订阅填充。
 */
export function WorkspaceBootstrap(): null {
  useEffect(() => {
    registerWorkspaceSlots();
    registerWorkspaceCommands();
    connectWorkspaceSync();
    installInspectorProbe();
    installWorkspaceProbe();
    ensureWorkspaceBootstrapped();
    connectDocumentBridge();
    connectQueryEntryPoints();
  }, []);
  return null;
}

// 引导实现注入（`ensureWorkspaceBootstrapped` 由槽组件在挂载后调用）：命令/视口同步/门禁探针
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
