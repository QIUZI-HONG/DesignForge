'use client';

/**
 * 编辑器工作区插槽组件（FE-06 作为 `/editor` 宿主的挂载实现）。
 *
 * 每个槽组件自己从模块级单例取会话（插槽宿主不在同一棵 Provider 树里），
 * 因此这里也顺带把 FE-04 需要的 `PanelsProvider` 就近包上。
 *
 * 槽位归属（本票接线）：
 * - `canvas`     → 画布本体（FE-06）+ HUD 走壳层 `useCanvasHud()`；
 * - `left-panel` → FE-04 `EditorPanels`（图层/资产双页签，选择集与画布同源）；
 * - `right-panel`→ 右栏页签：检查（FE-08 C15）/ 代码（F6）/ 导出（FE-08）/ 出图（D1 挂载点）
 *                  + 属性（FE-05）；
 * - `toolbar`    → AI 抽屉入口按钮（D1 挂载点，与 `view.ai` 命令同一条路径）；
 * - `overlays`   → FE-10 `AiDrawer`（AI 助手）+ MCP 确认条容器（常驻，不随面板开合）。
 */

import type { DesignDocument } from '@dforge/engine';
import { SegmentedControl, Tooltip } from '@dforge/ui';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';

import { AiDrawer, createAiPort } from '@/features/ai';
import { EditorPanels, PanelsProvider } from '@/features/editor-panels';
import { executeCommand, useCanvasHud } from '@/features/editor-shell';
import { ImagePanel } from '@/features/image';
import { CodeExportPanel, ExportPanel, InspectPanel } from '@/features/inspect-export';
import { InspectorPanel } from '@/features/inspector';
import { t } from '@/i18n';

import { installCanvasDebugHandle, sessionDebugHandle } from '../debug/canvas-debug';
import { daemonPageId } from '../persistence/documents-client';
import { type FramePerfRecorder, createFramePerfRecorder } from '../render/frame-perf';
import type { SceneRenderStats } from '../render/renderer';
import { type CanvasRuntimeStatus, CanvasStage } from '../ui/canvas-stage';
import { AiEntryIcon } from './icons';
import { McpConfirmHost } from './mcp-host';
import { RIGHT_PANEL_TABS, type RightPanelTab, useWorkspaceUi } from './ui-state';
import { ensureWorkspaceBootstrapped, getWorkspace } from './workspace-session';

import './workspace.css';

/**
 * 挂载完成标记：预设来自查询串（服务端读不到），因此槽内容一律**挂载后**才渲染，
 * 否则第一次客户端渲染与服务端渲染不一致（hydration 不匹配）。
 */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    // 浏览器副作用（会话单例 / 命令 / 探针）在真正挂载后初始化一次
    ensureWorkspaceBootstrapped();
  }, []);
  return mounted;
}

/** 壳层（FE-03 命令注册表）已接管的快捷键 id（画布不再自行执行，避免一击两动）。 */
export const SHELL_COVERED_SHORTCUT_IDS: readonly string[] = [
  'undo',
  'redo',
  'zoomIn',
  'zoomOut',
  'zoomReset',
  'zoomFit',
];

/** 画布槽（FE-06 本体）：HUD 交给壳层渲染（C20 位置由壳层决定）。 */
export function CanvasSlot() {
  const mounted = useMounted();
  const workspace = getWorkspace();
  const hud = useCanvasHud();
  const statsRef = useRef<SceneRenderStats | null>(null);
  const statusRef = useRef<CanvasRuntimeStatus | null>(null);
  // 帧性能记录器（渲染观测 seam）：帧闭包喂样本，门禁经 __dforgeCanvas.perf() 按需读快照
  const perfRef = useRef<FramePerfRecorder | null>(null);
  if (perfRef.current === null) perfRef.current = createFramePerfRecorder();

  // 门禁/调试读点（与 `/_canvas` 同一套字段，见 debug/canvas-debug.ts）
  useEffect(() => {
    if (!mounted) return undefined;
    return installCanvasDebugHandle(
      sessionDebugHandle({
        session: workspace.canvas,
        runtime: () =>
          statusRef.current ?? {
            canvasKit: 'loading',
            fonts: 'loading',
            firstFrame: false,
            frameCount: 0,
            dpr: 1,
            error: null,
          },
        stats: () => statsRef.current,
        perf: () => perfRef.current?.snapshot() ?? null,
        // 落盘的 daemon 文档 id（D-2）：门禁/e2e 据此断言「打开的是哪一份、保存到哪一份」
        documentId: () => workspace.documents.store.getState().documentId,
      }),
    );
  }, [mounted, workspace]);

  if (!mounted) return null;
  return (
    <CanvasStage
      session={workspace.canvas}
      theme="dark"
      hud={hud}
      coveredShortcutIds={SHELL_COVERED_SHORTCUT_IDS}
      onFrame={(stats, timing) => {
        statsRef.current = stats;
        perfRef.current?.record(timing);
      }}
      onStatus={(status) => {
        statusRef.current = status;
      }}
    />
  );
}

