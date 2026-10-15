'use client';

/**
 * CanvasStudio —— 画布宿主（门禁取样页与开发调试用）。
 *
 * 定位：本票需要一条**真实可跑的画布路径**来做挂载断言与 e2e（拖画 → 持久化 → 导出/导入），
 * 而正式编辑器路由归 FE-03（尚未落地）。因此这里提供一个最小宿主：
 * 画布舞台 + 工具行 + 持久化动作（保存/重载/导出/导入）+ 调试句柄安装。
 * FE-03 合入后，编辑器路由只需组合 `createCanvasSession` + `<CanvasStage/>` 两件东西
 * （本宿主的工具行由 FE-03 的 C2 工具栏替代，持久化动作由其保存流程替代）。
 */

import type { DesignDocument } from '@dforge/engine';
import {
  countNodes,
  createDocument,
  createIdFactory,
  createPage,
  createRect,
  createViewport,
  parseDocument,
  resolveNode,
  serializeDocument,
} from '@dforge/engine';
import {
  Button,
  DownloadIcon,
  IconButton,
  RefreshIcon,
  SegmentedControl,
  Tooltip,
} from '@dforge/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { t } from '@/i18n';

import { type CanvasDebugHandle, installCanvasDebugHandle } from '../debug/canvas-debug';
import {
  createDocumentsClient,
  type DocumentsClient,
  loadDesignDocument,
  saveDesignDocument,
} from '../persistence/documents-client';
import type { SceneRenderStats } from '../render/renderer';
import { type CanvasSession, type CanvasTool, createCanvasSession } from '../state/session';
import { type CanvasRuntimeStatus, CanvasStage } from '../ui/canvas-stage';

import './studio.css';

/** 默认 daemon 基址（可由 NEXT_PUBLIC_DF_DAEMON_URL 覆盖；门禁用固定端口启动 daemon）。 */
export const DEFAULT_DAEMON_URL = process.env.NEXT_PUBLIC_DF_DAEMON_URL ?? 'http://127.0.0.1:4318';

/** 宿主 props。 */
export interface CanvasStudioProps {
  /** 从 daemon 载入的文档 id（缺省 → 内存夹具文档）。 */
  documentId?: string | null;
  /** daemon 基址。 */
  daemonUrl?: string;
  /** 是否渲染开发工具栏（默认渲染；编辑器集成时关掉）。 */
  chrome?: boolean;
  /**
   * 强制主题（默认 dark：编辑器族）。
   * 主题变量挂在 `<html data-theme>` 上（tokens.css 的 `:root[data-theme=…]`），
   * 因此这里在挂载期设置 `document.documentElement.dataset.theme`，卸载时还原。
   */
  theme?: 'light' | 'dark';
}

/** 工具行顺序（C2 的工具子集：选择/手型 + 创建类；正式工具栏归 FE-03）。 */
const TOOLS: ReadonlyArray<{ tool: CanvasTool; labelKey: string }> = [
  { tool: 'select', labelKey: 'canvas.tool.select' },
  { tool: 'hand', labelKey: 'canvas.tool.hand' },
  { tool: 'rect', labelKey: 'canvas.tool.rect' },
  { tool: 'ellipse', labelKey: 'canvas.tool.ellipse' },
  { tool: 'text', labelKey: 'canvas.tool.text' },
  { tool: 'frame', labelKey: 'canvas.tool.frame' },
];

/** 夹具文档（无 daemon 时的确定性内容；含一个矩形与一段文本）。 */
export function sampleDocument(): DesignDocument {
  const ids = createIdFactory(1);
  const rect = createRect({
    id: ids.next('n'),
    x: 120,
    y: 120,
    width: 160,
    height: 96,
    name: '矩形 1',
  });
  const page = createPage({
    id: 'page_1',
    name: '页面 1',
    rootIds: [rect.id],
    nodes: { [rect.id]: rect },
  });
  return createDocument({ id: 'doc_local', name: '画布夹具', pages: [page] });
}

