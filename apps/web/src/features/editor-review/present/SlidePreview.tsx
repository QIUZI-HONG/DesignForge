'use client';

/**
 * 幻灯片预览渲染（DOM 版，P0）。
 *
 * 渲染边界（**明确声明**）：逐像素的画布渲染归 FE-06（CanvasKit）；本票的 Present
 * 用 DOM 递归渲染画板子树（纯色/渐变填充、文本、嵌套容器、椭圆圆角），足以支撑
 * C13 的交互与对照取样。FE-06 落地后把本组件替换为它的渲染器即可，浮层结构不动。
 *
 * 缩放：按舞台留白（视口 90% × 85%）算 `scale = min(...)`，整棵子树用一次
 * `transform: scale()`（不逐个节点改尺寸，避免累积舍入误差）。
 * 颜色来自**文档数据**（Design IR 的 Paint），不是界面令牌——按图渲染是本分。
 */
import {
  childrenOf,
  type DesignDocument,
  type FrameNode,
  getNode,
  isContainer,
  type LinearGradientPaint,
  type SceneNode,
  type SolidPaint,
} from '@dforge/engine';
import { type CSSProperties, useEffect, useState } from 'react';

import { presentStyles } from './present-styles';

/** 舞台留白比例（几何口径：视口宽 90% / 高 85% 内做 contain）。 */
const FIT_WIDTH_RATIO = 0.9;
const FIT_HEIGHT_RATIO = 0.85;

/** SlidePreview props。 */
export interface SlidePreviewProps {
  frame: FrameNode;
  pageId: string;
  document: DesignDocument;
}

/** 视图尺寸 → 画板缩放（contain）。 */
export function fitScale(
  frameSize: { width: number; height: number },
  viewportSize: { width: number; height: number },
): number {
  if (frameSize.width <= 0 || frameSize.height <= 0) return 1;
  const byWidth = (viewportSize.width * FIT_WIDTH_RATIO) / frameSize.width;
  const byHeight = (viewportSize.height * FIT_HEIGHT_RATIO) / frameSize.height;
  return Math.min(byWidth, byHeight);
}

/** 幻灯片预览。 */
export function SlidePreview({ frame, pageId, document: designDocument }: SlidePreviewProps) {
  const viewport = useViewportSize();
  const scale = fitScale(frame, viewport);
  const page = designDocument.pages.find((item) => item.id === pageId);

  return (
    <div
      data-df-slide-frame={frame.id}
      style={{
        ...presentStyles.slideFrame,
        width: `${String(frame.width * scale)}px`,
        height: `${String(frame.height * scale)}px`,
        background: paintToCss(frame.fills[0]) ?? 'transparent',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: `${String(frame.width)}px`,
          height: `${String(frame.height)}px`,
          transform: `scale(${String(scale)})`,
          transformOrigin: 'top left',
        }}
      >
        {page === undefined
          ? null
          : childrenOf(frame).map((childId) => {
              const child = getNode(page, childId);
              return child === undefined ? null : (
                <NodeBox key={child.id} pageId={pageId} node={child} document={designDocument} />
              );
            })}
      </div>
    </div>
  );
}

/** 递归渲染一个节点（绝对定位 + 填充 + 文本）。 */
function NodeBox({
  node,
  pageId,
  document: designDocument,
}: {
  node: SceneNode;
  pageId: string;
  document: DesignDocument;
}) {
  if (!node.visible) return null;
  const page = designDocument.pages.find((item) => item.id === pageId);
  const style: CSSProperties = {
    position: 'absolute',
    left: `${String(node.x)}px`,
    top: `${String(node.y)}px`,
    width: `${String(node.width)}px`,
    height: `${String(node.height)}px`,
    background: paintToCss(node.fills[0]) ?? 'transparent',
    borderRadius: node.type === 'ellipse' ? '50%' : `${String(node.cornerRadius)}px`,
    opacity: node.opacity,
    overflow: node.type === 'frame' && node.clipsContent ? 'hidden' : undefined,
    color: node.type === 'text' ? (paintToCss(node.fills[0]) ?? 'inherit') : undefined,
    fontFamily: node.type === 'text' ? node.text.fontFamily : undefined,
    fontSize: node.type === 'text' ? `${String(node.text.fontSize)}px` : undefined,
    fontWeight: node.type === 'text' ? node.text.fontWeight : undefined,
    lineHeight: node.type === 'text' ? node.text.lineHeight : undefined,
    textAlign: node.type === 'text' ? node.text.align : undefined,
    whiteSpace: node.type === 'text' ? 'pre-wrap' : undefined,
  };

  const children =
    isContainer(node) && page !== undefined
      ? childrenOf(node).map((childId) => {
          const child = getNode(page, childId);
          return child === undefined ? null : (
            <NodeBox key={child.id} pageId={pageId} node={child} document={designDocument} />
          );
        })
      : null;

  return (
    <div style={style}>
      {node.type === 'text' ? node.text.characters : null}
      {children}
    </div>
  );
}

/** 视口尺寸（resize 时重算缩放）。 */
function useViewportSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));
  useEffect(() => {
    const onResize = (): void => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return size;
}

/** 画刷 → CSS 背景。P0 覆盖纯色与线性渐变（与 Design IR 的 Paint 子集一致）。 */
export function paintToCss(paint: SolidPaint | LinearGradientPaint | undefined): string | null {
  if (paint === undefined || !paint.visible) return null;
  if (paint.type === 'solid') {
    // 文档数据色（Design IR 的 Paint），不是界面令牌
    return paint.color;
  }
  const stops = paint.stops
    .map((stop) => `${stop.color} ${String(Math.round(stop.position * 100))}%`)
    .join(', ');
  const angle = Math.round(
    (Math.atan2(paint.end.y - paint.start.y, paint.end.x - paint.start.x) * 180) / Math.PI,
  );
  return `linear-gradient(${String(angle + 90)}deg, ${stops})`;
}
