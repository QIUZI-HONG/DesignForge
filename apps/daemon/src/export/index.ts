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

/**
 * 导出画布单边像素上限（页面逻辑边长 × scale，两轴各查各的）。
 * 依据测试报告 §D1：5000×5000 页面 @scale4 → 20000×20000 ≈ 3.2GB 同步分配会冻结事件循环，
 * 故在**分配任何像素缓冲之前**拒绝（路由层回 4xx `export_canvas_too_large`）。
 */
export const EXPORT_MAX_EDGE_PX = 8192;

/** 导出尺寸超限错误（携带结构化上下文，路由层据此回 4xx）。 */
export class ExportCanvasTooLargeError extends Error {
  /** 超限的实际输出宽（像素）。 */
  readonly width: number;
  /** 超限的实际输出高（像素）。 */
  readonly height: number;
  /** 引发超限的 scale。 */
  readonly scale: number;
  /** 单边上限（= EXPORT_MAX_EDGE_PX）。 */
  readonly maxEdge: number;

  constructor(init: { width: number; height: number; scale: number }) {
    super(
      `导出画布尺寸超限：${init.width}×${init.height} 像素超出单边上限 ${EXPORT_MAX_EDGE_PX}` +
        `（页面宽高 × scale；请缩小页面或调低 scale）`,
    );
    this.name = 'ExportCanvasTooLargeError';
    this.width = init.width;
    this.height = init.height;
    this.scale = init.scale;
    this.maxEdge = EXPORT_MAX_EDGE_PX;
  }
}

/** 校验导出输出尺寸（单边 = 逻辑边长 × scale），超限抛 `ExportCanvasTooLargeError`。 */
export function assertExportSizeWithinLimit(width: number, height: number, scale: number): void {
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  if (outWidth > EXPORT_MAX_EDGE_PX || outHeight > EXPORT_MAX_EDGE_PX) {
    throw new ExportCanvasTooLargeError({ width: outWidth, height: outHeight, scale });
  }
}

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
  truncatedNodes: number;
  complete: boolean;
}

/** 计算有效 scale（PNG 限定 1–4；SVG/PDF 恒 1——矢量无倍率概念）。 */
export function effectiveScale(format: ExportFormat, scale: number | undefined): number {
  if (format !== 'png') return 1;
  if (scale === undefined || !Number.isFinite(scale)) return 1;
  return Math.min(Math.max(1, Math.round(scale)), EXPORT_MAX_SCALE);
}

/**
 * 部分/空白产物（`complete === false`）的**隔离文件名**。
 *
 * 为什么需要：路由原先无条件把产物写到规范名 `<doc>-<page>.<format>`，于是「坏信封 →
 * 1440×900 空白 PNG」会**静默顶掉上一次的好产物**（票 18 二轮 G1 实测：GOOD 236 字节 →
 * BLANK 7164 字节，UI 仍显示「已导出」）。HTTP 仍需 200（部分产物本身有效，5xx 会把它
 * 误报成「没有产物」），所以隔离靠**文件名**而不是状态码：不完整的一律落 `.incomplete`
 * 侧文件，规范名永不被动。
 *
 * 为什么名字里要带**内容摘要**（三轮 E2）：侧文件名若只是规范名的纯函数，同一文档同一页的
 * 两次不同部分结果会写进同一个侧文件——后一次静默替换前一次，而两次响应都各自报告
 * 「原产物保持 + 部分产物另存于此 filePath」。实测四次（skipped=1 / skipped=3 / truncated=2 /
 * 再来一次 skipped=1）落进 1 个文件，115 KB 的截断产物被 250 B 的空白替掉，前三个响应的
 * `sha256`/`length`/`base64` 对自己报的 filePath 全部失效。带摘要后：不同字节必然不同名，
 * 相同字节仍是幂等覆盖（内容一致，谈不上损失）。
 */
export function incompleteArtifactFileName(
  fileName: string,
  format: ExportFormat,
  contentDigest: string,
): string {
  const suffix = `.${format}`;
  const stem = fileName.endsWith(suffix) ? fileName.slice(0, -suffix.length) : fileName;
  // 摘要只取十六进制前 12 位作标签：文件名要可读可辨，且必须过滤掉任何非标识字符（路径安全）。
  const tag = contentDigest
    .replace(/[^0-9a-f]/gi, '')
    .slice(0, 12)
    .toLowerCase();
  return `${stem}.incomplete-${tag || 'unknown'}${suffix}`;
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
  // 尺寸护栏必须先于任何渲染（PNG 光栅化/PDF 编码都是同步大缓冲分配，§D1）
  assertExportSizeWithinLimit(scene.width, scene.height, scale);
  const fileName = `${options.context.documentId}-${options.context.pageId}.${options.format}`;

  switch (options.format) {
    case 'svg': {
      const header = `<!-- DesignForge 导出（简化渲染：矩形/椭圆/文本；来源 ${options.context.documentId}/${options.context.pageId}） -->\n`;
      return {
        bytes: Buffer.from(header + renderSvg(scene), 'utf8'),
        mimeType: EXPORT_MIME_TYPES.svg,
        fileName,
        skippedNodes: scene.skippedNodes,
        truncatedNodes: scene.truncatedNodes,
        complete: scene.complete,
      };
    }
    case 'pdf':
      return {
        bytes: renderPdf(scene),
        mimeType: EXPORT_MIME_TYPES.pdf,
        fileName,
        skippedNodes: scene.skippedNodes,
        truncatedNodes: scene.truncatedNodes,
        complete: scene.complete,
      };
    default:
      return {
        bytes: renderPng(scene, scale),
        mimeType: EXPORT_MIME_TYPES.png,
        fileName,
        skippedNodes: scene.skippedNodes,
        truncatedNodes: scene.truncatedNodes,
        complete: scene.complete,
      };
  }
}
