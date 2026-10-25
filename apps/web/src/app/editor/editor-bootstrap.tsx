'use client';

/**
 * 编辑器统一客户端引导 + 声明式注册表（工单 02；spec 阶段 0「引导收口」）。
 *
 * 编辑器页只渲染「壳层 + 本引导件」；全部插槽/命令注册在这里声明、由引导统一执行：
 * - `EDITOR_SLOT_DECLARATIONS`：**插槽挂载声明表**（数据）。新增插槽 = 表里加一条
 *   （槽名 + id + order + render），不再需要任何域在自己的目录里挂 `return null` 引导件；
 * - `EDITOR_BOOTSTRAP_ENTRIES`：**域登记项**。命令注册/会话接线/门禁探针这类非插槽
 *   注册的实现仍住在各域 register 模块（画布 `mountEditorWorkspace`、评审
 *   `registerEditorReview`），本表只声明「谁参与引导、按什么顺序」。
 *
 * 为什么是客户端组件 + 挂载后执行（而不是模块顶层注册）：`'use client'` 模块会被 SSR
 * 求值一次，注册表是模块单例——服务端注册会跨请求共享；effect 里注册则服务端与客户端
 * 首帧一致（服务端空槽形态 = 客户端首帧形态），挂载后经注册表订阅填充
 * （`useSyncExternalStore`），hydration 时序脆弱性由此消除。
 *
 * 为什么本组件必须**被渲染**（页面渲染它一次即可）：Next App Router 里仅被 import、
 * 未被渲染的客户端模块不进首屏客户端图（实测：裸 import 时入口仍是禁用态）——
 * 渲染本组件同时把各域 register 模块拉进客户端图。
 *
 * 刻意不在卸载时反注册：模块单例（命令/插槽注册表、工作区/评审会话）跨路由存活，
 * SPA 离开再回来时重挂 = 同 id 覆盖幂等；`mountEditorSlotDeclarations` /
 * `runEditorBootstrapEntries` 返回的清理函数供测试与热重载使用，产品路径不消费。
 */
import { useEffect } from 'react';

import { mountEditorWorkspace } from '@/features/canvas/register';
import { DocumentSaveControl } from '@/features/canvas/workspace/save-control';
import {
  AiEntryButton,
  CanvasSlot,
  LeftPanelSlot,
  OverlaysSlot,
  RightPanelSlot,
} from '@/features/canvas/workspace/slots';
import {
  CommandPaletteSlot,
  registerCommandPalette,
  ShortcutCheatSheetSlot,
} from '@/features/command-palette/register';
import {
  ReviewCommentLayerSlot,
  ReviewCommentsPanelSlot,
  ReviewPresenterSlot,
  ReviewVersionsDrawerSlot,
  registerEditorReview,
} from '@/features/editor-review/register';
import {
  type EditorBootstrapEntry,
  type EditorSlotDeclaration,
  mountEditorSlotDeclarations,
  runEditorBootstrapEntries,
} from '@/features/editor-shell';

/**
 * 插槽挂载声明（**全部插槽在这一张表里**）。
 *
 * id 约定 `<ticket>-<feature>`；order 与既有挂载完全一致（挂载产物同位替换壳层空态，
 * 见 `features/editor-shell/slots/registry.ts` 的排序语义：order 升序，同 order 按
 * 声明顺序）。
 *
 * 导出面说明：`export` 供接线测试按票过滤（`register.test.tsx` 取 `fe-07-` 前缀重挂），
 * 产品路径仍只经本引导件在挂载后统一执行。
 */
export const EDITOR_SLOT_DECLARATIONS: readonly EditorSlotDeclaration[] = [
  // —— FE-06 工作区装配（画布 / 面板 / 保存 / AI 入口 / AI+MCP 浮层）——
  {
    slot: 'topbar-center',
    id: 'fe-06-document-save',
    order: 0,
    render: () => <DocumentSaveControl />,
  },
  { slot: 'canvas', id: 'fe-06-canvas', order: 0, render: () => <CanvasSlot /> },
  { slot: 'left-panel', id: 'fe-04-panels', order: 0, render: () => <LeftPanelSlot /> },
  { slot: 'right-panel', id: 'fe-06-right', order: 0, render: () => <RightPanelSlot /> },
  // AI 抽屉入口（D1）：工具栏按钮（命令面板走 `view.ai`，两处同一命令）
  { slot: 'toolbar', id: 'fe-10-ai-entry', order: 0, render: () => <AiEntryButton /> },
  { slot: 'overlays', id: 'fe-10-overlays', order: 10, render: () => <OverlaysSlot /> },
  // —— FE-07 评审（评论层 / 线程面板 / Present / 版本抽屉）——
  {
    slot: 'canvas',
    id: 'fe-07-comment-layer',
    order: 10,
    render: () => <ReviewCommentLayerSlot />,
  },
  {
    slot: 'right-panel',
    id: 'fe-07-comments-panel',
    order: 10,
    render: () => <ReviewCommentsPanelSlot />,
  },
  { slot: 'overlays', id: 'fe-07-presenter', order: 10, render: () => <ReviewPresenterSlot /> },
  { slot: 'overlays', id: 'fe-07-versions', order: 11, render: () => <ReviewVersionsDrawerSlot /> },
  // —— 工单 08 命令面板 + 快捷键速查（⌘/ 面板 · 长按修饰键速查卡；portal 到 body，槽位仅作挂载点）——
  {
    slot: 'overlays',
    id: 'rw-08-command-palette',
    order: 20,
    render: () => <CommandPaletteSlot />,
  },
  {
    slot: 'overlays',
    id: 'rw-08-shortcut-cheatsheet',
    order: 21,
    render: () => <ShortcutCheatSheetSlot />,
  },
];

/** 域登记项（按声明顺序执行；id 约定 `<ticket>-<domain>`）。 */
const EDITOR_BOOTSTRAP_ENTRIES: readonly EditorBootstrapEntry[] = [
  // FE-06 工作区：命令注册（含壳层预留/默认实现接管）、视口/工具/文档名同步、门禁探针、
  // 工作区一次性引导、文档桥（`?documentId=`）、查询串入口（`?shortcuts=1` / `?ai=1`）
  { id: 'fe-06-workspace', setup: mountEditorWorkspace },
  // FE-07 评审：评论 / Present / 版本命令（顶栏预留入口据此点亮）
  { id: 'fe-07-review', setup: registerEditorReview },
  // 工单 08 命令面板：`view.commandPalette` 接管注册（键位 ⌘K → 规格故事 14 的 ⌘/）
  { id: 'rw-08-command-palette', setup: registerCommandPalette },
];

/** 编辑器唯一客户端引导件（`app/editor/page.tsx` 渲染；不产生 DOM）。 */
export function EditorBootstrap(): null {
  useEffect(() => {
    // 顺序刻意先插槽后登记项：与既有行为一致（原 `WorkspaceBootstrap` 先挂槽再注册命令）；
    // 两者只写注册表，不渲染，先后不影响首帧（首帧两者都未发生）。
    mountEditorSlotDeclarations(EDITOR_SLOT_DECLARATIONS);
    runEditorBootstrapEntries(EDITOR_BOOTSTRAP_ENTRIES);
  }, []);
  return null;
}
