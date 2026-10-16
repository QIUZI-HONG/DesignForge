'use client';

import { Overlay } from '@dforge/ui';
/**
 * Present 浮层（C13）：**黑底全屏 + 顶部悬浮控制条**。
 *
 * 舞台口径：浮层是 `position: fixed` 的全视口覆盖层（不受编辑器布局影响），
 * 进入时请求浏览器全屏（API 缺失则不请求，仍以固定浮层呈现——jsdom/壳内一致可用）。
 * 幻灯片 = 画板（`sequence.ts`）：按页面顺序、页内绘制顺序展平。
 *
 * 渲染边界（**明确声明**）：本票用 DOM 预览渲染画板内容（纯色填充 + 文本 + 嵌套矩形/椭圆），
 * 像素级画布渲染归 FE-06（CanvasKit 渲染器）——FE-06 落地后把 `SlidePreview` 换成
 * 它的渲染器即可，浮层与键盘行为不变。
 *
 * 键盘：←/→ 翻页（边界不越界）、Esc 退出；鼠标/键盘活动会让控制条重新出现，
 * 静止 3 秒自动隐藏（`controller.ts` 的纯规则）。
 *
 * `data-df-*` 挂点是门禁取样契约（`scripts/verify-figma-review.mjs`）。
 */
import { useEffect, useRef } from 'react';
import { t } from '@/i18n';
import { useReviewDocument, useReviewSession } from '../review-context';
import { keyboardActionOf } from './controller';
import { usePresentUi } from './present-hooks';
import { presentStyles } from './present-styles';
import { SlidePreview } from './SlidePreview';
import { buildSlides, frameOf, slideLabel } from './sequence';

/** 控制条自动隐藏的时间推进间隔（毫秒；比阈值细一档，误差不超过一格）。 */
const TICK_INTERVAL_MS = 500;

