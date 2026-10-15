'use client';

/**
 * CanvasStage —— 画布舞台（C8）：canvas 元素 + rAF 渲染循环 + 覆盖层接线。
 *
 * 一帧的组装方式（渲染只消费引擎状态，`_shared.md` §3）：
 * `session.frameInput()`（文档/视口/选择/交互/预览/草稿） + 令牌配色 + DPR 尺度
 * → `SceneRenderer.render(frame, overlay)`；React **不参与**每帧绘制
 * （store 变化只调用 `frameLoop.request()`，rAF 合并到一次绘制）。
 *
 * 生命周期：
 * - 挂载：加载 CanvasKit → 注册 Noto Sans SC → 建 surface（WebGL）→ 启动循环；
 * - 尺寸/DPR：ResizeObserver（无该 API 时退化为 window resize）→ `resize(size, dpr)`；
 * - 卸载：停循环、解绑适配器、释放 Skia 对象与 surface。
 */

import type { Size } from '@dforge/engine';
import type { ThemeName } from '@dforge/ui';
import type { CanvasKit, FontMgr } from 'canvaskit-wasm';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { t } from '@/i18n';

import { selectionFrameOf } from '../input/hit';
import { dispatchKeyDown, handleSpaceDown, handleSpaceUp } from '../input/keyboard';
import { attachPointerAdapter } from '../input/pointer';
import { createFrameLoop, type FrameLoop } from '../render/frame-loop';
import { type CanvasPalette, canvasPalette } from '../render/palette';
import { createSceneRenderer, type SceneRenderer, type SceneRenderStats } from '../render/renderer';
import { loadCanvasKit } from '../runtime/canvaskit-loader';
import { loadSceneFonts, SCENE_FONT_FAMILY } from '../runtime/scene-fonts';
import type { CanvasSession } from '../state/session';
import { CanvasHud, type CanvasHudSink } from './canvas-hud';
import { CanvasContextMenu } from './context-menu';
import { FloatingToolbar } from './floating-toolbar';
import { TextOverlay } from './text-overlay';

import './canvas.css';

/** 运行时状态（状态区/门禁读它）。 */
export interface CanvasRuntimeStatus {
  canvasKit: 'loading' | 'ready' | 'error';
  fonts: 'loading' | 'ready' | 'error';
  /** 首帧是否已出（门禁断言②）。 */
  firstFrame: boolean;
  /** 已完成帧数（门禁断言②的计数）。 */
  frameCount: number;
  /** 渲染目标 DPR（DPR 感知：backing store = CSS 尺寸 × dpr）。 */
  dpr: number;
  /** 失败原因（Skia/字体/渲染目标）。 */
  error: string | null;
}

/** CanvasStage props。 */
export interface CanvasStageProps {
  session: CanvasSession;
  /** 主题（编辑器族默认深色）。 */
  theme?: ThemeName;
  /** 每帧回调（调试/门禁统计；每帧调用，勿在其中 setState）。 */
  onFrame?: (stats: SceneRenderStats) => void;
  /** 运行时状态变化回调（只在状态跃迁时触发）。 */
  onStatus?: (status: CanvasRuntimeStatus) => void;
  /**
   * 外接 HUD（编辑器壳的 `useCanvasHud()`）。给出后本组件**不再自渲**小条，
   * 而是把会话里的 HUD 文案转发给宿主（C20 的显示位置由壳层决定）。
   */
  hud?: CanvasHudSink;
  /**
   * 交给宿主（壳层命令注册表）接管的快捷键 id 列表——命中即不执行，
   * 避免「画布与壳层各执行一遍」（例如 ⌘Z 撤销两次）。
   */
  coveredShortcutIds?: readonly string[];
  style?: CSSProperties;
  className?: string;
}

/** 初始状态。 */
const INITIAL_STATUS: CanvasRuntimeStatus = {
  canvasKit: 'loading',
  fonts: 'loading',
  firstFrame: false,
  frameCount: 0,
  dpr: 1,
  error: null,
};

