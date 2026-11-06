// vt:fast（纯内存桩，无网络/无真实 daemon）
/**
 * 保存冲突检测 · web 侧回归缝（audit-d06 · D-05，设计决策 Q2=A：409 拒绝 + 手动刷新）。
 *
 * J8 缺陷现场（审计实证 ~/df-evidence/audit-2026-11/e2e/journeys/J8/）：同一文档双页
 * 先后保存均 200——后写者以旧基线整页覆盖先写者的更新，静默丢数据。本文件在 **app 层**
 * 复现该场景并锁住修复后的行为：
 *
 * - 客户端把载入时的文档 revision（daemon manifest version）作为保存基线：条件保存按
 *   `If-Match: <revision>` 头发出（daemon 侧 HTTP 行为由
 *   `apps/daemon/src/routes/documents.revision.test.ts` 以真 store + 真 fastify 钉住；
 *   本桩的 If-Match 解析与其同判据，两层合起来覆盖 J8 链路）；
 * - **revision 感知内存桩**（信封取 contracts 真构造，daemon 语义同构）：基线过期 →
 *   409 `doc_revision_conflict`，先写者内容原样保留；
 * - `saveDesignDocument` 沿保存链**串行推进基线**（每次写成功的响应 revision 作为下一写的
 *   If-Match），任一写冲突即中止（后续页不再发出）；
 * - 恢复路径：冲突后重新载入（手动刷新）拿到最新 revision，再保存成功；
 * - 旧 daemon 降级：响应缺 revision 字段时保存仍成功（结果 revision 为 null，不误伤）。
 */
import { apiFailure, apiSuccess } from '@dforge/contracts';
import { createDocument, createPage, createRect, type DesignDocument } from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import {
  createDocumentsClient,
  type DocumentsClient,
  loadDesignDocument,
  saveDesignDocument,
} from './documents-client';
import { loadPageSet } from './page-set';

/**
 * If-Match 头解析（与 contracts `parseRevisionHeader` 同判据的本地实现）：
 * 缺省 → undefined；数字/带引号实体标签 → number；其余 → 'invalid'。
 * 桩里就地实现是为了红阶段可独立于契约新 API 运行；判据由 daemon 的 HTTP 用例钉住。
 */
function parseIfMatch(value: string | null): number | 'invalid' | undefined {
  if (value === null) return undefined;
  const text = value.trim();
  const unquoted =
    text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
  return /^\d+$/.test(unquoted) ? Number(unquoted) : 'invalid';
}

/** revision 感知内存 daemon 的文档态（manifest version 语义与真 daemon 同构）。 */
interface RevisionDocument {
  name: string;
  /** manifest.version：每次结构写（建页/保存正文）自增。 */
  revision: number;
  pages: Map<string, unknown>;
  pageNames: Map<string, string>;
}

interface RevisionDaemon {
  client: DocumentsClient;
  /** 收到的条件头序列（`METHOD path if-match=<值|->`；断言保存链的基线推进用）。 */
  conditionalLog: string[];
  /** 预置一份文档（初始 revision = 1）。 */
  seed(documentId: string, pages: Array<{ id: string; body: unknown; name?: string }>): void;
  /** 当前 revision。 */
  revisionOf(documentId: string): number;
  pagesOf(documentId: string): Map<string, unknown>;
}

/**
 * 创建 revision 感知内存 daemon。
 *
 * `withRevisions: false` 时退化为旧 daemon 形态（响应不带 revision、忽略 If-Match）——
 * 钉「旧上游不破」的降级路径。
 */
