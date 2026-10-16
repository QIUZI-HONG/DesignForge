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
 * - `right-panel`→ 右栏页签：检查（FE-08 C15）/ 代码（F6）/ 导出（FE-08）+ 属性（FE-05）；
 * - `overlays`   → FE-10 `AiDrawer`（AI 助手）+ MCP 确认条容器（常驻，不随面板开合）。
 */

import { SegmentedControl } from '@dforge/ui';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';

import { AiDrawer, createAiPort } from '@/features/ai';
import { EditorPanels, PanelsProvider } from '@/features/editor-panels';
import { useCanvasHud } from '@/features/editor-shell';
import { CodeExportPanel } from '@/features/inspect-export/components/CodeExportPanel';
import { ExportPanel } from '@/features/inspect-export/components/ExportPanel';
import { InspectPanel } from '@/features/inspect-export/components/InspectPanel';
import { InspectorPanel } from '@/features/inspector';
import { t } from '@/i18n';

import { installCanvasDebugHandle, sessionDebugHandle } from '../debug/canvas-debug';
import type { SceneRenderStats } from '../render/renderer';
import { type CanvasRuntimeStatus, CanvasStage } from '../ui/canvas-stage';
import { McpConfirmHost } from './mcp-host';
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
      onFrame={(stats) => {
        statsRef.current = stats;
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

/** 右栏页签（检查 / 代码 / 导出）。 */
const RIGHT_TABS = ['inspect', 'code', 'export'] as const;
type RightTab = (typeof RIGHT_TABS)[number];

/**
 * 右栏槽：上半区 FE-08 三页签（C15 检查态 / F6 代码 / 导出），下半区 FE-05 Inspector（C5–C7）。
 * 分区而非互斥：检查态与属性面板都是「选中即看」，同屏对照更接近 Figma 的右栏心智。
 */
export function RightPanelSlot() {
  const mounted = useMounted();
  const workspace = getWorkspace();
  const [tab, setTab] = useState<RightTab>('inspect');
  const selection = useStore(workspace.canvas.store, (state) => state.selection);
  const document = useSyncExternalStore(
    (listener) => workspace.canvas.stack.subscribe(() => listener()),
    () => workspace.canvas.stack.getSnapshot(),
    () => workspace.canvas.stack.getSnapshot(),
  );
  const page = document.pages.find((candidate) => candidate.id === workspace.pageId);
  const activeNodeId = selection.activeId ?? selection.ids[0] ?? null;
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
            setTab(value as RightTab);
          }}
        />
      </div>
      <div className="dfc-ws-right__body">
        {tab === 'inspect' && page !== undefined ? (
          <InspectPanel
            stack={workspace.canvas.stack}
            pageId={workspace.pageId}
            selection={selection}
            documentId={document.id}
          />
        ) : null}
        {tab === 'code' && page !== undefined && activeNodeId !== null ? (
          <CodeExportPanel page={page} nodeId={activeNodeId} tokens={document.tokens} />
        ) : null}
        {tab === 'export' ? (
          <ExportPanel documentId={document.id} pageId={workspace.pageId} />
        ) : null}
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
 * AI 抽屉宿主：受控开合（命令面板「AI 助手」与工具栏按钮都能开它）。
 * 抽屉开着时不渲染画布 HUD（避免叠层互相压字）。
 */
export function AiDrawerSlot() {
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  // 基址解析已全站收敛（`@/lib/daemon-endpoint`，ADR-0004 裁决 ①）：端口自取同一份口径
  const port = useMemo(() => createAiPort(), []);
  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);
  if (!mounted) return null;
  return <AiDrawer open={open} onOpenChange={onOpenChange} port={port} />;
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
