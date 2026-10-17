'use client';

/**
 * 文本内联编辑覆盖层（C10）：**DOM 覆盖层按世界坐标对齐**、缩放/平移跟随、失焦提交、Esc 取消。
 *
 * 为什么用 DOM 而不是在画布里画光标：输入法（中文组合输入）、系统文本服务、
 * 无障碍与选区的正确行为都在浏览器里现成；Skia 侧只负责「编辑期间不出字形」（避免重影）。
 *
 * 数据流（不重写编辑逻辑，`_shared.md` §3）：
 * - DOM 是编辑期的**文本缓冲**（输入法/光标/选区）；
 * - 每次输入把结果经引擎的「整段替换」写回文本会话（`insertText` + `setTextSelection`）；
 * - 失焦/⌘⏎ → `commitText()`（产出单条 `node.update`，一次撤销回退整段）；Esc → `cancelText()`。
 *
 * 对齐口径：世界矩形 → 屏幕（CSS 像素）→ `left/top/width/height` + 绕自身 `rotate`；
 * 换算走 `render/viewport-map` 的**共享纯函数**（与渲染层同一份世界→屏幕口径，
 * 父级偏移/旋转都由祖先链算进来——帧内文本是常态），字号/字距按 zoom 缩放、
 * 行高保持倍数（与画布渲染口径一致）。
 */

import { resolveNode } from '@dforge/engine';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { t } from '@/i18n';

import { nodeOverlayBox } from '../render/viewport-map';
import type { CanvasSession } from '../state/session';

/** 覆盖层 props。 */
export interface TextOverlayProps {
  session: CanvasSession;
}

/** 覆盖层最小尺寸（屏幕 px；极小缩放时不至于退化成不可点）。 guard-tokens:allow 覆盖层几何下限，非设计令牌 */
const MIN_OVERLAY_WIDTH = 16;
const MIN_OVERLAY_HEIGHT = 8;

/** 覆盖层基线样式（令牌变量；几何由内联 style 计算）。 */
const OVERLAY_BASE: CSSProperties = {
  position: 'absolute',
  margin: 0,
  border: 0,
  outline: 'none',
  resize: 'none',
  overflow: 'hidden',
  background: 'transparent',
  padding: 0,
  color: 'inherit',
  caretColor: 'var(--dfg-color-primary)',
  // 旋转原点 = 节点局部原点（左上角）：与引擎「world = R(祖先链累计角)·q + 局部原点世界位置」等价
  transformOrigin: '0 0',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

/** 文本内联编辑覆盖层。 */
export function TextOverlay({ session }: TextOverlayProps) {
  const editing = useStore(session.store, (state) => state.editing);
  const viewport = useStore(session.store, (state) => state.viewport);
  // 文档真值在命令栈里：接 useSyncExternalStore（不进 React state，见引擎模块头注释）
  const documentSnapshot = useSyncExternalStore(
    (listener) => session.stack.subscribe(() => listener()),
    () => session.stack.getSnapshot(),
    () => session.stack.getSnapshot(),
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** Esc 取消后紧跟的 blur 不得再提交（否则「取消」会变成提交）。 */
  const cancelledRef = useRef(false);
  const lastNodeRef = useRef<string | null>(null);

  const nodeId = editing?.nodeId ?? null;

  // 进入编辑：聚焦并把引擎会话的选区套到输入框（只在**进入时**跑一次，避免每次按键重置光标）
  useEffect(() => {
    if (nodeId === null || lastNodeRef.current === nodeId) return;
    const element = textareaRef.current;
    const current = session.store.getState().editing;
    if (element === null || current === null) return;
    lastNodeRef.current = nodeId;
    cancelledRef.current = false;
    element.focus({ preventScroll: true });
    element.setSelectionRange(current.selection.start, current.selection.end);
  }, [nodeId, session]);

  if (editing === null || nodeId === null) return null;
  const page = documentSnapshot.pages.find((candidate) => candidate.id === editing.pageId);
  if (page === undefined) return null;
  const node = resolveNode(page, nodeId);
  if (node === undefined || node.type !== 'text') return null;
  // 世界 → 屏幕走共享换算（祖先链偏移 + 累计旋转）：与渲染层同源，不静默按局部坐标落位
  const box = nodeOverlayBox(page, nodeId, viewport);
  if (box === null) return null;

  const content = editing.content;
  const style: CSSProperties = {
    ...OVERLAY_BASE,
    left: box.left,
    top: box.top,
    width: Math.max(box.width, MIN_OVERLAY_WIDTH),
    height: Math.max(box.height, MIN_OVERLAY_HEIGHT),
    transform: `rotate(${box.rotation}deg)`,
    fontFamily: 'var(--dfg-font-sans)',
    fontSize: content.fontSize * viewport.zoom,
    fontWeight: content.fontWeight,
    lineHeight: content.lineHeight,
    letterSpacing: content.letterSpacing * viewport.zoom,
    textAlign: content.align,
    color: node.fills[0]?.type === 'solid' ? node.fills[0].color : 'var(--dfg-color-text-primary)',
  };

  const syncSelectionToEngine = (element: HTMLTextAreaElement): void => {
    session.setEditingSelection({
      start: element.selectionStart ?? 0,
      end: element.selectionEnd ?? 0,
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelledRef.current = true;
      session.cancelText();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      session.commitText();
    }
  };

  return (
    <textarea
      ref={textareaRef}
      data-df-text-overlay={nodeId}
      aria-label={t('canvas.text.placeholder')}
      className="df-canvas-text-overlay"
      style={style}
      value={content.characters}
      spellCheck={false}
      onChange={(event) => {
        const element = event.currentTarget;
        session.replaceEditingContent(element.value, {
          start: element.selectionStart ?? element.value.length,
          end: element.selectionEnd ?? element.value.length,
        });
      }}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        syncSelectionToEngine(event.currentTarget);
      }}
      onSelect={(event) => {
        syncSelectionToEngine(event.currentTarget);
      }}
      onBlur={() => {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        session.commitText();
      }}
    />
  );
}
