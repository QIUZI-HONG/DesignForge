'use client';

/**
 * 编辑器工作区会话（FE-06 作为 `/editor` 宿主的**装配层**）。
 *
 * 装配原则（跨票纪律）：
 * - **不复制别人的状态**：文档真值用 FE-04 的 `PanelsSession`（它自己就是「命令栈 + 选择集 store」，
 *   且面板在它之上渲染），画布会话通过 `stack` + `selectionPort` 注入与之**共享同一份**，
 *   于是「画布选中 = 图层面板高亮」「画布改文档 = 面板即时刷新」天然成立；
 * - **不改别人的目录**：FE-03 留了具名插槽，本模块只做注册与组装；
 * - 预设协议（各票门禁的宿主约定）在 `readWorkspacePreset()` 里集中解析：
 *   `?df-state=`（FE-05）· `?df-inspect=` / `?df-components=`（FE-08）。
 *
 * 模块级单例：插槽宿主（FE-03）渲染各槽时不在同一棵 Provider 树里，
 * 因此装配结果放在模块级单例上，各槽组件调用 `getWorkspace()` 取同一份。
 * 单例只在浏览器侧创建（槽组件都是客户端组件）。
 */

import type { DesignDocument, PageId, Selection } from '@dforge/engine';
import { createDocument, createPage } from '@dforge/engine';
import {
  type ComponentPreviewState,
  createComponentsPreviewDocument,
  previewSelection as previewComponentsSelection,
} from '@/features/editor-components/preview';
import { createPanelsSession, type PanelsSession } from '@/features/editor-panels';
import {
  createInspectPreviewDocument,
  type InspectPreviewState,
  previewSelection as previewInspectSelection,
} from '@/features/inspect-export/preview';
import type { InspectorPreviewState } from '@/features/inspector';
import { createPreviewDocument, previewSelection } from '@/features/inspector';

import { type CanvasSession, createCanvasSession, type SelectionPort } from '../state/session';

/** 工作区预设（各票门禁的宿主协议）。 */
export interface WorkspacePreset {
  /** FE-05 Inspector 三态（`?df-state=`）。 */
  inspector: InspectorPreviewState | null;
  /** FE-08 检查三态（`?df-inspect=`）。 */
  inspect: InspectPreviewState | null;
  /** FE-08 组件五态（`?df-components=`）。 */
  components: ComponentPreviewState | null;
}

/** 空预设。 */
export const EMPTY_PRESET: WorkspacePreset = { inspector: null, inspect: null, components: null };

/** 从查询串解析预设（非法值 → null，不抛）。 */
export function readWorkspacePreset(search: string): WorkspacePreset {
  const params = new URLSearchParams(search);
  const pick = <T extends string>(key: string, allowed: readonly T[]): T | null => {
    const value = params.get(key);
    if (value === null) return null;
    return (allowed as readonly string[]).includes(value) ? (value as T) : null;
  };
  return {
    inspector: pick('df-state', ['default', 'mixed', 'empty'] as const),
    inspect: pick('df-inspect', ['bound', 'unbound', 'empty'] as const),
    components: pick('df-components', [
      'plain',
      'component',
      'instance',
      'variant',
      'missing',
    ] as const),
  };
}

/** 预设 → 文档（未命中预设时给一个最小可编辑文档）。 */
export function documentForPreset(preset: WorkspacePreset): DesignDocument {
  if (preset.inspector !== null) return createPreviewDocument();
  if (preset.inspect !== null) return createInspectPreviewDocument();
  if (preset.components !== null) return createComponentsPreviewDocument(preset.components);
  return createDocument({
    id: 'doc-editor',
    name: '未命名文件',
    pages: [createPage({ id: 'page-editor', name: '页面 1' })],
  });
}

/** 预设 → 初始选择集。 */
export function selectionForPreset(preset: WorkspacePreset): Selection {
  if (preset.inspector !== null) return previewSelection(preset.inspector);
  if (preset.inspect !== null) return previewInspectSelection(preset.inspect);
  if (preset.components !== null) return previewComponentsSelection(preset.components);
  return { ids: [], activeId: null };
}

/** 工作区装配结果。 */
export interface EditorWorkspace {
  preset: WorkspacePreset;
  /** 文档真值 + 选择集的宿主（FE-04 面板也在它之上渲染）。 */
  panels: PanelsSession;
  /** 画布会话（共享上面那份命令栈与选择集）。 */
  canvas: CanvasSession;
  /** 当前页面 id。 */
  pageId: PageId;
}

/** 由面板 UI store 造选择集端口（画布 ⇄ 面板同源）。 */
export function panelsSelectionPort(panels: PanelsSession): SelectionPort {
  return {
    get: () => panels.ui.getState().selection,
    set: (selection) => {
      panels.ui.getState().setSelection(selection);
    },
    subscribe: (listener) => panels.ui.subscribe(() => listener()),
  };
}

/** 装配工作区（纯函数，便于单测；浏览器里由单例调用）。 */
export function createEditorWorkspace(preset: WorkspacePreset): EditorWorkspace {
  const document = documentForPreset(preset);
  const pageId = document.pages[0]?.id as PageId;
  const panels = createPanelsSession({ document, pageId });
  const selection = selectionForPreset(preset);
  if (selection.ids.length > 0) panels.ui.getState().setSelection(selection);
  const canvas = createCanvasSession({
    stack: panels.stack, // 文档真值：与面板同一份
    document,
    pageId,
    selectionPort: panelsSelectionPort(panels),
  });
  return { preset, panels, canvas, pageId };
}

/** 模块级单例（插槽宿主不在同一棵 Provider 树里）。 */
let singleton: EditorWorkspace | null = null;

/** 取（必要时创建）工作区单例。 */
export function getWorkspace(): EditorWorkspace {
  if (singleton === null) {
    const search = typeof window === 'undefined' ? '' : window.location.search;
    singleton = createEditorWorkspace(readWorkspacePreset(search));
  }
  return singleton;
}

/** 重置单例（测试与热重载用）。 */
export function resetWorkspace(): void {
  singleton = null;
}
