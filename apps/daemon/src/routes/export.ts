/**
 * @dforge/daemon · 导出路由（PNG/SVG/PDF；FE-06 导出往返 / FE-08 检查导出消费）。
 *
 * 简化实现声明（简报 §2）：渲染用 daemon 内最小场景子集（不见节点语义），
 * 产物同时落 `<dataRoot>/exports/` 并回传 base64 + sha256 + length（证据 JSON 引用对）。
 */

import { stat, writeFile } from 'node:fs/promises';
import type { ExportArtifact, ExportFormat, ExportResultPayload } from '@dforge/contracts';
import { DAEMON_ROUTES, isExportFormat, isNonEmptyString } from '@dforge/contracts';
import type { FastifyInstance } from 'fastify';

import type { DaemonContext } from '../app.ts';
import {
  EXPORT_MAX_SCALE,
  ExportCanvasTooLargeError,
  incompleteArtifactFileName,
  type RenderedExport,
  renderExport,
} from '../export/index.ts';
import { ensureDir, sha256Hex } from '../fs-atomic.ts';
import { sendFail, sendOk } from '../http.ts';
import { resolveWithin } from '../path-safety.ts';

/** 注册导出路由。 */
export function registerExportRoutes(app: FastifyInstance, context: DaemonContext): void {
  app.post(DAEMON_ROUTES.exportDocument.path, async (request, reply) => {
    const body = request.body;
    if (typeof body !== 'object' || body === null) {
      return sendFail(reply, 'bad_request', '请求体必须是 JSON 对象');
    }
    const record = body as Record<string, unknown>;
    const { documentId, pageId } = record;
    if (!isNonEmptyString(documentId) || !isNonEmptyString(pageId)) {
      return sendFail(reply, 'bad_request', 'documentId 与 pageId 必须是非空字符串');
    }
    if (!isExportFormat(record.format)) {
      return sendFail(reply, 'export_unsupported_format', 'format 仅支持 png/svg/pdf', {
        format: record.format,
      });
    }
    const format: ExportFormat = record.format;
    if (record.scale !== undefined) {
      if (typeof record.scale !== 'number' || !Number.isFinite(record.scale) || record.scale < 1) {
        return sendFail(reply, 'bad_request', 'scale 必须是 ≥1 的数值');
      }
    }

    const page = await context.documents.readPage(documentId, pageId);
    if (!page.ok) {
      if (page.code === 'doc_not_found') {
        return sendFail(reply, 'doc_not_found', page.message, page.details);
      }
      if (page.code === 'not_found') {
        return sendFail(reply, 'export_page_not_found', '导出目标页面不存在', page.details);
      }
      return sendFail(reply, page.code, page.message, page.details);
    }

    let rendered: RenderedExport;
    try {
      rendered = renderExport({
        format,
        pageBody: page.value.body,
        context: { documentId, pageId },
        ...(record.scale === undefined ? {} : { scale: record.scale as number }),
      });
    } catch (error) {
      // 尺寸超限是**请求方错误**（4xx + 结构化上下文），不是渲染故障（§D1 护栏）
      if (error instanceof ExportCanvasTooLargeError) {
        return sendFail(reply, 'export_canvas_too_large', error.message, {
          width: error.width,
          height: error.height,
          scale: error.scale,
          maxEdge: error.maxEdge,
        });
      }
      return sendFail(reply, 'export_render_failed', `渲染失败：${String(error).slice(0, 200)}`);
    }

    const sha256 = await sha256Hex(rendered.bytes);
    await ensureDir(context.paths.exportsDir);
    // 产物文件名派生自 documentId/pageId：一律经唯一安全解析器落盘（不自行 join）
    const canonicalFileName = rendered.fileName;
    const canonicalPath = await resolveWithin(context.paths.exportsDir, canonicalFileName);
    if (canonicalPath === null) {
      return sendFail(reply, 'export_render_failed', '产物文件名越界（已拒绝写入）');
    }

    // 票 18 二轮 G1：`complete:false`（空白/截断/抽取未走到）**绝不覆盖**上一次的好产物。
    // 状态码仍是 200（部分产物本身有效，5xx 会把它误报成「没有产物」），隔离落在文件名上：
    // 不完整的一律写 `<规范名>.incomplete.<format>` 侧文件，规范名字节保持不动。
    let writtenFileName = canonicalFileName;
    let filePath = canonicalPath;
    let preservedPreviousArtifactPath: string | null = null;
    if (rendered.complete) {
      await writeFile(filePath, rendered.bytes);
    } else {
      writtenFileName = incompleteArtifactFileName(canonicalFileName, format);
      const sidecarPath = await resolveWithin(context.paths.exportsDir, writtenFileName);
      if (sidecarPath === null) {
        return sendFail(reply, 'export_render_failed', '产物文件名越界（已拒绝写入）');
      }
      filePath = sidecarPath;
      preservedPreviousArtifactPath = (await fileExists(canonicalPath)) ? canonicalPath : null;
      await writeFile(filePath, rendered.bytes);
    }

    const artifact: ExportArtifact = {
      format,
      mimeType: rendered.mimeType,
      fileName: writtenFileName,
      length: rendered.bytes.length,
      sha256,
      base64: rendered.bytes.toString('base64'),
      filePath,
    };

    context.telemetry
      .append({
        name: 'export.completed',
        payload: {
          documentId,
          pageId,
          format,
          length: rendered.bytes.length,
          complete: rendered.complete,
          skippedNodes: rendered.skippedNodes,
          truncatedNodes: rendered.truncatedNodes,
          preservedPreviousArtifact: preservedPreviousArtifactPath !== null,
        },
        sessionId: null,
        appVersion: null,
        at: null,
      })
      .catch(() => undefined);

    const result: ExportResultPayload = {
      artifact,
      skippedNodes: rendered.skippedNodes,
      truncatedNodes: rendered.truncatedNodes,
      complete: rendered.complete,
      preservedPreviousArtifactPath,
      maxScale: EXPORT_MAX_SCALE,
    };
    return sendOk(reply, result);
  });
}

/** 文件是否存在且是普通文件（用于判「上一次产物是否需要保护」）。 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
