/**
 * @dforge/daemon · 文档路由（`.dfg` 目录态 CRUD；FE-02/03/06 消费）。
 *
 * 正文以 opaque JSON 传输/存储（元数据强类型）——daemon 只校验 JSON 可解析与形状，
 * 不解析节点语义（Design IR 归 @dforge/engine，见契约包归属裁决）。
 *
 * 保存冲突检测（audit-d06 · D-05 · Q2=A）：页面写入（PUT 保存 / POST 建页）支持
 * `If-Match: <revision>` 条件头——头给定时在提交锁内比对 manifest.version，不匹配即
 * 409 `doc_revision_conflict`（正文与版本不变）；**不给头走旧行为**（last-write-wins，
 * 向后兼容硬约束：旧客户端不破）。头解析取 contracts 单一判据（parseRevisionHeader）。
 */

import type { PageSaveRequest } from '@dforge/contracts';
import { DAEMON_ROUTES, DF_REVISION_HEADER, parseRevisionHeader } from '@dforge/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { DaemonContext } from '../app.ts';
import { sendFail, sendOk } from '../http.ts';

function readStringField(body: unknown, field: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : null;
}

/** 读可选字段的原始值（区分「未给」与「给了非字符串」——后者要按非法 id 拒绝）。 */
function readOptionalStringField(body: unknown, field: string): string | undefined | null {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[field];
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : null;
}

/**
 * 解析条件保存的 If-Match 头（audit-d06 · D-05）：
 * - 未带头 → `undefined`（旧行为，向后兼容硬约束）；
 * - 带头且是 revision 整数（裸数字/带引号实体标签）→ 该 revision；
 * - 带头但非法（`*`/非整数/空串）→ `null`（调用方按 400 bad_request 拒绝）。
 */
function readExpectedRevision(request: FastifyRequest): number | undefined | null {
  const raw = request.headers[DF_REVISION_HEADER];
  if (raw === undefined) return undefined;
  const text = Array.isArray(raw) ? (raw[0] ?? '') : raw;
  return parseRevisionHeader(text);
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
    // 可选目标 id：未给 → daemon 跳号分配；给了非字符串 → 按非法页 id 拒绝（不静默忽略）
    const pageId = readOptionalStringField(request.body, 'id');
    if (pageId === null) {
      return sendFail(reply, 'doc_invalid_id', 'id 必须是合法页 id 字符串（[A-Za-z0-9._-]{1,64}）');
    }
    // 条件保存（audit-d06 · D-05）：建页同样受基线保护（不静默追加到他人已修改的文档上）
    const expectedRevision = readExpectedRevision(request);
    if (expectedRevision === null) {
      return sendFail(
        reply,
        'bad_request',
        'If-Match 头必须是文档 revision（非负整数，接受带引号实体标签形态）',
        { documentId, pageId: pageId ?? undefined },
      );
    }
    const result = await store.createPage(
      documentId,
      name,
      pageId === undefined
        ? expectedRevision === undefined
          ? undefined
          : { expectedRevision }
        : { id: pageId, ...(expectedRevision === undefined ? {} : { expectedRevision }) },
    );
    if (!result.ok) {
      return sendFail(reply, result.code, result.message, result.details);
    }
    return sendOk(reply, { page: result.value.page, revision: result.value.revision }, 201);
  });

  app.get(DAEMON_ROUTES.documentPageGet.path, async (request, reply) => {
    const { documentId, pageId } = request.params as { documentId: string; pageId: string };
    const result = await store.readPage(documentId, pageId);
    if (!result.ok) {
      return sendFail(reply, result.code, result.message, result.details);
    }
    // revision 随读回传（客户端载入时记基线，条件保存据此发 If-Match；audit-d06 · D-05）
    return sendOk(reply, {
      page: result.value.page,
      body: result.value.body,
      revision: result.value.summary.revision,
    });
  });

  app.put(DAEMON_ROUTES.documentPageSave.path, async (request, reply) => {
    const { documentId, pageId } = request.params as { documentId: string; pageId: string };
    if (typeof request.body !== 'object' || request.body === null || !('body' in request.body)) {
      return sendFail(reply, 'doc_invalid_body', '请求体必须包含 body 字段（opaque JSON）', {
        documentId,
        pageId,
      });
    }
    // 条件保存（audit-d06 · D-05）：带头=按 revision 比对；未带头=旧行为（兼容旧客户端）
    const expectedRevision = readExpectedRevision(request);
    if (expectedRevision === null) {
      return sendFail(
        reply,
        'bad_request',
        'If-Match 头必须是文档 revision（非负整数，接受带引号实体标签形态）',
        { documentId, pageId },
      );
    }
    const requestBody = request.body as PageSaveRequest;
    const result = await store.savePage(
      documentId,
      pageId,
      requestBody.body,
      expectedRevision === undefined ? undefined : { expectedRevision },
    );
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
    return sendOk(reply, { page: result.value.page, revision: result.value.revision });
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
