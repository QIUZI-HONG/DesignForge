/**
 * 工具桥（D-1 / UX-02）——**工具态以画布会话为唯一真源**的接线模块。
 *
 * 缺陷现场（验收 D-1 / UX-02）：`/editor` 上点工具栏按钮、按工具快捷键、从命令面板执行
 * `tool.<id>`，都只改外壳视图态（`useEditorView.setActiveTool`），画布会话从未收到 `setTool`
 * ——于是「外壳选中、会话不知情」，矩形/椭圆/画板/文本拖画不落节点且**零反馈**。
 *
 * 修法（规格工作包 A1 已定）：
 * - 画布挂载时用**同 id 覆盖**壳层的默认工具命令（注册表 last wins，见 `editor-shell` 的约定），
 *   命令执行时同步 `workspace.canvas.setTool(...)`——外壳高亮由 `connectToolSync` 单向跟随；
 * - 反向也跟随：拖画落节点/落文本后会话把工具切回选择工具，外壳高亮必须跟着回「移动工具」，
 *   不允许出现「会话是选择工具、工具条还亮着矩形」的双源残留。
 *
 * 与壳层默认实现的关系：壳层 `builtins.ts` 的 `tool.<id>` 默认实现（只改外壳态）仍然保留，
 * 用于「画布未挂载」的场景（例如壳层单测与插槽空态）；本模块只在画布挂载时接管。
 *
 * 快捷键双触发核查（本轮结论）：画布侧 `input/keyboard.ts` 的快捷键表**没有**单键工具条目
 * （只有 ⌘Z/⌘C 这类带修饰键的组合），工具键 V/F/R/T/H/O 只由壳层的全局派发执行一次——
 * 不存在「一击两动」，因此无需往 `coveredShortcutIds` 追加工具键（该清单只登记两侧都实现的组合）。
 */
import type { EditorTool } from '@/features/editor-shell';
import {
  EDITOR_TOOLS,
  registerCommand,
  toolCommandId,
  useEditorView,
} from '@/features/editor-shell';
import { t } from '@/i18n';

import type { CanvasTool } from '../state/session';

import type { EditorWorkspace } from './workspace-session';

/**
 * 外壳工具 → 画布工具（唯一映射真源）。
 *
 * 为何不是同名直通：外壳用 Figma 词表的「移动工具」（`move`），画布会话的白名单交互叫
 * `select`（引擎侧工具名）；两者必须在这里对上，其余五个工具同名。
 */
const SHELL_TO_CANVAS: Record<EditorTool, CanvasTool> = {
  move: 'select',
  frame: 'frame',
  rect: 'rect',
  ellipse: 'ellipse',
  text: 'text',
  hand: 'hand',
};

/** 画布工具 → 外壳工具（上表的逆）。 */
const CANVAS_TO_SHELL: Record<CanvasTool, EditorTool> = {
  select: 'move',
  hand: 'hand',
  rect: 'rect',
  ellipse: 'ellipse',
  text: 'text',
  frame: 'frame',
};

/** 外壳工具 → 画布会话工具。 */
export function canvasToolForShellTool(tool: EditorTool): CanvasTool {
  return SHELL_TO_CANVAS[tool];
}

/** 画布会话工具 → 外壳工具。 */
export function shellToolForCanvasTool(tool: CanvasTool): EditorTool {
  return CANVAS_TO_SHELL[tool];
}

/**
 * 注册工具命令（同 id 覆盖壳层默认实现）。
 *
 * 可用性判据取**画布会话真值**（而不是外壳视图态）：唯一真源在会话，
 * 外壳高亮只是它的投影——这样「置灰」与「实际工具」不可能漂移。
 */
export function registerWorkspaceToolCommands(workspace: EditorWorkspace): void {
  const { canvas } = workspace;
  for (const tool of EDITOR_TOOLS) {
    const canvasTool = canvasToolForShellTool(tool.id);
    registerCommand({
      id: toolCommandId(tool.id),
      title: t(tool.labelKey),
      group: t('editor.group.tools'),
      shortcut: tool.shortcut,
      enabled: () => canvas.store.getState().tool !== canvasTool,
      run: () => {
        canvas.setTool(canvasTool);
      },
    });
  }
}

/**
 * 画布会话工具 → 外壳高亮（单向跟随）。
 *
 * @returns 退订函数（壳层卸载时调用）
 */
export function connectToolSync(workspace: EditorWorkspace): () => void {
  const apply = (): void => {
    const shellTool = shellToolForCanvasTool(workspace.canvas.store.getState().tool);
    if (useEditorView.getState().activeTool !== shellTool) {
      useEditorView.getState().setActiveTool(shellTool);
    }
  };
  apply();
  return workspace.canvas.store.subscribe((state, previous) => {
    if (state.tool !== (previous as typeof state).tool) apply();
  });
}
