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

/**
 * `POST /export` 成功响应的 result 载荷。
 *
 * `complete` 是「产物是否覆盖页面全部可渲染节点」的**唯一对外保证**：仅当
 * 预算截断（`truncatedNodes`）与结构非法/无渲染语义跳过（`skippedNodes`）皆为零、
 * 且提取**对账通过**（节点表里可达/孤立的可渲染节点都被计入两类之一）时才 true。
 * 隐藏层（`visible===false`，应用侧从不渲染、连子树）是**非损失**，不计入以上两类、
 * 不参与 `complete` 判定。两个计数供 UI 说明规模：因实例等无法展开的子树不计入，
 * 它们对「真实未导出节点」而言是**下界**——消费方判「完整/部分」必须看 `complete`，
 * 不得拿计数当保证。
 */
export interface ExportResultPayload {
  artifact: ExportArtifact;
  /** 因结构非法/无渲染语义被跳过的节点数（真损失；隐藏层不在此列）。 */
  skippedNodes: number;
  /** 因节点预算被丢弃的节点数（真损失；含被拒容器整棵子树）。 */
  truncatedNodes: number;
  /** 产物是否完整（两类真损失皆为零且提取对账通过才 true；隐藏层不计）。 */
  complete: boolean;
  /** PNG 可用最大倍率（UI 据此收口档位）。 */
  maxScale: number;
}

/** 校验值是否为支持格式。 */
export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === 'string' && (EXPORT_FORMATS as readonly string[]).includes(value);
}