/** 左栏槽（FE-04：图层面板 + 资产面板）。 */
export function LeftPanelSlot() {
  const mounted = useMounted();
  const workspace = getWorkspace();
  if (!mounted) return null;
  return (
    <PanelsProvider session={workspace.panels}>
      <EditorPanels />
    </PanelsProvider>
  );
}

/** 右栏页签（检查 / 代码 / 导出 / 出图）。 */
const RIGHT_TABS = RIGHT_PANEL_TABS;

/**
 * 右栏槽：上半区 FE-08 三页签（C15 检查态 / F6 代码 / 导出）+ 出图（D1 挂载点），
 * 下半区 FE-05 Inspector（C5–C7）。分区而非互斥：检查态与属性面板都是「选中即看」，
 * 同屏对照更接近 Figma 的右栏心智。
 *
 * 页签态在 `useWorkspaceUi`（而非组件 state）：`file.export` 命令要能切到「导出」页签
 * （D-7 死入口修复），命令的 `run` 是**非 React 闭包**——只能写 store（见 `ui-state.ts`）。
 */
export function RightPanelSlot() {
  const mounted = useMounted();
  const workspace = getWorkspace();
  const tab = useWorkspaceUi((state) => state.rightPanelTab);
  const selection = useStore(workspace.canvas.store, (state) => state.selection);
  const daemonDocumentId = useStore(workspace.documents.store, (state) => state.documentId);
  const document = useSyncExternalStore(
    (listener) => workspace.canvas.stack.subscribe(() => listener()),
    () => workspace.canvas.stack.getSnapshot(),
    () => workspace.canvas.stack.getSnapshot(),
  );
  const page = document.pages.find((candidate) => candidate.id === workspace.pageId);
  const activeNodeId = selection.activeId ?? selection.ids[0] ?? null;
  // daemon 侧页面 id：按 daemon 的分配规则（页面序号 → page-{N}）派生
  const index = document.pages.findIndex((candidate) => candidate.id === workspace.pageId);
  const daemonPage = daemonPageId(index < 0 ? 0 : index);
  if (!mounted) return null;

  return (
    <div className="dfc-ws-right" data-df-workspace="right-panel">
      <div className="dfc-ws-right__tabs">
        <SegmentedControl
          label={t('canvas.ws.rightTabs')}
          size="sm"
          value={tab}
          options={RIGHT_TABS.map((value) => ({
            value,
            label: t(`canvas.ws.tab.${value}`),
          }))}
          onChange={(value) => {
            useWorkspaceUi.getState().setRightPanelTab(value as RightPanelTab);
          }}
        />
      </div>
      <div className="dfc-ws-right__body">
        {tab === 'inspect' && page !== undefined ? (
          <InspectPanel
            stack={workspace.canvas.stack}
            pageId={workspace.pageId}
            selection={selection}
            // 导出寻址走 daemon 坐标系（未落盘时退回引擎文档 id：导出会明确报错，不是静默失败）
            documentId={daemonDocumentId ?? document.id}
            exportPageId={daemonPage}
          />
        ) : null}
        {tab === 'code' && page !== undefined && activeNodeId !== null ? (
          <CodeExportPanel page={page} nodeId={activeNodeId} tokens={document.tokens} />
        ) : null}
        {tab === 'export' ? <ExportTab document={document} /> : null}
        {tab === 'image' ? <ImageTab /> : null}
      </div>
      <div className="dfc-ws-right__inspector" data-df-workspace="inspector">
        <InspectorPanel
          stack={workspace.canvas.stack}
          pageId={workspace.pageId}
          selection={selection}
        />
      </div>
    </div>
  );
}

