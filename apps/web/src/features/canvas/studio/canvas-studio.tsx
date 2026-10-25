'use client';

/**
 * CanvasStudio —— 画布宿主（门禁取样页与开发调试用）。
 *
 * 定位：本票需要一条**真实可跑的画布路径**来做挂载断言与 e2e（拖画 → 持久化 → 导出/导入），
 * 而正式编辑器路由归 FE-03（尚未落地）。因此这里提供一个最小宿主：
 * 画布舞台 + 工具行 + 持久化动作（保存/重载/导出/导入）+ 调试句柄安装。
 * FE-03 合入后，编辑器路由只需组合 `createCanvasSession` + `<CanvasStage/>` 两件东西
 * （本宿主的工具行由 FE-03 的 C2 工具栏替代，持久化动作由其保存流程替代）。
 *
 * 载入/保存编排（A2 复核整改）：**不在本宿主自编一套**——与 `/editor` 工作区共用
 * `workspace/document-bridge.ts` 的**单点编排**（幂等落盘、URL 同步、保存态、载入替换
 * 全部在那里）。本宿主只做两件宿主侧的事：会话装配（React state 持有 `CanvasSession`，
 * 载入/导入时整会话换代——`/_canvas` 没有面板/多槽消费方，换会话即换真值）与
 * 展示层（notice/busy）。文档桥的 host 接缝由下面的 `sessionCell` 提供（会话换代时
 * 订阅迁移到新命令栈，桥的「未保存」判定不因换代失真）。
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
  BoxIcon,
  Button,
  DownloadIcon,
  FrameIcon,
  IconButton,
  MoveIcon,
  RefreshIcon,
  TextIcon,
  Tooltip,
} from '@dforge/ui';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { t } from '@/i18n';
import { resolveDaemonEndpointSync } from '@/lib/daemon-endpoint';

import { type CanvasDebugHandle, installCanvasDebugHandle } from '../debug/canvas-debug';
import { createDocumentsClient, type DocumentsClient } from '../persistence/documents-client';
import { createFramePerfRecorder, type FramePerfRecorder } from '../render/frame-perf';
import type { SceneRenderStats } from '../render/renderer';
import { type CanvasSession, type CanvasTool, createCanvasSession } from '../state/session';
import { type CanvasRuntimeStatus, CanvasStage } from '../ui/canvas-stage';
import { createDocumentBridge } from '../workspace/document-bridge';

import './studio.css';

/**
 * 默认 daemon 基址：由 `@/lib/daemon-endpoint` 全站单点解析
 * （`?daemon=` → `NEXT_PUBLIC_DF_DAEMON_URL` → 缺省端口窗起点；ADR-0004 裁决 ①）。
 */
export const DEFAULT_DAEMON_URL = resolveDaemonEndpointSync();

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

/**
 * 工具行（C2 的工具子集：选择/手型 + 创建类；**正式工具栏归 FE-03**，这里是宿主的临时工具行）。
 * 每个按钮带 `data-df-studio-tool="<tool>"`：门禁与 e2e 用它确定性地切工具（不靠图标猜）。
 */
const TOOLS: ReadonlyArray<{ tool: CanvasTool; labelKey: string }> = [
  { tool: 'select', labelKey: 'canvas.tool.select' },
  { tool: 'hand', labelKey: 'canvas.tool.hand' },
  { tool: 'rect', labelKey: 'canvas.tool.rect' },
  { tool: 'ellipse', labelKey: 'canvas.tool.ellipse' },
  { tool: 'text', labelKey: 'canvas.tool.text' },
  { tool: 'frame', labelKey: 'canvas.tool.frame' },
];

/** 工具图标（手型/选择共用指针图标；图标几何归 FE-01，不另造）。 */
function toolIcon(tool: CanvasTool): ReactNode {
  switch (tool) {
    case 'text':
      return <TextIcon />;
    case 'frame':
      return <FrameIcon />;
    case 'rect':
    case 'ellipse':
      return <BoxIcon />;
    default:
      return <MoveIcon />;
  }
}

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
  // 页面名走引擎缺省（`createPage` 的 `'页面 1'`）：默认名单一真源，宿主不另抄一份
  const page = createPage({
    id: 'page_1',
    rootIds: [rect.id],
    nodes: { [rect.id]: rect },
  });
  return createDocument({ id: 'doc_local', name: '画布夹具', pages: [page] });
}

/** 新建宿主会话（初版与载入/导入换代共用同一口径）。 */
function createStudioSession(document: DesignDocument): CanvasSession {
  return createCanvasSession({
    document,
    viewport: createViewport(1, 80, 60),
    ids: createIdFactory(1000),
  });
}

/**
 * 会话单元：承载「当前会话」并把命令行栈的订阅**跨会话换代**迁移
 * （载入/导入会整会话替换；文档桥在创建时订阅一次，换代后旧栈不再发变更，
 * 「未保存」判定会失真——故订阅在这里跟着换代走）。
 */
