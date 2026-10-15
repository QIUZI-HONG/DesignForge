/**
 * Present 画板序列（C13）——纯函数。
 *
 * 序列口径：**按页面顺序**把每页的顶层画板（`type === 'frame'`）展平为一串幻灯片；
 * 分组（编组/组件/散件）不进序列——Present 演示的是「画板」而不是画布上的所有东西。
 * 空序列不伪造内容：Presenter 呈现空态（「没有可演示的画板」），由用户先建画板。
 */
import { type DesignDocument, type FrameNode, getNode } from '@dforge/engine';

/** 一张幻灯片 = 一个画板（带页面上下文，供标签与页码）。 */
export interface Slide {
  /** 1 基连续编号（控制条的「n / N」）。 */
  index: number;
  pageId: string;
  pageName: string;
  frameId: string;
  frameName: string;
  /** 页面内画板的序号（0 基；同页内导航用）。 */
  frameIndexInPage: number;
}

/** 展平文档的演示序列（页面顺序 → 页内绘制顺序）。 */
export function buildSlides(document: DesignDocument): Slide[] {
  const slides: Slide[] = [];
  for (const page of document.pages) {
    let frameIndexInPage = 0;
    for (const rootId of page.rootIds) {
      const node = getNode(page, rootId);
      if (node === undefined || node.type !== 'frame') continue;
      frameIndexInPage += 1;
      slides.push({
        index: slides.length + 1,
        pageId: page.id,
        pageName: page.name,
        frameId: node.id,
        frameName: node.name,
        frameIndexInPage: frameIndexInPage - 1,
      });
    }
  }
  return slides;
}

/** 幻灯片标签（控制条左侧显示）。 */
export function slideLabel(slide: Slide): string {
  return `${slide.pageName} · ${slide.frameName}`;
}

/** 取画板节点（Presenter 渲染用；找不到返回 null 而不是抛错）。 */
export function frameOf(document: DesignDocument, slide: Slide): FrameNode | null {
  const page = document.pages.find((item) => item.id === slide.pageId);
  if (page === undefined) return null;
  const node = getNode(page, slide.frameId);
  return node !== undefined && node.type === 'frame' ? node : null;
}
