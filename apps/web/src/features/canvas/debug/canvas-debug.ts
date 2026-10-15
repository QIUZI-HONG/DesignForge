/**
 * 门禁/调试句柄（`window.__dforgeCanvas`）。
 *
 * 定位：`scripts/verify-canvas.mjs` 的挂载断言与人工调试都通过它读**真实运行时状态**
 * （帧计数、视口、选择、节点几何、Skia/字体就绪、持久化往返），
 * 而不是靠 DOM 结构猜语义。句柄只读多、写少（写只给「门禁需要确定性状态」的场景），
 * 且**不绕过引擎**：所有写操作仍走会话方法（命令栈）。
 */

import { resolveNode, serializeDocument } from '@dforge/engine';

import type { SceneRenderStats } from '../render/renderer';
import type { CanvasSession } from '../state/session';
import type { CanvasRuntimeStatus } from '../ui/canvas-stage';

/** 全局键名（门禁与调试唯一入口）。 */
export const CANVAS_DEBUG_KEY = '__dforgeCanvas';

/** 节点几何（门禁断言用）。 */
export interface DebugNodeGeometry {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** 持久化操作结果。 */
export interface DebugIoResult {
  ok: boolean;
  error?: string;
  documentId?: string;
}

/** 门禁/调试句柄形状。 */
export interface CanvasDebugHandle {
  version: 1;
  /** 运行时状态（Skia/字体/首帧/帧计数/DPR）。 */
  runtime: () => CanvasRuntimeStatus;
  /** 最近一帧的渲染统计（画了什么）。 */
  stats: () => SceneRenderStats | null;
  viewport: () => { zoom: number; panX: number; panY: number };
  zoomPercent: () => number;
  selection: () => string[];
  nodeIds: () => string[];
  geometry: (id: string) => DebugNodeGeometry | null;
  nodeCount: () => number;
  pageId: () => string;
  documentName: () => string;
  documentId: () => string | null;
  hud: () => string | null;
  editingText: () => { nodeId: string; characters: string } | null;
  /** 文本节点内容（门禁断言文本提交；非文本节点 → null）。 */
  textContent: (id: string) => string | null;
  /** 吸附开关（门禁需要在确定性位移与吸附行为之间切换）。 */
  setSnap: (enabled: boolean) => void;
  error: () => string | null;
  /** 持久化：保存 / 重新加载（断言⑥的往返）。 */
  save: () => Promise<DebugIoResult>;
  reload: () => Promise<DebugIoResult>;
  exportIr: () => string;
  importIr: (text: string) => DebugIoResult;
  /** 确定性状态注入（门禁需要在已知视口/选择下取证）。 */
  setViewport: (patch: { zoom?: number; panX?: number; panY?: number }) => void;
  select: (ids: readonly string[]) => void;
  /** 建一个矩形（拖画路径的等价入口；门禁用它准备夹具）。 */
  createRect: (bounds: { x: number; y: number; width: number; height: number }) => string;
  /** 会话本体（进阶调试；门禁不依赖它）。 */
  session: () => CanvasSession;
}

/** 安装句柄（返回卸载函数）。 */
export function installCanvasDebugHandle(handle: CanvasDebugHandle): () => void {
  const previous = (globalThis as Record<string, unknown>)[CANVAS_DEBUG_KEY];
  (globalThis as Record<string, unknown>)[CANVAS_DEBUG_KEY] = handle;
  return () => {
    if (previous === undefined) {
      delete (globalThis as Record<string, unknown>)[CANVAS_DEBUG_KEY];
      return;
    }
    (globalThis as Record<string, unknown>)[CANVAS_DEBUG_KEY] = previous;
  };
}

/**
 * 造「会话侧」调试句柄字段（不含持久化动作）。
 *
 * 两个宿主共用：`/_canvas` 取样页（CanvasStudio，另补保存/重载/导入导出）与
 * `/editor` 工作区（画布槽）——两边都能被门禁以同一套读点断言。
 */
export function sessionDebugHandle(options: {
  session: CanvasSession;
  runtime: () => CanvasRuntimeStatus;
  stats: () => SceneRenderStats | null;
  documentId?: () => string | null;
  extras?: Partial<Pick<CanvasDebugHandle, 'save' | 'reload' | 'exportIr' | 'importIr'>>;
}): CanvasDebugHandle {
  const { session, runtime, stats } = options;
  return {
    version: 1,
    runtime,
    stats,
    viewport: () => session.viewport(),
    zoomPercent: () => Math.round(session.viewport().zoom * 100),
    selection: () => [...session.selection().ids],
    nodeIds: () => [...session.page().rootIds],
    geometry: (id) => {
      const node = resolveNode(session.page(), id);
      if (node === undefined) return null;
      return {
        id: node.id,
        type: node.type,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rotation: node.rotation,
      };
    },
    nodeCount: () => Object.keys(session.page().nodes).length,
    pageId: () => session.page().id,
    documentName: () => session.document().name,
    documentId: options.documentId ?? (() => null),
    hud: () => session.store.getState().hud,
    editingText: () => {
      const editing = session.store.getState().editing;
      return editing === null
        ? null
        : { nodeId: editing.nodeId, characters: editing.content.characters };
    },
    textContent: (id) => {
      const node = resolveNode(session.page(), id);
      return node !== undefined && node.type === 'text' ? node.text.characters : null;
    },
    setSnap: (enabled) => {
      session.setSnapEnabled(enabled);
    },
    error: () => session.store.getState().error,
    save: options.extras?.save ?? (async () => ({ ok: false, error: '未接入持久化' })),
    reload: options.extras?.reload ?? (async () => ({ ok: false, error: '未接入持久化' })),
    exportIr: options.extras?.exportIr ?? (() => serializeDocument(session.document())),
    importIr: options.extras?.importIr ?? (() => ({ ok: false, error: '未接入导入' })),
    setViewport: (patch) => {
      const viewport = session.viewport();
      session.store.setState({
        viewport: {
          zoom: patch.zoom ?? viewport.zoom,
          panX: patch.panX ?? viewport.panX,
          panY: patch.panY ?? viewport.panY,
        },
      });
    },
    select: (ids) => {
      session.setSelection(ids);
    },
    createRect: (bounds) => session.createRect(bounds),
    session: () => session,
  };
}

/** 读句柄（无则 null）。 */
export function readCanvasDebugHandle(): CanvasDebugHandle | null {
  const value = (globalThis as Record<string, unknown>)[CANVAS_DEBUG_KEY];
  return typeof value === 'object' && value !== null ? (value as CanvasDebugHandle) : null;
}
