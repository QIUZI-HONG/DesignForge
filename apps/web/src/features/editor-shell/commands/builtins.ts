/**
 * 壳层内置命令（工具 / 视图 / 帮助三组）——命令面板与快捷键表的**初始内容来源**。
 *
 * 归属与接管规则（对后续票的合同）：
 * - 工具命令 `tool.<id>`（V/F/R/T/H）与视图命令 `view.zoomIn|zoomOut|zoom100`、帮助命令
 *   `help.shortcuts` 由本票注册为**默认实现**（作用于壳层 UI 态）；
 * - 需要画布真值的命令**不由本票注册**：`view.zoomFit`（需画布尺寸/包围盒）、`edit.undo`
 *   / `edit.redo`（引擎命令栈）、`review.*`、`share.open`、`file.*`——入口在壳层渲染为
 *   **禁用 + 原因提示**，对应票用同 id 注册后自动点亮（注册表 last wins，见 `registry.ts`）；
 * - 想接管默认缩放实现（例如让 ⌘+ 直接改引擎视口）也用同 id 覆盖，无需改本文件；
 * - `view.commandPalette` **不再由壳层注册**（票 04 · spec P0-4）：命令面板是全局入口
 *   （任意页 ⌘K，⌘/ 编辑器别名），注册收口到命令面板域的全局宿主
 *   （`features/command-palette/register.tsx`，根布局挂载）——面板组件随宿主全路由可用。
 */
import { t } from '@/i18n';

import { canvasHud } from '../hud/controller';
import { useEditorUi } from '../state/ui';
import { currentZoomPercent, useEditorView } from '../state/view';
import { EDITOR_TOOLS, toolCommandId } from '../tools';
import { type Command, registerCommand } from './registry';

/** 缩放类命令的 HUD 提示时长（滚轮/菜单缩放时反白小条一闪，与 Figma 手感一致）。 */
const ZOOM_HUD_MS = 1200;

/** 变更缩放并提示（HUD 是「一次性动作」语义 → 自动淡出）。 */
function applyZoom(action: () => void): void {
  const before = useEditorView.getState().zoom;
  action();
  const after = useEditorView.getState().zoom;
  // 已在档位尽头（再按不缩放）就不闪提示，避免「按了没反应还弹条」
  if (after === before) return;
  canvasHud.show(`${String(currentZoomPercent())}%`, { autoHideMs: ZOOM_HUD_MS });
}

/**
 * 构造内置命令（纯函数：不碰注册表，便于单测逐条断言）。
 *
 * 文案在此刻经 `t()` 落地（zh-CN 唯一暴露，ADR-0003）——注册表本身不做 i18n。
 */
export function builtinCommands(): Command[] {
  const toolCommands: Command[] = EDITOR_TOOLS.map((tool) => ({
    id: toolCommandId(tool.id),
    title: t(tool.labelKey),
    group: t('editor.group.tools'),
    shortcut: tool.shortcut,
    // 已是当前工具时置灰（面板仍可见，只是不可选）
    enabled: () => useEditorView.getState().activeTool !== tool.id,
    run: () => {
      useEditorView.getState().setActiveTool(tool.id);
    },
  }));

  const viewGroup = t('editor.group.view');
  const viewCommands: Command[] = [
    {
      id: 'view.zoomIn',
      title: t('editor.command.zoomIn'),
      group: viewGroup,
      shortcut: '⌘+',
      run: () => {
        applyZoom(() => {
          useEditorView.getState().zoomIn();
        });
      },
    },
    {
      id: 'view.zoomOut',
      title: t('editor.command.zoomOut'),
      group: viewGroup,
      shortcut: '⌘-',
      run: () => {
        applyZoom(() => {
          useEditorView.getState().zoomOut();
        });
      },
    },
    {
      id: 'view.zoom100',
      title: t('editor.command.zoom100'),
      group: viewGroup,
      shortcut: '⇧0',
      run: () => {
        applyZoom(() => {
          useEditorView.getState().resetZoom();
        });
      },
    },
  ];

  const helpCommands: Command[] = [
    {
      id: 'help.shortcuts',
      title: t('editor.action.shortcuts'),
      group: t('editor.group.help'),
      // 不占键位：⌘/ 归命令面板（工单 08，features/command-palette/register 注册）
      run: () => {
        useEditorUi.getState().setShortcutsOpen(true);
      },
    },
  ];

  return [...toolCommands, ...viewCommands, ...helpCommands];
}

/**
 * 注册全部内置命令。
 *
 * @returns 反注册函数（卸载编辑器壳时调用；同 id 已被后续票接管时不会误删其实现）
 */
export function registerBuiltinCommands(): () => void {
  const unregisters = builtinCommands().map((command) => registerCommand(command));
  return () => {
    for (const unregister of unregisters) unregister();
  };
}