function revisionDaemon(options?: { withRevisions?: boolean }): RevisionDaemon {
  const withRevisions = options?.withRevisions !== false;
  const documents = new Map<string, RevisionDocument>();
  const conditionalLog: string[] = [];
  let nextDocumentId = 1;

  const reply = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const headers = new Headers(init?.headers);
    const ifMatchRaw = headers.get('if-match');
    const ifMatch = parseIfMatch(ifMatchRaw);
    conditionalLog.push(`${method} ${path} if-match=${ifMatchRaw ?? '-'}`);

    /** 条件检查：带 If-Match 且（非法 或 不等于当前 revision）→ 冲突（旧行为/无头 → 放行）。 */
    const conflicted = (document: RevisionDocument): boolean => {
      if (!withRevisions || ifMatch === undefined) return false;
      return ifMatch === 'invalid' || ifMatch !== document.revision;
    };

    if (method === 'GET' && path === '/documents') {
      return reply(
        200,
        apiSuccess({
          documents: [...documents.entries()].map(([id, item]) => ({
            id,
            name: item.name,
            ...(withRevisions ? { revision: item.revision } : {}),
          })),
        }),
      );
    }
    if (method === 'POST' && path === '/documents') {
      const id = `doc_${String(nextDocumentId)}`;
      nextDocumentId += 1;
      documents.set(id, {
        name: String(body.name),
        revision: 1,
        pages: new Map([['page-1', {}]]),
        pageNames: new Map([['page-1', '页面 1']]),
      });
      const created = documents.get(id);
      return reply(
        201,
        apiSuccess({
          document: {
            id,
            name: created?.name,
            ...(withRevisions ? { revision: created?.revision } : {}),
          },
        }),
      );
    }
    const documentMatch = /^\/documents\/([^/]+)$/.exec(path);
    if (method === 'GET' && documentMatch !== null) {
      const id = decodeURIComponent(documentMatch[1] as string);
      const document = documents.get(id);
      if (document === undefined) return reply(404, apiFailure('doc_not_found', '文档不存在'));
      return reply(
        200,
        apiSuccess({
          document: {
            id,
            name: document.name,
            pageCount: document.pages.size,
            ...(withRevisions ? { revision: document.revision } : {}),
            pages: [...document.pages.keys()].map((pageId) => ({
              id: pageId,
              name: document.pageNames.get(pageId) ?? pageId,
              updatedAt: '2026-11-04T00:00:00.000Z',
            })),
          },
        }),
      );
    }
    const pageCreateMatch = /^\/documents\/([^/]+)\/pages$/.exec(path);
    if (method === 'POST' && pageCreateMatch !== null) {
      const id = decodeURIComponent(pageCreateMatch[1] as string);
      const document = documents.get(id);
      if (document === undefined) return reply(404, apiFailure('doc_not_found', '文档不存在'));
      if (conflicted(document)) {
        return reply(
          409,
          apiFailure('doc_revision_conflict', '文档已被另一窗口修改：保存基于旧版本，已拒绝'),
        );
      }
      const requested = body.id;
      const pageId =
        typeof requested === 'string'
          ? requested
          : `page-${String(document.pages.size + 1)}`;
      if (document.pages.has(pageId)) return reply(409, apiFailure('doc_exists', '页面 id 已存在'));
      document.pages.set(pageId, {});
      document.pageNames.set(pageId, String(body.name ?? ''));
      document.revision += 1;
      return reply(
        201,
        apiSuccess({
          page: { id: pageId, name: String(body.name ?? '') },
          ...(withRevisions ? { revision: document.revision } : {}),
        }),
      );
    }
    const pageMatch = /^\/documents\/([^/]+)\/pages\/([^/]+)$/.exec(path);
    if (pageMatch !== null) {
      const id = decodeURIComponent(pageMatch[1] as string);
      const pageId = decodeURIComponent(pageMatch[2] as string);
      const document = documents.get(id);
      if (document === undefined) return reply(404, apiFailure('doc_not_found', '文档不存在'));
      if (method === 'PUT') {
        if (!document.pages.has(pageId)) return reply(404, apiFailure('not_found', '页面不存在'));
        if (conflicted(document)) {
          return reply(
            409,
            apiFailure('doc_revision_conflict', '文档已被另一窗口修改：保存基于旧版本，已拒绝', {
              currentRevision: document.revision,
            }),
          );
        }
        document.pages.set(pageId, body.body);
        document.revision += 1;
        return reply(
          200,
          apiSuccess({
            page: { id: pageId, name: document.pageNames.get(pageId) ?? pageId },
            ...(withRevisions ? { revision: document.revision } : {}),
          }),
        );
      }
      if (method === 'GET') {
        if (!document.pages.has(pageId)) return reply(404, apiFailure('not_found', '页面不存在'));
        return reply(
          200,
          apiSuccess({
            body: document.pages.get(pageId),
            ...(withRevisions ? { revision: document.revision } : {}),
          }),
        );
      }
    }
    return reply(404, apiFailure('not_found', '路由不存在'));
  }) as typeof fetch;

  return {
    client: createDocumentsClient({ baseUrl: 'http://daemon.test', fetchImpl: fetchStub }),
    conditionalLog,
    seed(documentId, pages) {
      const document: RevisionDocument = {
        name: documentId,
        revision: 1,
        pages: new Map(),
        pageNames: new Map(),
      };
      for (const page of pages) {
        document.pages.set(page.id, page.body);
        document.pageNames.set(page.id, page.name ?? page.id);
      }
      documents.set(documentId, document);
    },
    revisionOf(documentId) {
      return documents.get(documentId)?.revision ?? -1;
    },
    pagesOf(documentId) {
      return documents.get(documentId)?.pages ?? new Map();
    },
  };
}

