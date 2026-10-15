/**
 * @dforge/contracts · export 命名空间。
 *
 * 导出请求/结果（PNG/SVG/PDF 起步）。
 * 说明：本段导出为**服务端简化实现**（daemon 侧渲染最小场景子集，见 apps/daemon/src/export）；
 * 引擎序列化接入后（ENG-01/FE-06 联调）契约形状不变，仅替换渲染实现。
 * 消费方：FE-06（导出往返）、FE-08（检查/导出）。
 */

/** 支持的导出格式。 */
export const EXPORT_FORMATS = ['png', 'svg', 'pdf'] as const;

/** 导出格式联合类型。 */
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** 各格式 MIME。 */
export const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

/** `POST /export` 请求。 */
export interface ExportRequest {
  documentId: string;
  pageId: string;
  format: ExportFormat;
  /** 仅 PNG：像素倍率（1–4，默认 1；SVG/PDF 为矢量不受影响）。 */
  scale?: number;
}

/** 导出结果（本地优先：产物同时落盘并随响应回传 base64）。 */
export interface ExportArtifact {
  format: ExportFormat;
  mimeType: string;
  fileName: string;
  /** 字节数（与 sha256 成对，供证据 JSON 引用）。 */
  length: number;
  sha256: string;
  /** 载荷（base64），前端可直接构造 Blob 下载/导入。 */
  base64: string;
  /** daemon 落盘路径。 */
  filePath: string;
}

/** 校验值是否为支持格式。 */
export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === 'string' && (EXPORT_FORMATS as readonly string[]).includes(value);
}
