'use client';

/**
 * Present 浮层样式（令牌化）。
 *
 * 「黑底」的令牌口径：取**深色基准的画布底**（`--dfg-color-canvas`，UI3 的深灰画布）——
 * 与 Figma 本体的深色演示底同族，且守住「组件禁裸值」纪律（纯黑属令牌外色值，
 * 若对照阶段确认需要纯黑，应由 FE-01 在令牌表里加一档，而不是就地写死）。
 */
import { cssVar } from '@dforge/ui';
import type { CSSProperties } from 'react';

const PANEL_RADIUS = cssVar('radius-pill');

/** Present 浮层样式。 */
export const presentStyles = {
  /**
   * 舞台：由 `@dforge/ui` 的 `Overlay` 提供全视口覆盖与 z 序（浮层栈内同源推导），
   * 本样式只负责「铺满 + 居中 + 深色底」——不再自持 `position: fixed` / z 令牌，
   * 否则会与栈序脱钩（同 D-4 一类缺陷）。
   */
  stage: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    background: cssVar('color.canvas'),
    color: cssVar('color.text.primary'),
    fontFamily: cssVar('font.sans'),
  } as CSSProperties,
  /** 幻灯片区域（居中，留出控制条的空间）。 */
  canvas: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  } as CSSProperties,
  /** 顶部悬浮控制条：圆角胶囊 + 悬浮阴影。 */
  bar: {
    position: 'absolute',
    top: cssVar('space-3'),
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
    height: cssVar('control-height-md'),
    paddingInline: cssVar('space-3'),
    borderRadius: PANEL_RADIUS,
    background: cssVar('color.surfaceRaised'),
    boxShadow: cssVar('shadow-lg'),
    color: cssVar('color.text.primary'),
    fontSize: cssVar('font-size-12'),
    transition: `opacity ${cssVar('duration-base')} ${cssVar('easing.standard')}`,
    opacity: 1,
  } as CSSProperties,
  /** 自动隐藏态：保留 DOM（可测、可被读屏忽略）但不可点。 */
  barHidden: {
    opacity: 0,
    pointerEvents: 'none',
  } as CSSProperties,
  barSpacer: { flex: '1 1 auto', minWidth: cssVar('space-3') } as CSSProperties,
  pageText: {
    fontVariantNumeric: 'tabular-nums',
    fontWeight: cssVar('font-weight-medium'),
  } as CSSProperties,
  slideLabel: { color: cssVar('color.text.secondary') } as CSSProperties,
  barButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: cssVar('control-height-sm'),
    height: cssVar('control-height-sm'),
    borderRadius: cssVar('radius-pill'),
    border: 'none',
    background: 'transparent',
    color: cssVar('color.text.primary'),
    fontSize: cssVar('font-size-13'),
    cursor: 'pointer',
  } as CSSProperties,
  /** 空态（无画板）。 */
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: cssVar('space-2'),
    textAlign: 'center',
  } as CSSProperties,
  emptyTitle: { fontSize: cssVar('font-size-15') } as CSSProperties,
  emptyDesc: {
    fontSize: cssVar('font-size-12'),
    color: cssVar('color.text.secondary'),
  } as CSSProperties,
  /** 幻灯片外框（缩放由 SlidePreview 计算 → transform）。 */
  slideFrame: {
    position: 'relative',
    overflow: 'hidden',
    transformOrigin: 'top left',
  } as CSSProperties,
} satisfies Record<string, CSSProperties>;
