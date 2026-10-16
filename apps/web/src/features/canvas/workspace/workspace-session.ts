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
import { createDocument, createPage, createSelection, IDLE } from '@dforge/engine';
import {
  type ComponentPreviewState,
  createComponentsPreviewDocument,
  previewSelection as previewComponentsSelection,
} from '@/features/editor-components';
import { createPanelsSession, type PanelsSession } from '@/features/editor-panels';
import {
  createInspectPreviewDocument,
  type InspectPreviewState,
  previewSelection as previewInspectSelection,
} from '@/features/inspect-export';
import type { InspectorPreviewState } from '@/features/inspector';
import { createPreviewDocument, previewSelection } from '@/features/inspector';
import { resolveDaemonEndpointSync } from '@/lib/daemon-endpoint';

import { createDocumentsClient, type DocumentsClient } from '../persistence/documents-client';
import { type CanvasSession, createCanvasSession, type SelectionPort } from '../state/session';
import { createDocumentBridge, type DocumentBridge } from './document-bridge';

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

/**
 * 从查询串解析文档 id（首页卡片契约 `/editor?documentId=…`，见
 * `features/home/lib/routes.ts`）。空串/纯空白视为未给（不发起无意义的载入）。
 */
export function readDocumentId(search: string): string | null {
  const value = new URLSearchParams(search).get('documentId');
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
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
  /** 当前页面 id（= 面板会话的当前页；载入新文档后随之切换）。 */
  readonly pageId: PageId;
  /** 文档桥：`?documentId=` 载入、显式保存、保存态（D-2）。 */
  readonly documents: DocumentBridge;
  /**
   * 采纳一份文档（载入/导入后的唯一入口）：以 `document.replace` 命令写进共享命令栈
   * （写路径唯一性），并同步页面 id、清空选择集与画布交互态、清空历史。
   *
   * 为什么必须在**同一个栈**上替换而不是重建会话：工作区是模块级单例，各槽组件
   * 已持有 `panels` / `canvas` 的引用与订阅——重建会话会让已挂载的面板/画布指向旧对象
   * （「载入了但界面不动」）。同栈替换后所有订阅者照常收到通知。
   *
   * 「本文档对应的 daemon 文档 id」不在这里——它归文档桥的投影（`workspace.documents`）。
   *
   * @returns 文档是否被采纳（无任何页面 → 不采纳，会话保持原样）
   */
  adoptDocument(document: DesignDocument): boolean;
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

/**
 * 装配选项。
 */
export interface EditorWorkspaceOptions {
  /**
   * 文档持久化客户端（缺省：经 `@/lib/daemon-endpoint` 单点解析基址后自建）。
   * 门禁/单测显式注入（夹具 daemon）。
   */
  client?: DocumentsClient;
}

/** 装配工作区（纯函数，便于单测；浏览器里由单例调用）。 */
export function createEditorWorkspace(
  preset: WorkspacePreset,
  options: EditorWorkspaceOptions = {},
): EditorWorkspace {
  const document = documentForPreset(preset);
  const pageId = document.pages[0]?.id as PageId;
  // 生产装配开启**文档深冻结**（写路径唯一性）：装配层把快照交给整棵 UI 树，
  // 任何组件「顺手赋值」都就地抛错而不是静默绕过命令栈（历史/订阅都不知情）。
  const panels = createPanelsSession({ document, pageId, freeze: true });
  const selection = selectionForPreset(preset);
  if (selection.ids.length > 0) panels.ui.getState().setSelection(selection);
  const canvas = createCanvasSession({
    stack: panels.stack, // 文档真值：与面板同一份
    document,
    pageId,
    selectionPort: panelsSelectionPort(panels),
  });

  const client = options.client ?? createDocumentsClient({ baseUrl: resolveDaemonEndpointSync() });

  const workspace: EditorWorkspace = {
    preset,
    panels,
    canvas,
    get pageId(): PageId {
      return panels.pageId;
    },
    documents: createDocumentBridge({
      host: {
        document: () => panels.stack.getSnapshot(),
        adopt: (next) => adoptDocumentInto(workspace, next),
        subscribe: (listener) => panels.stack.subscribe(() => listener()),
      },
      client,
      // 初始名取内存文档（未落盘 → 顶栏走「未命名设计文件」占位文案）
      initial: { documentId: null, name: document.name },
    }),
    adoptDocument(next) {
      return adoptDocumentInto(workspace, next);
    },
  };
  return workspace;
}

/**
 * 采纳文档的实现（装配层私有）：一条 `document.replace` + 会话 UI 态收尾 + 清历史。
 */
function adoptDocumentInto(workspace: EditorWorkspace, document: DesignDocument): boolean {
  const firstPageId = document.pages[0]?.id;
  if (firstPageId === undefined) return false;
  const { panels, canvas } = workspace;
  panels.setPageId(firstPageId);
  // 画布 UI 态：页面 id 换血 + 交互/草稿/文本编辑/悬停全部收摊（旧页面的临时态不跨文档）
  canvas.store.setState({
    pageId: firstPageId,
    selection: createSelection([]),
    interaction: IDLE,
    snap: null,
    draft: null,
    editing: null,
    hoverId: null,
    hoverCursor: 'default',
    hud: null,
  });
  panels.ui.getState().setSelection(createSelection([]));
  // 写路径唯一：整文档替换走命令栈（结构化校验在引擎侧，非法快照整体不生效）
  panels.stack.dispatch({ type: 'document.replace', document }, { label: '载入文档' });
  // 载入不是一次「编辑」：撤销不该把用户带回内存占位文档
  panels.stack.clearHistory();
  return true;
}

/**
 * 注：daemon 基址**不再在本模块解析**——全站单点收敛到 `@/lib/daemon-endpoint`
 * （ADR-0004 裁决 ①）。收敛前这里有一套「查询参数 → env → 4318」口径，
 * 与 FE-02、FE-10 两套并存；画布侧消费方现在经各自端口工厂取同一份结果。
 */

/** 模块级单例（插槽宿主不在同一棵 Provider 树里）。 */
let singleton: EditorWorkspace | null = null;

/** 单例变化订阅（载入/导入换栈后，跨 feature 的文档消费者据此重订阅）。 */
const workspaceListeners = new Set<() => void>();

/** 单例替换/复位后广播（跨 feature 消费者重订阅新栈）。 */
function notifyWorkspace(): void {
  for (const listener of [...workspaceListeners]) listener();
}

/** 取（必要时创建）工作区单例。 */
export function getWorkspace(): EditorWorkspace {
  if (singleton === null) {
    const search = typeof window === 'undefined' ? '' : window.location.search;
    singleton = createEditorWorkspace(readWorkspacePreset(search));
  }
  return singleton;
}

/**
 * 替换工作区单例（载入/导入后换会话与栈）。
 *
 * 纪律：替换方负责把命令/视口同步/门禁探针**按新会话重挂**（`setWorkspaceBootstrap`
 * 注册的实现可重复调用，幂等）；本函数只做「换单例 + 广播」两件事，
 * 让跨 feature 的文档消费者（评审会话的文档端口）能跟着换订阅。
 */
export function setWorkspace(next: EditorWorkspace): void {
  singleton = next;
  notifyWorkspace();
}

/**
 * 订阅「工作区单例被替换/复位」（引用稳定；退订函数返回值同形）。
 *
 * 用途：评审会话的文档端口——栈被换掉后要重新订阅新栈的文档变化
 * （否则「载入新文档」之后演示判定/版本快照停在旧栈上）。
 */
export function subscribeWorkspace(listener: () => void): () => void {
  workspaceListeners.add(listener);
  return () => {
    workspaceListeners.delete(listener);
  };
}

/**
 * 一次性的浏览器引导（挂载后调用）：命令注册、视口回写、门禁探针。
 * 由槽组件在挂载后触发（见 `slots.tsx`），所以在服务端渲染阶段不会有副作用。
 */
let bootstrapped = false;

/** 注入引导实现（避免本模块反向依赖 register 造成循环导入）。 */
let bootstrapImpl: ((workspace: EditorWorkspace) => void) | null = null;

/** 注册引导实现（`register.tsx` 在模块加载时调用）。 */
export function setWorkspaceBootstrap(impl: (workspace: EditorWorkspace) => void): void {
  bootstrapImpl = impl;
  if (singleton !== null) {
    impl(singleton);
  }
}

/** 确保浏览器侧引导已执行（幂等）。 */
export function ensureWorkspaceBootstrapped(): void {
  if (bootstrapped || bootstrapImpl === null) return;
  bootstrapped = true;
  bootstrapImpl(getWorkspace());
}

/** 重置单例（测试与热重载用）。 */
export function resetWorkspace(): void {
  singleton = null;
  bootstrapped = false;
  notifyWorkspace();
}
