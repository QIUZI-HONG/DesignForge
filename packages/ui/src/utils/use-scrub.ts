/**
 * 横向拖拽改值（scrubbing）共用钩子（RW-07）。
 *
 * 为什么自持不用拖拽库：需求只有「按住横向拖动 → 上报位移增量」，
 * 且必须区分「点击」与「拖拽」（输入框场景：点一下要进编辑，拖一下要改值），
 * 自持 40 行更透明（_shared §5 不引入规格外依赖）。
 *
 * 会话语义：mousedown 建立会话 → document 上收 mousemove/mouseup →
 * 位移越过 `threshold` 才算激活（触发 `onStart`）→ mouseup 结束（激活过才触发
 * `onEnd`）。回调经 ref 透传——一次拖拽会话内提交回调常随渲染变化，不得捕获旧闭包。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** 横向拖拽会话配置。 */
export interface HorizontalScrubOptions {
  disabled: boolean;
  /** 激活阈值（px 位移超过才算拖拽；抓手传 0——一动就是拖）。 */
  threshold: number;
  onStart?: () => void;
  /** 每次位移：`delta` 为本段增量，`total` 为自按下起的累计位移。 */
  onMove?: (delta: number, total: number) => void;
  onEnd?: () => void;
}

/** 横向拖拽会话句柄。 */
export interface HorizontalScrubResult {
  dragging: boolean;
  /** 摊到目标元素上的 mousedown 处理器（React 合成事件结构兼容）。 */
  onMouseDown: (event: { button: number; clientX: number }) => void;
}

/** 横向拖拽改值会话。 */
export function useHorizontalScrub(options: HorizontalScrubOptions): HorizontalScrubResult {
  const { disabled, threshold, onStart, onMove, onEnd } = options;
  const [dragging, setDragging] = useState(false);
  const session = useRef<{ startX: number; lastX: number; active: boolean } | null>(null);
  const endSession = useRef<(() => void) | null>(null);
  // 回调走 ref：会话存续期间拿到的是最新闭包（值提交回调随渲染变化）
  const callbacks = useRef({ onStart, onMove, onEnd });
  callbacks.current = { onStart, onMove, onEnd };

  const onMouseDown = useCallback(
    (event: { button: number; clientX: number }): void => {
      if (disabled || event.button !== 0 || session.current !== null) return;
      session.current = { startX: event.clientX, lastX: event.clientX, active: false };
      const onMoveDoc = (moveEvent: MouseEvent): void => {
        const state = session.current;
        if (state === null) return;
        if (!state.active) {
          if (Math.abs(moveEvent.clientX - state.startX) < threshold) return;
          state.active = true;
          setDragging(true);
          callbacks.current.onStart?.();
        }
        const delta = moveEvent.clientX - state.lastX;
        state.lastX = moveEvent.clientX;
        callbacks.current.onMove?.(delta, moveEvent.clientX - state.startX);
      };
      const onUpDoc = (): void => {
        document.removeEventListener('mousemove', onMoveDoc);
        document.removeEventListener('mouseup', onUpDoc);
        endSession.current = null;
        const wasActive = session.current?.active === true;
        session.current = null;
        setDragging(false);
        if (wasActive) callbacks.current.onEnd?.();
      };
      endSession.current = onUpDoc;
      document.addEventListener('mousemove', onMoveDoc);
      document.addEventListener('mouseup', onUpDoc);
    },
    [disabled, threshold],
  );

  // 卸载兜底：残留会话的文档监听器一并清掉（防泄漏与已卸载 setState）
  useEffect(
    () => () => {
      endSession.current?.();
    },
    [],
  );

  return { dragging, onMouseDown };
}