/**
 * 出图页签（D1 挂载点）：`ImagePanel` 自带的抽屉在页签选中时打开（受控）。
 * 抽屉关闭（Esc / 遮罩 / 关闭按钮）→ 页签回到「检查」——「出图」是抽屉的开关语义，
 * 不存在「页签选中但什么都没有」的空态。
 */
function ImageTab() {
  return (
    <ImagePanel
      open
      onOpenChange={(next) => {
        if (!next) useWorkspaceUi.getState().setRightPanelTab('inspect');
      }}
    />
  );
}

/**
 * 导出页签（A3）：daemon 导出面按「daemon 文档 id + daemon 页面 id」寻址
 * （`POST /export` → `readPage(documentId, pageId)`，见 daemon 导出路由）。
 *
 * 编辑器侧的文档 id 是引擎文档 id（内存文档为 `doc-editor`），**不能**直接当 daemon id 用
 * ——缺陷现场「导出报 doc_not_found」正是这个错位：未落盘的文档在 daemon 里根本不存在。
 * 因此这里取文档桥的 `documentId`（落盘后 = daemon 侧真 id），页面 id 按 daemon 的
 * `page-{N}` 分配规则由页面序号派生；未落盘时明确提示「先保存」，不给会失败的按钮。
 */
function ExportTab({ document }: { document: DesignDocument }) {
  const workspace = getWorkspace();
  const documentId = useStore(workspace.documents.store, (state) => state.documentId);
  if (documentId === null) {
    return (
      <p className="dfc-ws-right__hint" data-df-export-hint="need-save">
        {t('editor.export.needSave')}
      </p>
    );
  }
  const index = document.pages.findIndex((candidate) => candidate.id === workspace.pageId);
  return <ExportPanel documentId={documentId} pageId={daemonPageId(index < 0 ? 0 : index)} />;
}

/**
 * AI 抽屉宿主：开合状态在 `useWorkspaceUi`（`view.ai` 命令与工具栏入口按钮都能写它，
 * 见 `ui-state.ts`），抽屉开合由入口同一条命令路径驱动（D-6：修复前无任何触发点）。
 * 抽屉开着时不渲染画布 HUD（避免叠层互相压字）。
 */
export function AiDrawerSlot() {
  const mounted = useMounted();
  const open = useWorkspaceUi((state) => state.aiDrawerOpen);
  // 基址解析已全站收敛（`@/lib/daemon-endpoint`，ADR-0004 裁决 ①）：端口自取同一份口径
  const port = useMemo(() => createAiPort(), []);
  const onOpenChange = useCallback((next: boolean) => {
    useWorkspaceUi.getState().setAiDrawerOpen(next);
  }, []);
  if (!mounted) return null;
  return <AiDrawer open={open} onOpenChange={onOpenChange} port={port} />;
}

/**
 * AI 抽屉入口按钮（D1：工具栏落点）。
 *
 * 按钮只执行 `view.ai` 命令（与命令面板、快捷键同一路径），`aria-pressed` 跟随开合态；
 * 「无 key 降级态」由抽屉自身渲染（既有实现），入口不做任何降级分支。
 */
export function AiEntryButton() {
  const open = useWorkspaceUi((state) => state.aiDrawerOpen);
  const label = t('ai.title');
  return (
    <Tooltip content={label} placement="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={open}
        data-df-ai-entry=""
        className={open ? 'dfg-editor-tool dfg-editor-tool--active' : 'dfg-editor-tool'}
        onClick={() => {
          void executeCommand('view.ai');
        }}
      >
        <AiEntryIcon />
      </button>
    </Tooltip>
  );
}

/** 浮层槽：AI 抽屉 + MCP 确认条容器（全局确认，常驻）。 */
export function OverlaysSlot() {
  return (
    <>
      <AiDrawerSlot />
      <McpConfirmHost />
    </>
  );
}
