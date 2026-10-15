/**
 * @dforge/daemon · 文档路由（`.dfg` 目录态 CRUD；FE-02/03/06 消费）。
 *
 * 正文以 opaque JSON 传输/存储（元数据强类型）——daemon 只校验 JSON 可解析与形状，
 * 不解析节点语义（Design IR 归 @dforge/engine，见契约包归属裁决）。
 */

import type { PageSaveRequest } from '@dforge/contracts';
import { DAEMON_ROUTES } from '@dforge/contracts';
import type { FastifyInstance } from 'fastify';

import type { DaemonContext } from '../app.ts';
import { sendFail, sendOk } from '../http.ts';

function readStringField(body: unknown, field: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : null;
}

/** 注册文档路由。 */
export function registerDocumentsRoutes(app: FastifyInstance, context: DaemonContext): void {
  const store = context.documents;

  app.get(DAEMON_ROUTES.documents.path, async (_request, reply) => {
    const result = await store.list();
    context.telemetry
      .append({
        name: 'doc.opened',
        payload: { view: 'list', count: result.documents.length },
        sessionId: null,
        appVersion: null,
        at: null,
      })
      .catch(() => undefined);
    return sendOk(reply, result);
  });

  app.post(DAEMON_ROUTES.documentCreate.path, async (request, reply) => {
    const name = readStringField(request.body, 'name');
    if (name === null) {
      return sendFail(reply, 'doc_invalid_name', 'name 必须是非空字符串（≤64 字符）');
    }
    const result = await store.create(name);
    if (!result.ok) {
      return sendFail(reply, result.code, result.message, result.details);
    }
    context.telemetry
      .append({
        name: 'doc.created',
        payload: { documentId: result.value.id },
        sessionId: null,
        appVersion: null,
        at: null,
      })
      .catch(() => undefined);
    return sendOk(reply, { document: result.value }, 201);
  });

  app.get(DAEMON_ROUTES.documentGet.path, async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const result = await store.get(documentId);
    if (!result.ok) {
      return sendFail(reply, result.code, result.message, result.details);
    }
    return sendOk(reply, { document: result.value });
  });

  app.patch(DAEMON_ROUTES.documentRename.path, async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const name = readStringField(request.body, 'name');
    if (name === null) {
      return sendFail(reply, 'doc_invalid_name', 'name 必须是非空字符串（≤64 字符）');
    }
    const result = await store.rename(documentId, name);
    if (!result.ok) {
      return sendFail(reply, result.code, result.message, result.details);
    }
    return sendOk(reply, { document: result.value });
  });

  app.delete(DAEMON_ROUTES.documentDelete.path, async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const result = await store.remove(documentId);
    if (!result.ok) {
      return sendFail(reply, result.code, result.message, result.details);
    }
    return sendOk(reply, { id: result.value.id, deleted: true });
  });

  app.post(DAEMON_ROUTES.documentPageCreate.path, async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const name = readStringField(request.body, 'name');
    if (name === null) {
      return sendFail(reply, 'doc_invalid_name', 'name 必须是非空字符串（≤64 字符）');
    }
    const result = await store.createPage(documentId, name);
    if (!result.ok) {
      return sendFail(reply, result.code, result.message, result.details);
    }
    return sendOk(reply, { page: result.value }, 201);
  });

  app.get(DAEMON_ROUTES.documentPageGet.path, async (request, reply) => {
    const { documentId, pageId } = request.params as { documentId: string; pageId: string };
    const result = await store.readPage(documentId, pageId);
    if (!result.ok) {
      return sendFail(reply, result.code, result.message, result.details);
    }
    return sendOk(reply, { page: result.value.page, body: result.value.body });
  });

  app.put(DAEMON_ROUTES.documentPageSave.path, async (request, reply) => {
    const { documentId, pageId } = request.params as { documentId: string; pageId: string };
    if (typeof request.body !== 'object' || request.body === null || !('body' in request.body)) {
      return sendFail(reply, 'doc_invalid_body', '请求体必须包含 body 字段（opaque JSON）', {
        documentId,
        pageId,
      });
    }
    const requestBody = request.body as PageSaveRequest;
    const result = await store.savePage(documentId, pageId, requestBody.body);
    if (!result.ok) {
      return sendFail(reply, result.code, result.message, result.details);
    }
    context.telemetry
      .append({
        name: 'page.saved',
        payload: { documentId, pageId },
        sessionId: null,
        appVersion: null,
        at: null,
      })
      .catch(() => undefined);
    return sendOk(reply, { page: result.value });
  });

  app.delete(DAEMON_ROUTES.documentPageDelete.path, async (request, reply) => {
    const { documentId, pageId } = request.params as { documentId: string; pageId: string };
    const result = await store.deletePage(documentId, pageId);
    if (!result.ok) {
      return sendFail(reply, result.code, result.message, result.details);
    }
    return sendOk(reply, {
      documentId: result.value.documentId,
      pageId: result.value.pageId,
      deleted: true,
    });
  });
}
