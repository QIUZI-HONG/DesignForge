/**
 * @dforge/daemon · 导出分发（PNG/SVG/PDF → 字节 + 元数据）。
 *
 * 简化实现口径（简报 §2）：渲染用 daemon 内的最小场景子集（scene.ts）；
 * 引擎序列化接入后仅替换渲染层，**导出契约（ExportRequest/ExportArtifact）不变**。
 * 产物同时落盘（本地优先：导出物不出机）并回传 base64（前端可直接下载/导入）。
 */

import type { ExportFormat } from '@dforge/contracts';
import { EXPORT_MIME_TYPES } from '@dforge/contracts';

import { renderPdf } from './pdf.ts';
import { renderPng } from './png.ts';
import { extractScene } from './scene.ts';
import { renderSvg } from './svg.ts';

/** PNG scale 上限（像素倍率 1–4，防误传超大倍率打爆内存）。 */
export const EXPORT_MAX_SCALE = 4;

/** 上下文提示（附加到 SVG/PDF 的注释里，便于人识别来源与简化口径）。 */
export interface ExportContext {
  documentId: string;
  pageId: string;
}

/** 渲染结果。 */
export interface RenderedExport {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  skippedNodes: number;
}

/** 计算有效 scale（PNG 限定 1–4；SVG/PDF 恒 1——矢量无倍率概念）。 */
export function effectiveScale(format: ExportFormat, scale: number | undefined): number {
  if (format !== 'png') return 1;
  if (scale === undefined || !Number.isFinite(scale)) return 1;
  return Math.min(Math.max(1, Math.round(scale)), EXPORT_MAX_SCALE);
}

/** 渲染导出产物（不落盘——落盘由路由层负责）。 */
export function renderExport(options: {
  format: ExportFormat;
  pageBody: unknown;
  context: ExportContext;
  scale?: number;
}): RenderedExport {
  const scene = extractScene(options.pageBody);
  const scale = effectiveScale(options.format, options.scale);
  const fileName = `${options.context.documentId}-${options.context.pageId}.${options.format}`;

  switch (options.format) {
    case 'svg': {
      const header = `<!-- DesignForge 导出（简化渲染：矩形/椭圆/文本；来源 ${options.context.documentId}/${options.context.pageId}） -->\n`;
      return {
        bytes: Buffer.from(header + renderSvg(scene), 'utf8'),
        mimeType: EXPORT_MIME_TYPES.svg,
        fileName,
        skippedNodes: scene.skippedNodes,
      };
    }
    case 'pdf':
      return {
        bytes: renderPdf(scene),
        mimeType: EXPORT_MIME_TYPES.pdf,
        fileName,
        skippedNodes: scene.skippedNodes,
      };
    default:
      return {
        bytes: renderPng(scene, scale),
        mimeType: EXPORT_MIME_TYPES.png,
        fileName,
        skippedNodes: scene.skippedNodes,
      };
  }
}
