/**
 * @dforge/daemon · 导出路由（PNG/SVG/PDF；FE-06 导出往返 / FE-08 检查导出消费）。
 *
 * 简化实现声明（简报 §2）：渲染用 daemon 内最小场景子集（不见节点语义），
 * 产物同时落 `<dataRoot>/exports/` 并回传 base64 + sha256 + length（证据 JSON 引用对）。
 */

import { writeFile } from 'node:fs/promises';
import type { ExportArtifact, ExportFormat } from '@dforge/contracts';
import { DAEMON_ROUTES, isExportFormat, isNonEmptyString } from '@dforge/contracts';
import type { FastifyInstance } from 'fastify';

import type { DaemonContext } from '../app.ts';
import { EXPORT_MAX_SCALE, renderExport } from '../export/index.ts';
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

    let rendered: { bytes: Buffer; mimeType: string; fileName: string; skippedNodes: number };
    try {
      rendered = renderExport({
        format,
        pageBody: page.value.body,
        context: { documentId, pageId },
        ...(record.scale === undefined ? {} : { scale: record.scale as number }),
      });
    } catch (error) {
      return sendFail(reply, 'export_render_failed', `渲染失败：${String(error).slice(0, 200)}`);
    }

    const sha256 = await sha256Hex(rendered.bytes);
    await ensureDir(context.paths.exportsDir);
    // 产物文件名派生自 documentId/pageId：一律经唯一安全解析器落盘（不自行 join）
    const filePath = await resolveWithin(context.paths.exportsDir, rendered.fileName);
    if (filePath === null) {
      return sendFail(reply, 'export_render_failed', '产物文件名越界（已拒绝写入）');
    }
    await writeFile(filePath, rendered.bytes);

    const artifact: ExportArtifact = {
      format,
      mimeType: rendered.mimeType,
      fileName: rendered.fileName,
      length: rendered.bytes.length,
      sha256,
      base64: rendered.bytes.toString('base64'),
      filePath,
    };

    context.telemetry
      .append({
        name: 'export.completed',
        payload: { documentId, pageId, format, length: rendered.bytes.length },
        sessionId: null,
        appVersion: null,
        at: null,
      })
      .catch(() => undefined);

    return sendOk(reply, {
      artifact,
      skippedNodes: rendered.skippedNodes,
      maxScale: EXPORT_MAX_SCALE,
    });
  });
}