/** 画布宿主。 */
export function CanvasStudio({
  documentId = null,
  daemonUrl,
  chrome = true,
  theme = 'dark',
}: CanvasStudioProps) {
  const client: DocumentsClient = useMemo(
    () => createDocumentsClient({ baseUrl: daemonUrl ?? DEFAULT_DAEMON_URL }),
    [daemonUrl],
  );
  const [session, setSession] = useState<CanvasSession>(() =>
    createCanvasSession({
      document: sampleDocument(),
      viewport: createViewport(1, 80, 60),
      ids: createIdFactory(1000),
    }),
  );
  const [runtimeStatus, setRuntimeStatus] = useState<CanvasRuntimeStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(documentId);
  const [busy, setBusy] = useState(false);
  const statsRef = useRef<SceneRenderStats | null>(null);
  /** 当前文档 id 的即时读法（state 更新是异步的，回调里读到旧值会走错分支）。 */
  const documentIdRef = useRef<string | null>(documentId);
  documentIdRef.current = currentDocumentId;

  const tool = useStore(session.store, (state) => state.tool);

  /** 替换会话（载入/导入后）：新文档 → 新命令栈 + 新 UI 态。 */
  const adoptDocument = useCallback((document: DesignDocument, id: string | null) => {
    setSession(
      createCanvasSession({
        document,
        viewport: createViewport(1, 80, 60),
        ids: createIdFactory(1000),
      }),
    );
    setCurrentDocumentId(id);
  }, []);

  /** 载入指定文档（null → 提示先保存）。 */
  const reloadDocument = useCallback(
    async (id: string | null): Promise<{ ok: boolean; error?: string }> => {
      if (id === null) {
        setNotice(t('canvas.dev.noDocument'));
        return { ok: false, error: 'no-document' };
      }
      setBusy(true);
      try {
        const loaded = await loadDesignDocument(client, id);
        if (!loaded.ok) {
          setNotice(loaded.error);
          return { ok: false, error: loaded.error };
        }
        adoptDocument(loaded.value, id);
        setNotice(t('canvas.dev.loaded', { id }));
        return { ok: true };
      } finally {
        setBusy(false);
      }
    },
    [adoptDocument, client],
  );

  /** 重载（按钮与初始载入共用）。 */
  const reload = useCallback(() => reloadDocument(documentIdRef.current), [reloadDocument]);

  /** 保存（首次保存会先在 daemon 建文档，并同步到 URL query 便于刷新恢复）。 */
  const save = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
    documentId?: string;
  }> => {
    setBusy(true);
    try {
      let documentIdToUse = documentIdRef.current;
      const document = session.document();
      if (documentIdToUse === null) {
        // 幂等：同名文档已存在（例如上次保存过）时复用它，而不是报 doc_exists
        const existing = await client.findDocumentByName(document.name);
        if (existing.ok && existing.value !== null) {
          documentIdToUse = existing.value.id;
        } else {
          const created = await client.createDocument(document.name);
          if (!created.ok) {
            setNotice(created.error);
            return { ok: false, error: created.error };
          }
          documentIdToUse = created.value.id;
        }
        setCurrentDocumentId(documentIdToUse);
        syncUrl(documentIdToUse);
      }
      const saved = await saveDesignDocument(client, documentIdToUse, document);
      if (!saved.ok) {
        setNotice(saved.error);
        return { ok: false, error: saved.error };
      }
      setNotice(t('canvas.dev.saved', { id: documentIdToUse }));
      return { ok: true, documentId: documentIdToUse };
    } finally {
      setBusy(false);
    }
  }, [client, currentDocumentId, session]);

  /** 导出 IR（稳定键序 JSON；给 e2e 的导出/导入往返）。 */
  const exportIr = useCallback((): string => serializeDocument(session.document()), [session]);

  /** 导入 IR（结构非法会被引擎打回）。 */
  const importIr = useCallback(
    (text: string): { ok: boolean; error?: string } => {
      try {
        const parsed = parseDocument(text);
        adoptDocument(parsed.document, null);
        const firstPage = parsed.document.pages[0];
        setNotice(
          t('canvas.dev.imported', { nodes: firstPage === undefined ? 0 : countNodes(firstPage) }),
        );
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setNotice(message);
        return { ok: false, error: message };
      }
    },
    [adoptDocument],
  );

  // 主题：编辑器族默认深色（与画布配色同一基准）
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = theme;
    return () => {
      if (previous === undefined) delete root.dataset.theme;
      else root.dataset.theme = previous;
    };
  }, [theme]);

  // 初始载入（query 里带 doc 时自动拉取）；query 变化也同步进 state
  useEffect(() => {
    if (documentId === null) return;
    setCurrentDocumentId(documentId);
    documentIdRef.current = documentId;
    void reloadDocument(documentId);
  }, [documentId, reloadDocument]);

  // 调试/门禁句柄（每次会话换代重装）
  useEffect(() => {
    const handle: CanvasDebugHandle = {
      version: 1,
      runtime: () =>
        runtimeStatus ?? {
          canvasKit: 'loading',
          fonts: 'loading',
          firstFrame: false,
          frameCount: 0,
          dpr: 1,
          error: null,
        },
      stats: () => statsRef.current,
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
      documentId: () => currentDocumentId,
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
      save,
      reload,
      exportIr,
      importIr,
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
    return installCanvasDebugHandle(handle);
  }, [session, runtimeStatus, currentDocumentId, save, reload, exportIr, importIr]);

  // 开发工具栏的键盘可达性：输入框聚焦时不抢键（舞台自己处理）
  return (
    <div className="dfc-studio" data-df-studio="">
      {chrome ? (
        <div className="dfc-studio__bar">
          <SegmentedControl
            label={t('canvas.dev.tools')}
            size="sm"
            value={tool}
            options={TOOLS.map((entry) => ({
              value: entry.tool,
              label: t(entry.labelKey),
            }))}
            onChange={(value) => {
              session.setTool(value as CanvasTool);
            }}
          />
          <div className="dfc-studio__actions">
            <span className="dfc-studio__notice" data-df-studio-notice="">
              {notice ?? (currentDocumentId === null ? t('canvas.dev.local') : currentDocumentId)}
            </span>
            <Tooltip content={t('canvas.dev.save')}>
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                data-df-studio-action="save"
                onClick={() => {
                  void save();
                }}
              >
                {t('canvas.dev.save')}
              </Button>
            </Tooltip>
            <Tooltip content={t('canvas.dev.reload')}>
              <IconButton
                label={t('canvas.dev.reload')}
                icon={<RefreshIcon />}
                size="sm"
                data-df-studio-action="reload"
                onClick={() => {
                  void reload();
                }}
              />
            </Tooltip>
            <Tooltip content={t('canvas.dev.export')}>
              <IconButton
                label={t('canvas.dev.export')}
                icon={<DownloadIcon />}
                size="sm"
                data-df-studio-action="export"
                onClick={() => {
                  const text = exportIr();
                  void navigator.clipboard?.writeText(text).catch(() => undefined);
                  setNotice(t('canvas.dev.exported', { bytes: text.length }));
                }}
              />
            </Tooltip>
            <Tooltip content={t('canvas.dev.import')}>
              <IconButton
                label={t('canvas.dev.import')}
                icon={<DownloadIcon />}
                size="sm"
                data-df-studio-action="import"
                onClick={() => {
                  // 导入入口：门禁/e2e 直接调句柄的 importIr；界面按钮走剪贴板
                  void navigator.clipboard
                    ?.readText()
                    .then((text) => {
                      if (text.length > 0) importIr(text);
                    })
                    .catch(() => undefined);
                }}
              />
            </Tooltip>
          </div>
        </div>
      ) : null}
      <CanvasStage
        session={session}
        theme={theme}
        onStatus={setRuntimeStatus}
        onFrame={(stats) => {
          statsRef.current = stats;
        }}
      />
      {chrome ? (
        <div className="dfc-studio__hint" data-df-studio-hint="">
          {t('canvas.dev.hint')}
        </div>
      ) : null}
    </div>
  );
}

/** 把当前文档 id 写进地址栏（刷新后可恢复）。 */
function syncUrl(documentId: string): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('doc', documentId);
  window.history.replaceState(null, '', url.toString());
}
