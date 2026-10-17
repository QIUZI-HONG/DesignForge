/**
 * `@/features/editor-shell` —— 编辑器族的**公共骨架**（FE-03 交付面）。
 *
 * 本文件是跨票消费入口（FE-04/05/06/07/08 从这里取件），导出的形状**冻结**：
 *
 * 一、命令注册表（冻结接口 ①）
 * ```ts
 * import { registerCommand, commandRegistry, useCommandList, executeCommand } from '@/features/editor-shell';
 * registerCommand({ id, title, group, shortcut?, enabled?, run });   // 同 id 后注册者覆盖（位置不跳）
 * ```
 * 命令注册进表后自动获得：命令面板条目（⌘K）、快捷键说明条目（E8）、**全局键盘派发**。
 *
 * 二、画布 HUD（冻结接口 ②）
 * ```ts
 * import { useCanvasHud } from '@/features/editor-shell';
 * const hud = useCanvasHud();          // { show(text, options?), hide() }
 * hud.show('1200 × 800');              // 拖动中：常驻
 * hud.hide();                          // 松手：消失
 * hud.show('150%', { autoHideMs: 1200 });  // 一次性动作：自动淡出
 * ```
 *
 * 三、插槽（挂载实现而不改 `app/editor`）
 * ```ts
 * import { registerEditorSlotItem } from '@/features/editor-shell';
 * registerEditorSlotItem('canvas', { id: 'fe-06-canvas', render: () => <Canvas /> });
 * ```
 * 槽位：`topbar-left` | `topbar-center` | `topbar-right` | `toolbar` | `left-panel`
 * | `canvas` | `right-panel` | `overlays`。
 * 约定：各票在自己的 feature 目录里写挂载模块，并在 `app/editor/page.tsx` 顶部
 * 加一行 `import '@/features/<id>/register';`（纯增量）。
 *
 * 四、预留命令 id（入口已渲染为「未注册 = 禁用 + 原因提示」，注册后自动点亮）
 * `view.zoomFit`（FE-06）· `edit.undo` / `edit.redo`（FE-06）· `review.comment.toggle` /
 * `review.present.start` / `review.versions.open`（FE-07）· `share.open` · `file.new` / `file.export`。
 *
 * 五、UI 态（面板开合/缩放/工具；文档态不在这里）
 * `useEditorView`（缩放与当前工具）· `useEditorUi`（命令面板/快捷键说明）· `canvasHud`（HUD 命令式）。
 */

// 命令族
export {
  builtinCommands,
  registerBuiltinCommands,
} from './commands/builtins';
export { type CommandRunResult, type CommandRunStatus, executeCommand } from './commands/execute';
export {
  type Command,
  type CommandRegistry,
  canRunCommand,
  commandRegistry,
  getCommand,
  getCommandsSnapshot,
  registerCommand,
  resetCommandRegistry,
  runCommand,
  subscribeCommands,
} from './commands/registry';
export { useCommand, useCommandList } from './commands/use-commands';
export {
  CanvasHud,
  type CanvasHudProps,
  CanvasHudProvider,
  useCanvasHud,
} from './hud/context';
// HUD 族（冻结接口 ②）
export {
  type CanvasHudApi,
  type CanvasHudShowOptions,
  type CanvasHudSnapshot,
  canvasHud,
  getCanvasHudSnapshot,
  subscribeCanvasHud,
} from './hud/controller';

// 插槽族
export { EditorSlotHost, type EditorSlotHostProps, useEditorSlotItems } from './slots/host';
export {
  type EditorSlotItem,
  type EditorSlotName,
  getEditorSlotSnapshot,
  listEditorSlotItems,
  registerEditorSlotItem,
  resetEditorSlots,
  subscribeEditorSlots,
} from './slots/registry';
export { type EditorUiState, isEditorOverlayOpen, useEditorUi } from './state/ui';
// UI 态
export {
  currentZoomPercent,
  type EditorTool,
  type EditorViewState,
  stepZoom,
  toZoomPercent,
  useEditorView,
  ZOOM_LIMITS,
} from './state/view';

// 工具表与预留命令 id
export {
  EDITOR_TOOLS,
  type EditorToolSpec,
  RESERVED_COMMAND_IDS,
  toolCommandId,
} from './tools';

// 壳层组件（整壳挂载入口）
export { EditorShell } from './ui/editor-shell';
// 深色作用域（编辑器路由布局挂它：客户端导航时把根元素切回深色基准）
export { EditorThemeScope } from './ui/theme-scope';