/** Present 浮层。 */
export function Presenter() {
  const session = useReviewSession();
  const document_ = useReviewDocument(session);
  const open = usePresentUi(session, (state) => state.open);
  const index = usePresentUi(session, (state) => state.index);
  const barVisible = usePresentUi(session, (state) => state.barVisible);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const slides = buildSlides(document_);
  const total = slides.length;
  const slide = slides[Math.min(index, Math.max(0, total - 1))];
  const frame = slide === undefined ? null : frameOf(document_, slide);

  // 键盘：←/→/Esc（挂在 window：浮层内没有必须获得焦点的输入框，全局监听才不会「点了空白就没反应」）
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = keyboardActionOf(event.key);
      if (action === null) return;
      event.preventDefault();
      if (action === 'exit') {
        session.present.getState().exitPresentation();
        exitFullscreenIfNeeded();
        return;
      }
      session.present.getState().step(action === 'next' ? 1 : -1, total);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, total, session]);

  // 控制条自动隐藏的计时推进 + 鼠标活动重置
  useEffect(() => {
    if (!open) return;
    session.present.getState().markActivity();
    const timer = window.setInterval(() => {
      session.present.getState().tick();
    }, TICK_INTERVAL_MS);
    const onPointerMove = (): void => {
      session.present.getState().markActivity();
    };
    window.addEventListener('pointermove', onPointerMove);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [open, session]);

  // 进入即请求全屏（用户手势外的环境会拒绝——失败即静默，固定浮层仍可用）
  useEffect(() => {
    if (!open) return;
    void requestFullscreenIfPossible();
  }, [open]);

  if (!open) return null;

  return (
    // 层级口径（C1/D-4）：演示舞台走 `@dforge/ui` 的 `Overlay`——与抽屉/模态同一条浮层栈
    // （后开必在上、焦点入层、滚动锁同源）。修复前舞台自持 `position: fixed` + z 令牌，
    // 与「后挂到 body 的抽屉」同值 → 抽屉开着时舞台会被压在下面。
    // Esc 单一真源（复核 J4）：演示的 Esc 语义**只**归本组件的 window 级处理器（`keyboardActionOf`
    // → exit）——浮层层的 Esc 关层显式关掉（`closeOnEsc={false}`），不再出现「同一次 Esc 走两条
    // 退出路径」；`use-overlay` 的 `closeOnEsc` 由此被真实消费（此前是无人使用的预留项）。
    <Overlay
      open
      closeOnEsc={false}
      onOpenChange={(next) => {
        if (next) return;
        session.present.getState().exitPresentation();
        exitFullscreenIfNeeded();
      }}
      label={t('review.present.title')}
    >
      <section
        ref={rootRef}
        data-df-presenter=""
        data-df-slide-index={String(index)}
        data-df-state={barVisible ? 'controls-visible' : 'controls-hidden'}
        aria-label={t('review.present.title')}
        style={presentStyles.stage}
        onPointerMove={() => {
          session.present.getState().markActivity();
        }}
      >
        <section
          data-df-present-stage=""
          data-df-state={slide === undefined ? 'empty' : 'slide'}
          aria-label={t('review.present.stage.label')}
          style={presentStyles.canvas}
        >
          {slide === undefined ? (
            <div data-df-sample="present/empty" style={presentStyles.empty}>
              <span style={presentStyles.emptyTitle}>{t('review.present.empty.title')}</span>
              <span style={presentStyles.emptyDesc}>{t('review.present.empty.desc')}</span>
            </div>
          ) : frame === null ? (
            <span style={presentStyles.emptyDesc}>{t('review.present.empty.desc')}</span>
          ) : (
            <SlidePreview frame={frame} pageId={slide.pageId} document={document_} />
          )}
        </section>

        <section
          data-df-present-controls=""
          data-df-state={barVisible ? 'visible' : 'hidden'}
          aria-label={t('review.present.controls.label')}
          aria-hidden={!barVisible}
          style={
            barVisible ? presentStyles.bar : { ...presentStyles.bar, ...presentStyles.barHidden }
          }
        >
          <span data-df-present-page="" style={presentStyles.pageText}>
            {t('review.present.page', { current: total === 0 ? 0 : index + 1, total })}
          </span>
          <span style={presentStyles.slideLabel}>
            {slide === undefined ? '' : slideLabel(slide)}
          </span>
          <span style={presentStyles.barSpacer} />
          <button
            type="button"
            aria-label={t('review.present.prev')}
            style={presentStyles.barButton}
            onClick={() => {
              session.present.getState().step(-1, total);
            }}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={t('review.present.next')}
            style={presentStyles.barButton}
            onClick={() => {
              session.present.getState().step(1, total);
            }}
          >
            ›
          </button>
          <button
            type="button"
            aria-label={t('review.present.fullscreen')}
            style={presentStyles.barButton}
            onClick={() => {
              void requestFullscreenIfPossible();
            }}
          >
            ⛶
          </button>
          <button
            type="button"
            aria-label={t('review.present.exit')}
            style={presentStyles.barButton}
            onClick={() => {
              session.present.getState().exitPresentation();
              exitFullscreenIfNeeded();
            }}
          >
            ✕
          </button>
        </section>
      </section>
    </Overlay>
  );
}

/** 请求全屏（API 缺失/被拒绝都不抛错：固定浮层是等价可用的降级）。 */
async function requestFullscreenIfPossible(): Promise<void> {
  const element = globalThis.document?.documentElement as
    | (HTMLElement & { requestFullscreen?: () => Promise<void> })
    | undefined;
  const request = element?.requestFullscreen;
  if (typeof request !== 'function') return;
  try {
    await request.call(element);
  } catch {
    // 未获得用户手势/被策略拒绝：保持浮层呈现即可
  }
}

/** 退出全屏（只在确实处于全屏时调用）。 */
function exitFullscreenIfNeeded(): void {
  const document_ = globalThis.document;
  if (document_ === undefined || document_.fullscreenElement == null) return;
  const exit = (document_ as Document & { exitFullscreen?: () => Promise<void> }).exitFullscreen;
  if (typeof exit !== 'function') return;
  void exit.call(document_).catch(() => undefined);
}