/** 夹具文档：两页（各一个矩形），页 id 合法（保存计划按自身 id 命中/建页）；`firstRectX` 便于区分窗口内容。 */
function fixtureDocument(name: string, firstRectX = 10): DesignDocument {
  return createDocument({
    id: 'doc-fixture',
    name,
    pages: [
      createPage({
        id: 'page-1',
        name: '页面 1',
        nodes: { n_1: createRect({ id: 'n_1', x: firstRectX, y: 20, width: 40, height: 30 }) },
        rootIds: ['n_1'],
      }),
      createPage({
        id: 'page-2',
        name: '页面 2',
        nodes: { n_2: createRect({ id: 'n_2', x: 30, y: 40, width: 40, height: 30 }) },
        rootIds: ['n_2'],
      }),
    ],
  });
}

describe('documents-client · 条件保存（audit-d06 · D-05）', () => {
  it('savePage 带 ifMatchRevision → 发出 If-Match 头；响应 revision 回传', async () => {
    const daemon = revisionDaemon();
    daemon.seed('doc-1', [{ id: 'page-1', body: {} }]);
    const saved = await daemon.client.savePage('doc-1', 'page-1', { v: 1 }, {
      ifMatchRevision: 1,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.revision).toBe(2);
    expect(daemon.conditionalLog).toEqual(['PUT /documents/doc-1/pages/page-1 if-match=1']);
  });

  it('基线过期 → 409 doc_revision_conflict：结果带 code，错误文本含码与人话', async () => {
    const daemon = revisionDaemon();
    daemon.seed('doc-1', [{ id: 'page-1', body: {} }]);
    // 他人先写：revision 前进到 2
    await daemon.client.savePage('doc-1', 'page-1', { v: '先写' }, { ifMatchRevision: 1 });
    // 本窗口持旧基线 1 保存
    const stale = await daemon.client.savePage('doc-1', 'page-1', { v: '旧基线' }, {
      ifMatchRevision: 1,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.code).toBe('doc_revision_conflict');
    expect(stale.error).toContain('doc_revision_conflict');
    expect(stale.error).toContain('文档已被另一窗口修改');
  });

  it('saveDesignDocument 沿保存链推进基线：第二页的 If-Match 用第一页响应的 revision', async () => {
    const daemon = revisionDaemon();
    daemon.seed('doc-1', [
      { id: 'page-1', body: {} },
      { id: 'page-2', body: {} },
    ]);
    const document = fixtureDocument('冲突链');
    const saved = await saveDesignDocument(daemon.client, 'doc-1', document, {
      baselineRevision: 1,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.revision).toBe(3); // 两页各 +1
    expect(daemon.conditionalLog).toEqual([
      'GET /documents/doc-1 if-match=-', // 保存前的页清单读取（无条件头）
      'PUT /documents/doc-1/pages/page-1 if-match=1',
      'PUT /documents/doc-1/pages/page-2 if-match=2', // 基线已推进到第一页响应的 revision
    ]);
  });

  it('J8 · 双窗口先后保存：后写者（旧基线）失败于首个条件写（409），先写者内容不被覆盖', async () => {
    const daemon = revisionDaemon();
    daemon.seed('doc-1', [
      { id: 'page-1', body: {} },
      { id: 'page-2', body: {} },
    ]);
    // 两个窗口各自基于同一状态载入（J8：双页同文档）
    const loadA = await loadDesignDocument(daemon.client, 'doc-1');
    const loadB = await loadDesignDocument(daemon.client, 'doc-1');
    expect(loadA.ok && loadB.ok).toBe(true);

    // 窗口 A 改第一页（矩形位移到 x=99）并保存 → 成功（revision 1 → 3）
    const savedA = await saveDesignDocument(daemon.client, 'doc-1', fixtureDocument('冲突文档', 99), {
      baselineRevision: 1,
    });
    expect(savedA.ok).toBe(true);

    // 窗口 B 仍持旧基线 1 保存（修复前：200 静默覆盖 A 的更新）
    const savedB = await saveDesignDocument(daemon.client, 'doc-1', fixtureDocument('冲突文档'), {
      baselineRevision: 1,
    });
    expect(savedB.ok).toBe(false);
    if (savedB.ok) return;
    expect(savedB.code).toBe('doc_revision_conflict');
    // 冲突即中止：B 只发出了第一个条件写（后续页不再发出）
    const putLines = daemon.conditionalLog.filter((line) => line.startsWith('PUT'));
    expect(putLines).toHaveLength(3); // A 两页 + B 第一页（被拒）
    expect(putLines[2]).toBe('PUT /documents/doc-1/pages/page-1 if-match=1');
    // A 的第一页内容原样保留（正文是 CanvasPageBody 信封；静默覆盖不再发生）
    const page1 = daemon.pagesOf('doc-1').get('page-1') as {
      page?: { nodes?: { n_1?: { x: number } } };
    };
    expect(page1.page?.nodes?.n_1?.x).toBe(99);
  });

  it('恢复路径：冲突后重新载入（手动刷新）再保存 → 成功', async () => {
    const daemon = revisionDaemon();
    daemon.seed('doc-1', [{ id: 'page-1', body: {} }]);
    const savedA = await saveDesignDocument(daemon.client, 'doc-1', fixtureDocument('冲突文档'), {
      baselineRevision: 1,
    });
    expect(savedA.ok).toBe(true);
    // 窗口 B 旧基线 → 冲突
    const stale = await saveDesignDocument(daemon.client, 'doc-1', fixtureDocument('冲突文档'), {
      baselineRevision: 1,
    });
    expect(stale.ok).toBe(false);
    // 手动刷新：重新载入最新内容
    const refreshed = await loadDesignDocument(daemon.client, 'doc-1');
    expect(refreshed.ok).toBe(true);
    // 在新基线上保存 → 成功，最终 revision 与 daemon 一致
    const retry = await saveDesignDocument(daemon.client, 'doc-1', fixtureDocument('冲突文档'), {
      baselineRevision: refreshed.ok ? refreshed.value.revision : null,
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.value.revision).toBe(daemon.revisionOf('doc-1'));
  });

  it('旧 daemon（响应缺 revision）保存仍成功且 revision 为 null（降级不破）；未给基线不发 If-Match', async () => {
    const legacy = revisionDaemon({ withRevisions: false });
    legacy.seed('doc-1', [{ id: 'page-1', body: {} }]);
    const document = fixtureDocument('旧上游');
    const saved = await saveDesignDocument(legacy.client, 'doc-1', document, {
      baselineRevision: 1,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    // 旧上游无 revision 可回传：保存成功（不破），冲突检测本会话降级关闭
    expect(saved.value.revision).toBeNull();
    // 客户端仍按给定基线发条件头（旧上游忽略它——兼容是上游的硬约束，daemon 用例已钉）
    expect(legacy.conditionalLog.filter((line) => line.startsWith('PUT'))).toEqual([
      'PUT /documents/doc-1/pages/page-1 if-match=1',
      'PUT /documents/doc-1/pages/page-2 if-match=1',
    ]);

    // 完全不给 options（既有调用形态）：无外来基线——首写不带 If-Match（旧行为）；
    // 首写成功后基线推进到本次保存自身的 revision，后续写据此发条件头（正确且更安全：
    // 并发窗口若在两写之间插入保存，后一写会被 409 拒绝而非静默覆盖）
    const daemon = revisionDaemon();
    daemon.seed('doc-2', [{ id: 'page-1', body: {} }]);
    const legacyCall = await saveDesignDocument(daemon.client, 'doc-2', document);
    expect(legacyCall.ok).toBe(true);
    const puts = daemon.conditionalLog.filter((line) => line.startsWith('PUT'));
    expect(puts[0]).toBe('PUT /documents/doc-2/pages/page-1 if-match=-');
    // 首写（1→2）+ 建页（2→3）后，第二页正文写以自身产生的 revision 3 为基线
    expect(puts[1]).toBe('PUT /documents/doc-2/pages/page-2 if-match=3');
  });

  it('loadPageSet 载入结果带 revision（保存基线的来源）；旧上游为 null', async () => {
    const daemon = revisionDaemon();
    daemon.seed('doc-1', [{ id: 'page-1', body: {} }]);
    const loaded = await loadPageSet(daemon.client, 'doc-1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.revision).toBe(1);

    const legacy = revisionDaemon({ withRevisions: false });
    legacy.seed('doc-2', [{ id: 'page-1', body: {} }]);
    const legacyLoaded = await loadPageSet(legacy.client, 'doc-2');
    expect(legacyLoaded.ok).toBe(true);
    if (!legacyLoaded.ok) return;
    expect(legacyLoaded.value.revision).toBeNull();
  });
});