/** 画布舞台。 */
export function CanvasStage({
  session,
  theme = 'dark',
  onFrame,
  onStatus,
  hud,
  coveredShortcutIds,
  style,
  className,
}: CanvasStageProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const loopRef = useRef<FrameLoop | null>(null);
  const statusRef = useRef<CanvasRuntimeStatus>(INITIAL_STATUS);
  const [status, setStatus] = useState<CanvasRuntimeStatus>(INITIAL_STATUS);
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const [menuEpoch, setMenuEpoch] = useState(0);
  /** 尺寸与回调走 ref：渲染循环每帧读取，避免闭包捕获旧值 / 依赖重建 Skia。 */
  const sizeRef = useRef<Size>({ width: 0, height: 0 });
  const palette = useMemo(() => canvasPalette(theme), [theme]);
  const paletteRef = useRef<CanvasPalette>(palette);
  const coveredRef = useRef<readonly string[] | undefined>(coveredShortcutIds);
  coveredRef.current = coveredShortcutIds;
  const onFrameRef = useRef<CanvasStageProps['onFrame']>(onFrame);
  const onStatusRef = useRef<CanvasStageProps['onStatus']>(onStatus);
  paletteRef.current = palette;
  onFrameRef.current = onFrame;
  onStatusRef.current = onStatus;

  /** 状态跃迁（只在变化时 setState —— 渲染循环里不允许触发 React 渲染）。 */
  const pushStatus = (patch: Partial<CanvasRuntimeStatus>): void => {
    const next = { ...statusRef.current, ...patch };
    statusRef.current = next;
    setStatus(next);
    onStatusRef.current?.(next);
  };

  /** 同步状态（不 setState；帧内用）。 */
  const syncStatus = (patch: Partial<CanvasRuntimeStatus>): CanvasRuntimeStatus => {
    const next = { ...statusRef.current, ...patch };
    statusRef.current = next;
    return next;
  };

  // 文档变化（命令栈）与 UI 变化都要触发重画：循环内部合并（rAF）
  useEffect(() => {
    const request = (): void => {
      loopRef.current?.request();
    };
    const unsubscribeUi = session.store.subscribe(request);
    const unsubscribeDoc = session.stack.subscribe(request);
    return () => {
      unsubscribeUi();
      unsubscribeDoc();
    };
  }, [session]);

  // 初始化 Skia + 字体 + surface + 循环
  useEffect(() => {
    let disposed = false;
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;

    const boot = async (): Promise<void> => {
      try {
        const canvasKit: CanvasKit = await loadCanvasKit();
        if (disposed) return;
        pushStatus({ canvasKit: 'ready' });

        let fontMgr: FontMgr | null = null;
        try {
          const fonts = await loadSceneFonts(canvasKit);
          fontMgr = fonts.fontMgr;
          if (fonts.registered === 0) {
            // 字体缺失是**错误态**（ADR-0003：不得静默回退到别的字体）
            pushStatus({ fonts: 'error', error: `字体缺失 ${fonts.missing.length} 个` });
          } else {
            pushStatus({ fonts: 'ready' });
          }
        } catch (error) {
          if (!disposed) pushStatus({ fonts: 'error', error: messageOf(error) });
        }
        if (disposed) return;

        const renderer = createSceneRenderer({
          canvasKit,
          fonts: fontMgr === null ? null : { family: SCENE_FONT_FAMILY, fontMgr },
          makeSurface: (width, height) => {
            // 设备像素尺寸写进 backing store（CSS 尺寸由样式 100% 决定）
            canvas.width = width;
            canvas.height = height;
            return canvasKit.MakeWebGLCanvasSurface(canvas, undefined, {}) ?? null;
          },
        });
        rendererRef.current = renderer;

        const shell = shellRef.current;
        const size = {
          width: Math.max(1, Math.round(shell?.clientWidth ?? canvas.clientWidth)),
          height: Math.max(1, Math.round(shell?.clientHeight ?? canvas.clientHeight)),
        };
        sizeRef.current = size;
        session.setViewportSize(size);
        const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
        renderer.resize(size, dpr);

        const loop = createFrameLoop(() => {
          const input = session.frameInput();
          const stats = renderer.render(
            {
              page: input.page,
              palette: paletteRef.current,
              viewport: input.viewport,
              scale: { size: sizeRef.current, dpr },
              selection: input.selection,
              hoverId: input.hoverId,
              interaction: input.interaction,
              preview: input.preview,
              marquee: input.marquee,
              draft: input.draft,
              rulers: input.rulers,
              editingNodeId: input.editing?.nodeId ?? null,
            },
            {
              selectionFrame: selectionFrameOf(input.page, input.selection),
              selectionLabels: selectionLabels(session),
              snap: input.interaction.kind === 'move' ? session.store.getState().snap : null,
            },
          );
          const previous = statusRef.current;
          const next = syncStatus({
            frameCount: previous.frameCount + 1,
            firstFrame: true,
          });
          // 只在首次出帧时通知 React（每帧 setState 会把渲染循环拖回 React）
          if (!previous.firstFrame) {
            setStatus(next);
            onStatusRef.current?.(next);
          }
          onFrameRef.current?.(stats);
        });
        loopRef.current = loop;
        loop.request();
      } catch (error) {
        if (!disposed) pushStatus({ canvasKit: 'error', error: messageOf(error) });
      }
    };

    void boot();
    return () => {
      disposed = true;
      loopRef.current?.stop();
      loopRef.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [session]);

  // 尺寸与 DPR 感知
  useEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return undefined;
    const apply = (): void => {
      const size = {
        width: Math.max(1, Math.round(shell.clientWidth)),
        height: Math.max(1, Math.round(shell.clientHeight)),
      };
      sizeRef.current = size;
      session.setViewportSize(size);
      const renderer = rendererRef.current;
      const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
      if (renderer !== null) {
        renderer.resize(size, dpr);
        pushStatus({ dpr });
        loopRef.current?.request();
      }
    };
    apply();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', apply);
      return () => {
        window.removeEventListener('resize', apply);
      };
    }
    const observer = new ResizeObserver(apply);
    observer.observe(shell);
    return () => {
      observer.disconnect();
    };
  }, [session]);

  // 指针适配器（DOM → 会话语义输入）
  useEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return undefined;
    const adapter = attachPointerAdapter({
      element: shell,
      session,
      requestRender: () => {
        loopRef.current?.request();
      },
      onContextMenu: (point) => {
        setMenuPoint(point);
        setMenuEpoch((value) => value + 1);
      },
    });
    return () => adapter.dispose();
  }, [session]);

  // 键盘（快捷键分发表 + 空格临时手型）
  useEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      // 输入框/文本域内的按键不劫持（文本覆盖层自己处理）
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (event.key === ' ') {
        event.preventDefault();
        handleSpaceDown(session);
        return;
      }
      const result = dispatchKeyDown(
        session,
        {
          key: event.key,
          meta: event.metaKey,
          ctrl: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          repeat: event.repeat,
        },
        {
          screenSize: sizeRef.current,
          screenCenter: { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 },
        },
        coveredRef.current === undefined ? {} : { skipIds: coveredRef.current },
      );
      // 让给宿主的组合（handled=false）不 preventDefault：宿主（编辑器壳）的全局派发要接着处理它
      if (result?.handled === true) {
        event.preventDefault();
        loopRef.current?.request();
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === ' ') handleSpaceUp(session);
    };
    // 监听 document：真实使用里点过工具条/菜单后焦点不一定落在外壳上，
    // 快捷键必须仍然可用（输入控件内的按键由上面的守卫排除）。
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [session]);

  // 外接 HUD：把会话里的 HUD 文案转给宿主（本组件不渲染小条）
  useEffect(() => {
    if (hud === undefined) return undefined;
    const forward = (text: string | null): void => {
      if (text === null) {
        hud.hide();
        return;
      }
      hud.show(text);
    };
    forward(session.store.getState().hud);
    return session.store.subscribe(() => {
      forward(session.store.getState().hud);
    });
  }, [hud, session]);

  // 右键菜单：点击菜单外后卸载菜单壳（菜单本体自行收起）
  useEffect(() => {
    if (menuPoint === null) return undefined;
    const onPointerDown = (event: MouseEvent): void => {
      const menu = shellRef.current?.querySelector('[data-df-canvas-context-menu]');
      if (menu?.contains(event.target as Node) === true) return;
      setMenuPoint(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuPoint]);

  return (
    <div
      ref={shellRef}
      className={className === undefined ? 'dfc-canvas-shell' : `dfc-canvas-shell ${className}`}
      style={style}
      // 键盘事件挂在 document（点过工具条/菜单后仍可用），因此这里不需要 tabIndex
      role="application"
      aria-label={t('canvas.stage.label')}
      data-df-canvas-shell=""
    >
      <canvas ref={canvasRef} className="dfc-canvas-surface" data-df-canvas="" />
      {status.canvasKit === 'error' ? (
        <div className="dfc-canvas-status" data-df-canvas-status="error">
          {t('canvas.error.skia', { reason: status.error ?? '' })}
        </div>
      ) : null}
      {status.canvasKit === 'ready' && status.fonts === 'error' ? (
        <div className="dfc-canvas-status" data-df-canvas-status="font-error">
          {t('canvas.error.font', { count: 0 })}
        </div>
      ) : null}
      <div className="dfc-canvas-layer dfc-canvas-layer--overlay">
        <TextOverlay session={session} />
        <FloatingToolbar session={session} />
        {menuPoint === null ? null : (
          <CanvasContextMenu session={session} point={menuPoint} epoch={menuEpoch} />
        )}
      </div>
      {hud === undefined ? <CanvasHud session={session} /> : null}
    </div>
  );
}

/** 选择标签（单选给图层名，多选给数量）。 */
function selectionLabels(session: CanvasSession): string[] {
  const nodes = session.selectedNodes();
  if (nodes.length === 0) return [];
  if (nodes.length === 1) return [nodes[0]?.name ?? t('canvas.selection.count', { count: 1 })];
  return [t('canvas.selection.count', { count: nodes.length })];
}

/** 错误消息。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