function createSessionCell(initial: CanvasSession) {
  let current = initial;
  let unsubscribeStack: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const attach = (session: CanvasSession): void => {
    unsubscribeStack?.();
    current = session;
    unsubscribeStack = session.stack.subscribe(() => {
      for (const listener of [...listeners]) listener();
    });
  };
  attach(initial);
  return {
    get: () => current,
    set: (session: CanvasSession): void => {
      attach(session);
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: (): void => {
      unsubscribeStack?.();
      unsubscribeStack = null;
      listeners.clear();
    },
  };
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
    createStudioSession(sampleDocument()),
  );
  const [runtimeStatus, setRuntimeStatus] = useState<CanvasRuntimeStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const statsRef = useRef<SceneRenderStats | null>(null);
  // 帧性能记录器（渲染观测 seam）：帧闭包喂样本，门禁经 __dforgeCanvas.perf() 按需读快照
  const perfRef = useRef<FramePerfRecorder | null>(null);
  if (perfRef.current === null) perfRef.current = createFramePerfRecorder();
  /** 会话单元：桥的 host 接缝（订阅随换代迁移）；初值为首版会话。 */
  const sessionCell = useMemo(() => createSessionCell(session), []);

  /**
   * 文档桥（载入/保存**单点编排**，见 `workspace/document-bridge.ts`）：
   * - 载入 `?doc=`（宿主自己的参数名经 `syncUrlParam` 传入，编排仍在桥内一处）；
   * - 保存：未落盘先按名幂等落盘（同名复用）；URL 同步由桥做。
   */
  const bridge = useMemo(
    () =>
      createDocumentBridge({
        host: {
          document: () => sessionCell.get().document(),
          adopt: (document) => {
            const next = createStudioSession(document);
            sessionCell.set(next);
            setSession(next);
            // 落盘身份归桥（`documentId` 投影）——此处只确认「有页面可采纳」
            return document.pages.length > 0;
          },
          subscribe: (listener) => sessionCell.subscribe(listener),
        },
        client,
        initial: { documentId, name: sessionCell.get().document().name },
        // `/_canvas` 宿主页读 `?doc=`（编辑器读 `?documentId=`）——参数名是宿主契约
        syncUrlParam: 'doc',
      }),
    [client, sessionCell, documentId],
  );
  // 桥随客户端/宿主换代时退订旧桥（订阅挂在会话单元上，不能只靠 GC）
  useEffect(() => () => bridge.dispose(), [bridge]);
  // 会话单元的生命周期也跟着组件走
  useEffect(() => () => sessionCell.dispose(), [sessionCell]);

  const tool = useStore(session.store, (state) => state.tool);
  /** 当前文档 id（桥的投影；notice 缺省显示用它）。 */
  const currentDocumentId = useStore(bridge.store, (state) => state.documentId);

  /** 载入指定文档（null → 提示先保存）；编排全在桥（loadDesignDocument + adopt + 落盘身份）。 */
  const reloadDocument = useCallback(
    async (id: string | null): Promise<{ ok: boolean; error?: string }> => {
      if (id === null) {
        setNotice(t('canvas.dev.noDocument'));
        return { ok: false, error: 'no-document' };
      }
      setBusy(true);
      try {
        const result = await bridge.load(id);
        if (!result.ok) {
          setNotice(result.error ?? '');
          return { ok: false, error: result.error ?? 'load-failed' };
        }
        setNotice(t('canvas.dev.loaded', { id }));
        return { ok: true };
      } finally {
        setBusy(false);
      }
    },
    [bridge],
  );

  /** 重载（按钮与初始载入共用）。 */
  const reload = useCallback(
    () => reloadDocument(bridge.store.getState().documentId),
    [bridge, reloadDocument],
  );

  /** 保存（未落盘 → 桥先按名幂等落盘；URL 同步也在桥内）。 */
  const save = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
    documentId?: string;
  }> => {
    setBusy(true);
    try {
      const result = await bridge.save();
      if (!result.ok) {
        setNotice(result.error ?? '');
        return { ok: false, error: result.error ?? 'save-failed' };
      }
      setNotice(t('canvas.dev.saved', { id: result.documentId ?? '' }));
      return result.documentId === undefined
        ? { ok: true }
        : { ok: true, documentId: result.documentId };
    } finally {
      setBusy(false);
    }
  }, [bridge]);

  /** 导出 IR（稳定键序 JSON；给 e2e 的导出/导入往返）。 */
  const exportIr = useCallback(
    (): string => serializeDocument(sessionCell.get().document()),
    [sessionCell],
  );

  /** 导入 IR（结构非法会被引擎打回）；导入走桥的**本地替换**（清落盘身份，不写回上一份文档）。 */
  const importIr = useCallback(
    (text: string): { ok: boolean; error?: string } => {
      try {
        const parsed = parseDocument(text);
        if (!bridge.adoptLocal(parsed.document)) {
          return { ok: false, error: '文档无可用页面' };
        }
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
    [bridge],
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

  // 初始载入（query 里带 doc 时自动拉取）；query 变化也同步重载
  useEffect(() => {
    if (documentId === null) return;
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
      perf: () => perfRef.current?.snapshot() ?? null,
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
      documentId: () => bridge.store.getState().documentId,
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
  }, [session, runtimeStatus, bridge, save, reload, exportIr, importIr]);

  // 开发工具栏的键盘可达性：输入框聚焦时不抢键（舞台自己处理）
  return (
    <div className="dfc-studio" data-df-studio="">
      {chrome ? (
        <div className="dfc-studio__bar">
          <div className="dfc-studio__tools" role="toolbar" aria-label={t('canvas.dev.tools')}>
            {TOOLS.map((entry) => (
              <Tooltip key={entry.tool} content={t(entry.labelKey)}>
                <IconButton
                  label={t(entry.labelKey)}
                  icon={toolIcon(entry.tool)}
                  size="sm"
                  variant={tool === entry.tool ? 'primary' : 'ghost'}
                  pressed={tool === entry.tool}
                  data-df-studio-tool={entry.tool}
                  onClick={() => {
                    session.setTool(entry.tool);
                  }}
                />
              </Tooltip>
            ))}
          </div>
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
        onFrame={(stats, timing) => {
          statsRef.current = stats;
          perfRef.current?.record(timing);
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
