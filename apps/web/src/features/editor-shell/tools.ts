/**
 * 工具栏工具表（C2 清单）：图标 / 文案键 / 快捷键的单一真源。
 *
 * 工具条渲染、命令注册（`tool.<id>` 命令的快捷键与标题）都从这里派生——
 * 「工具条上的快捷键」与「命令面板里的快捷键」不可能漂移。
 *
 * 工具语义：`move` 选择/移动 · `frame` 画板 · `rect` 矩形 · `text` 文本 · `hand` 抓手（平移）。
 * 与引擎白名单的对应：选择/移动/画布平移归 `move`/`hand`；绘制类工具的落点交互由 FE-06 接。
 */
import { BoxIcon, FrameIcon, type IconComponent, MoveIcon, TextIcon } from '@dforge/ui';

import { HandIcon } from './icons';
import type { EditorTool } from './state/view';

/** 一个工具的展示与命令元数据。 */
export interface EditorToolSpec {
  id: EditorTool;
  /** 16px 线性图标。 */
  icon: IconComponent;
  /** 文案键（i18n 真源在 apps/web/messages）。 */
  labelKey: string;
  /** 快捷键（展示与派发同源；单键在输入区内不派发）。 */
  shortcut: string;
}

/** 工具表（顺序即工具条顺序）。 */
export const EDITOR_TOOLS: readonly EditorToolSpec[] = [
  { id: 'move', icon: MoveIcon, labelKey: 'editor.tool.move', shortcut: 'V' },
  { id: 'frame', icon: FrameIcon, labelKey: 'editor.tool.frame', shortcut: 'F' },
  { id: 'rect', icon: BoxIcon, labelKey: 'editor.tool.rect', shortcut: 'R' },
  { id: 'text', icon: TextIcon, labelKey: 'editor.tool.text', shortcut: 'T' },
  { id: 'hand', icon: HandIcon, labelKey: 'editor.tool.hand', shortcut: 'H' },
];

/** 工具对应的命令 id（`tool.<id>`；命令面板与快捷键表据此列举）。 */
export function toolCommandId(tool: EditorTool): string {
  return `tool.${tool}`;
}

/**
 * 后续票需要据 id 挂载的**预留命令 id**（壳层入口据此决定是否可点；见 `ui/topbar.tsx`）。
 *
 * 冻结约定：这些 id 由对应票注册（同 id 覆盖语义允许它们接管默认实现）；
 * 注册前入口渲染为**禁用 + 原因提示**，而不是假动作。
 */
export const RESERVED_COMMAND_IDS = {
  /** FE-06：缩放至适合（需要画布尺寸与内容包围盒）。 */
  zoomFit: 'view.zoomFit',
  /** FE-06：撤销/重做（引擎命令栈）。 */
  undo: 'edit.undo',
  redo: 'edit.redo',
  /** FE-07：评论模式开关 / 演示 / 版本历史。 */
  commentToggle: 'review.comment.toggle',
  present: 'review.present.start',
  versions: 'review.versions.open',
  /** 分享入口（归属待定：随协作票或 daemon 权限清单票）。 */
  share: 'share.open',
  /** 新建/导出（首页族与导出票；编辑器菜单里同挂入口）。 */
  newFile: 'file.new',
  exportFile: 'file.export',
} as const;
