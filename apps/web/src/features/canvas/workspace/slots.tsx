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
import { useCallback, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';

import { AiDrawer } from '@/features/ai';
import { EditorPanels, PanelsProvider } from '@/features/editor-panels';
import { useCanvasHud } from '@/features/editor-shell';
import { CodeExportPanel } from '@/features/inspect-export/components/CodeExportPanel';
import { ExportPanel } from '@/features/inspect-export/components/ExportPanel';
import { InspectPanel } from '@/features/inspect-export/components/InspectPanel';
import { InspectorPanel } from '@/features/inspector';
import { t } from '@/i18n';

import { CanvasStage } from '../ui/canvas-stage';
import { McpConfirmHost } from './mcp-host';
import { getWorkspace } from './workspace-session';

import './workspace.css';

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
  const workspace = getWorkspace();
  const hud = useCanvasHud();
  return (
    <CanvasStage
      session={workspace.canvas}
      theme="dark"
      hud={hud}
      coveredShortcutIds={SHELL_COVERED_SHORTCUT_IDS}
    />
  );
}

/** 左栏槽（FE-04：图层面板 + 资产面板）。 */
export function LeftPanelSlot() {
  const workspace = getWorkspace();
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
  const [open, setOpen] = useState(false);
  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);
  return <AiDrawer open={open} onOpenChange={onOpenChange} />;
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
