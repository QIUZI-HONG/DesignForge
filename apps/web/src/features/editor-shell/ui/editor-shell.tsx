'use client';

/**
 * 编辑器壳层根组件（FE-03 交付物）：顶栏（C1）+ 工具栏（C2）+ 三栏主体（插槽）+ 浮层。
 *
 * 结构（挂载点即跨票契约，改动会波及其他票）：
 * ```
 * <EditorShell>                        ← data-df-page="editor"
 *   <EditorTopbar/>                    顶栏三区（topbar-left/center/right 插槽）
 *   <EditorToolbar/>                   工具组 + toolbar 插槽 + 缩放菜单 + 帮助
 *   <body> 左面板列(left-panel 插槽) | 画布列(canvas 插槽 + HUD 宿主 + 覆盖层) | 右面板列(right-panel 插槽)
 *   overlays 插槽（FE-07 Present / 工单 08 命令面板与速查卡——经 editor-bootstrap 声明挂载）
 *   <ShortcutsDialog/>
 * ```
 *
 * 内置命令在挂载期注册、卸载时反注册（`registerBuiltinCommands`）；后续票用同 id 覆盖时
 * 反注册不会误删它们的实现（见 `commands/registry.ts` 的语义）。命令面板（工单 08）已
 * 迁至 `features/command-palette` 域（⌘/），经 `app/editor/editor-bootstrap.tsx` 挂载。
 */
import { useEffect } from 'react';

import { t } from '@/i18n';

import { registerBuiltinCommands } from '../commands/builtins';
import { CanvasHud } from '../hud/context';
import { useGlobalShortcuts } from '../shortcuts/use-global-shortcuts';
import { EditorSlotHost } from '../slots/host';
import { ShortcutsDialog } from './shortcuts-dialog';
import { EditorToolbar } from './toolbar';
import { EditorTopbar } from './topbar';

/** 画布槽空态（FE-06 挂载后自动替换）。 */
function CanvasPlaceholder() {
  return (
    <div
      className="dfg-editor-slot-fallback dfg-editor-slot-fallback--canvas"
      data-df-state="empty"
    >
      <p className="dfg-editor-slot-fallback__title">
        {t('editor.slot.pending', { name: t('editor.slot.canvas') })}
      </p>
      <p className="dfg-editor-slot-fallback__hint">{t('editor.canvas.hint')}</p>
    </div>
  );
}

/** 面板槽空态（FE-04/FE-05 挂载后自动替换）。 */
function PanelPlaceholder({ slot }: { slot: 'left-panel' | 'right-panel' }) {
  const name = slot === 'left-panel' ? t('editor.slot.leftPanel') : t('editor.slot.rightPanel');
  return (
    <div className="dfg-editor-slot-fallback" data-df-state="empty">
      <p className="dfg-editor-slot-fallback__title dfg-editor-slot-fallback__title--small">
        {t('editor.slot.pending', { name })}
      </p>
      <p className="dfg-editor-slot-fallback__hint dfg-editor-slot-fallback__hint--small">
        {t('editor.slot.panelHint')}
      </p>
    </div>
  );
}

/** 编辑器壳层。 */
export function EditorShell() {
  useGlobalShortcuts();

  useEffect(() => registerBuiltinCommands(), []);

  return (
    <div className="dfg-editor" data-df-page="editor">
      <EditorTopbar />
      <EditorToolbar />

      <div className="dfg-editor__body">
        <aside
          className="dfg-editor__panel dfg-editor__panel--left"
          data-df-slot="left-panel"
          aria-label={t('editor.slot.leftPanel')}
        >
          <EditorSlotHost slot="left-panel" fallback={<PanelPlaceholder slot="left-panel" />} />
        </aside>

        {/* tabIndex=-1：命令面板关闭后焦点回落画布的程序化焦点落点（不进 Tab 序） */}
        <main
          className="dfg-editor__canvas"
          data-df-slot="canvas"
          data-df-preview="editor/canvas"
          tabIndex={-1}
        >
          <EditorSlotHost slot="canvas" fallback={<CanvasPlaceholder />} />
          <div className="dfg-editor__hud-host">
            <CanvasHud />
          </div>
        </main>

        <aside
          className="dfg-editor__panel dfg-editor__panel--right"
          data-df-slot="right-panel"
          aria-label={t('editor.slot.rightPanel')}
        >
          <EditorSlotHost slot="right-panel" fallback={<PanelPlaceholder slot="right-panel" />} />
        </aside>
      </div>

      <EditorSlotHost slot="overlays" />
      <ShortcutsDialog />
    </div>
  );
}
