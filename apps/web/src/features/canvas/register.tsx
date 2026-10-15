'use client';

/**
 * 编辑器工作区挂载入口（FE-06 作为 `/editor` 宿主的**注册模块**）。
 *
 * 由 `app/editor/page.tsx` 顶部 `import '@/features/canvas/register';` 引入（FE-03 约定：
 * 各票在自己目录里注册，不改壳层代码）。本模块负责三件事：
 *
 * 1. **插槽挂载**：`canvas` / `left-panel` / `right-panel` / `overlays`
 *    （FE-06 画布 · FE-04 面板 · FE-05 Inspector · FE-08 检查导出 · FE-10 AI/MCP）；
 * 2. **命令注册**：接管 FE-03 预留的 `view.zoomFit` / `edit.undo` / `edit.redo`，
 *    并覆盖 `view.zoomIn|zoomOut|zoom100`（让 ⌘±/⌘0 直接驱动**引擎视口**，外壳缩放菜单跟随）；
 * 3. **门禁挂点**：FE-05 的 `window.__dfInspectorProbe`（历史 + 节点属性读点）。
 */

import { useEffect } from 'react';
import {
  RESERVED_COMMAND_IDS,
  registerCommand,
  registerEditorSlotItem,
  useEditorView,
} from '@/features/editor-shell';
import { t } from '@/i18n';
import { CanvasSlot, LeftPanelSlot, OverlaysSlot, RightPanelSlot } from './workspace/slots';

import {
  ensureWorkspaceBootstrapped,
  getWorkspace,
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
}

/** 视口/选择/文档变化 → 外壳视图态同步（缩放百分比）。 */
function connectViewSync(): () => void {
  const workspace = getWorkspace();
  const sync = (): void => {
    useEditorView.getState().setZoom(workspace.canvas.viewport().zoom);
  };
  sync();
  return workspace.canvas.store.subscribe((state, previous) => {
    if (state.viewport.zoom !== (previous as typeof state).viewport.zoom) sync();
  });
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
    connectViewSync();
    installInspectorProbe();
    installWorkspaceProbe();
    ensureWorkspaceBootstrapped();
  }, []);
  return null;
}

// 引导实现注入（`ensureWorkspaceBootstrapped` 由槽组件在挂载后调用）：命令/视口同步/门禁探针
setWorkspaceBootstrap(() => {
  // 幂等：重复调用无副作用（注册表同 id 覆盖、探针重复赋值同一形状）
  registerWorkspaceCommands();
  connectViewSync();
  installInspectorProbe();
  installWorkspaceProbe();
});

/** 缩放百分比（供状态栏/调试）。 */
export function currentZoomLabel(): string {
  return `${String(Math.round(getWorkspace().canvas.viewport().zoom * 100))}%`;
}
