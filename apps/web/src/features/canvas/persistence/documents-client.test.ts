/**
 * 文档持久化客户端测试（票 12 · spec P2：参考线随文档保存/加载）。
 *
 * 断言口径：外部行为——HTTP 请求形状（走 DAEMON_ROUTES 模板）+ 载入回读的文档真值。
 * 参考线是页面数据：save→read→load 往返后必须原样保留（opaque JSON 正文 + 引擎
 * parseDocument 结构校验都不得丢字段）。fetch 用桩（CI 无网络、无真 daemon）。
 */

import { createDocument, createGuide, createPage, createRect } from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import {
  createDocumentsClient,
  type DocumentsClient,
  encodePageBody,
  loadDesignDocument,
  saveDesignDocument,
} from './documents-client';

/** 内存版 daemon 信封路由（只实现本用例触达的文档/页路由；页集按 manifest 建模）。 */
interface StubDocument {
  id: string;
  name: string;
  pages: Map<string, unknown>;
  pageNames: Map<string, string>;
}

interface StubDaemon {
  client: DocumentsClient;
  requests: string[];
  /** 预置一份文档（页顺序 = 数组顺序；正文原样落盘）。 */
  seed(documentId: string, pages: Array<{ id: string; body: unknown; name?: string }>): void;
  /** 当前文档的页文件集合（id → 正文）。 */
  pagesOf(documentId: string): Map<string, unknown>;
}

function stubDaemon(): StubDaemon {
  const requests: string[] = [];
  let nextDocumentId = 1;
  const documents = new Map<string, StubDocument>();

  const createStubDocument = (id: string, name: string): StubDocument => {
    const document: StubDocument = { id, name, pages: new Map(), pageNames: new Map() };
    documents.set(id, document);
    return document;
  };
  /** 缺省分配：pages.length + 1 起跳号（与 daemon 同规则）。 */
  const allocatePageId = (document: StubDocument): string => {
    let counter = document.pages.size + 1;
    while (document.pages.has(`page-${String(counter)}`)) counter += 1;
    return `page-${String(counter)}`;
  };

  const reply = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    requests.push(`${method} ${path}`);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;

    if (method === 'GET' && path === '/documents') {
      return reply(200, {
        ok: true,
        result: {
          documents: [...documents.values()].map((item) => ({
            id: item.id,
            name: item.name,
          })),
        },
      });
    }
    if (method === 'POST' && path === '/documents') {
      const id = `doc_${String(nextDocumentId)}`;
      nextDocumentId += 1;
      const document = createStubDocument(id, String(body.name));
      // 与真 daemon 一致：新建设计文件写一个 `{}` 占位页 page-1
      document.pages.set('page-1', {});
      document.pageNames.set('page-1', '页面 1');
      return reply(200, { ok: true, result: { document: { id, name: document.name } } });
    }
    const documentMatch = /^\/documents\/([^/]+)$/.exec(path);
    if (method === 'GET' && documentMatch !== null) {
      const id = decodeURIComponent(documentMatch[1] as string);
      const found = documents.get(id);
      if (found === undefined) return reply(404, { ok: false, error: { code: 'doc_not_found' } });
      return reply(200, {
        ok: true,
        result: {
          document: {
            id: found.id,
            name: found.name,
            pageCount: found.pages.size,
            // 详情含 manifest 页清单（页集有洞时按 id 原样列出）
            pages: [...found.pages.keys()].map((pageId) => ({
              id: pageId,
              name: found.pageNames.get(pageId) ?? pageId,
              updatedAt: '2026-11-04T00:00:00.000Z',
            })),
          },
        },
      });
    }
    const pageCreateMatch = /^\/documents\/([^/]+)\/pages$/.exec(path);
    if (method === 'POST' && pageCreateMatch !== null) {
      const id = decodeURIComponent(pageCreateMatch[1] as string);
      const document = documents.get(id);
      if (document === undefined)
        return reply(404, { ok: false, error: { code: 'doc_not_found' } });
      const requested = body.id;
      const pageId = typeof requested === 'string' ? requested : allocatePageId(document);
      if (document.pages.has(pageId)) {
        return reply(409, { ok: false, error: { code: 'doc_exists' } });
      }
      document.pages.set(pageId, {});
      document.pageNames.set(pageId, String(body.name ?? ''));
      return reply(201, { ok: true, result: { page: { id: pageId, name: String(body.name) } } });
    }
    const pageMatch = /^\/documents\/([^/]+)\/pages\/([^/]+)$/.exec(path);
    if (pageMatch !== null) {
      const id = decodeURIComponent(pageMatch[1] as string);
      const pageId = decodeURIComponent(pageMatch[2] as string);
      const document = documents.get(id);
      if (document === undefined)
        return reply(404, { ok: false, error: { code: 'doc_not_found' } });
      if (method === 'PUT') {
        if (!document.pages.has(pageId)) {
          return reply(404, { ok: false, error: { code: 'not_found' } });
        }
        document.pages.set(pageId, body.body);
        return reply(200, { ok: true, result: { pageId } });
      }
      if (method === 'GET') {
        if (!document.pages.has(pageId)) {
          return reply(404, { ok: false, error: { code: 'not_found' } });
        }
        return reply(200, { ok: true, result: { body: document.pages.get(pageId) } });
      }
    }
    return reply(404, { ok: false, error: { code: 'not_found' } });
  }) as typeof fetch;

  return {
    client: createDocumentsClient({ baseUrl: 'http://daemon.test', fetchImpl: fetchStub }),
    requests,
    seed(documentId, pages) {
      const document = createStubDocument(documentId, documentId);
      for (const page of pages) {
        document.pages.set(page.id, page.body);
        document.pageNames.set(page.id, page.name ?? page.id);
      }
    },
    pagesOf(documentId) {
      const document = documents.get(documentId);
      if (document === undefined) throw new Error(`未预置文档：${documentId}`);
      return document.pages;
    },
  };
}

/** 夹具文档：一个矩形 + 两条参考线（水平/垂直）。 */
function fixtureDocument() {
  return createDocument({
    id: 'doc_1',
    name: '参考线持久化',
    pages: [
      createPage({
        id: 'page-1',
        nodes: { n_1: createRect({ id: 'n_1', x: 0, y: 0, width: 40, height: 30 }) },
        rootIds: ['n_1'],
        guides: [
          createGuide({ id: 'guide_1', axis: 'y', position: 120 }),
          createGuide({ id: 'guide_2', axis: 'x', position: 80 }),
        ],
      }),
    ],
  });
}

describe('参考线随文档保存/加载（票 12）', () => {
  it('save → load 往返后参考线原样保留（页面正文 opaque 透传 + parseDocument 校验放行）', async () => {
    const daemon = stubDaemon();
    const document = fixtureDocument();

    // 落盘身份先建（document-bridge 的幂等落盘口径：先建/复用文档，再逐页 PUT）
    const created = await daemon.client.createDocument(document.name);
    expect(created.ok).toBe(true);
    const documentId = created.ok ? created.value.id : 'doc_1';

    const saved = await saveDesignDocument(daemon.client, documentId, document);
    expect(saved.ok).toBe(true);

    const loaded = await loadDesignDocument(daemon.client, documentId);
    expect(loaded.ok, loaded.ok ? '' : loaded.error).toBe(true);
    if (!loaded.ok) return;
    const guides = loaded.value.pages[0]?.guides ?? [];
    expect(guides).toEqual([
      { id: 'guide_1', axis: 'y', position: 120 },
      { id: 'guide_2', axis: 'x', position: 80 },
    ]);
  });

  it('页面正文带 guides 键落盘（daemon 只存 opaque JSON，键不丢）', () => {
    const document = fixtureDocument();
    const body = encodePageBody(document, document.pages[0] as (typeof document.pages)[0]);
    expect((body.page as { guides: unknown }).guides).toHaveLength(2);
  });
});

/** 取第 index 页（noUncheckedIndexedAccess 下的测试夹具辅助）。 */
function pageAt(document: ReturnType<typeof createDocument>, index: number) {
  const page = document.pages[index];
  if (page === undefined) throw new Error(`文档缺少第 ${String(index)} 页`);
  return page;
}

describe('页集有洞（arch-01 · 页 id 是身份不是位置）', () => {
  /** 造一份有两页的文档（页 id 与页文件 id 对齐）。 */
  function twoPageDocument() {
    return createDocument({
      id: 'doc_hole',
      name: '有洞文档',
      pages: [
        createPage({
          id: 'page-1',
          nodes: { n_1: createRect({ id: 'n_1', x: 0, y: 0, width: 10, height: 10 }) },
          rootIds: ['n_1'],
        }),
        createPage({
          id: 'page-3',
          nodes: { n_3: createRect({ id: 'n_3', x: 20, y: 20, width: 10, height: 10 }) },
          rootIds: ['n_3'],
        }),
      ],
    });
  }

  it('load 按 manifest 读回 [page-1, page-3] 两页（修复前截断为 1 页）', async () => {
    const document = twoPageDocument();
    const daemon = stubDaemon();
    daemon.seed('有洞', [
      { id: 'page-1', body: encodePageBody(document, pageAt(document, 0)) },
      { id: 'page-3', body: encodePageBody(document, pageAt(document, 1)) },
    ]);

    const loaded = await loadDesignDocument(daemon.client, '有洞');
    expect(loaded.ok, loaded.ok ? '' : loaded.error).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.pages.map((page) => page.id)).toEqual(['page-1', 'page-3']);
    expect(loaded.value.pages[1]?.nodes.n_3?.type).toBe('rect');
  });

  it('save 有洞文档：按 id 写回 page-3（不新建 page-4、不把 page-3 变孤儿）', async () => {
    const document = twoPageDocument();
    const daemon = stubDaemon();
    daemon.seed('有洞', [
      { id: 'page-1', body: encodePageBody(document, pageAt(document, 0)) },
      { id: 'page-3', body: encodePageBody(document, pageAt(document, 1)) },
    ]);

    const loaded = await loadDesignDocument(daemon.client, '有洞');
    expect(loaded.ok, loaded.ok ? '' : loaded.error).toBe(true);
    if (!loaded.ok) return;

    const saved = await saveDesignDocument(daemon.client, '有洞', loaded.value);
    expect(saved.ok, saved.ok ? '' : saved.error).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.pageIds).toEqual(['page-1', 'page-3']);
    expect(saved.value.orphanPageIds).toEqual([]);
    // 没有建页请求；页文件集合仍是 [page-1, page-3]
    expect(
      daemon.requests.filter((request) => request.includes('/pages') && request.startsWith('POST')),
    ).toEqual([]);
    expect([...daemon.pagesOf('有洞').keys()]).toEqual(['page-1', 'page-3']);
  });

  it('save 只报告孤儿页（page-3 不删除、不覆盖）', async () => {
    const daemon = stubDaemon();
    const full = twoPageDocument();
    daemon.seed('有洞', [
      { id: 'page-1', body: encodePageBody(full, pageAt(full, 0)) },
      { id: 'page-3', body: encodePageBody(full, pageAt(full, 1)) },
    ]);
    const onlyFirst = createDocument({ id: 'doc', name: '只留第一页', pages: [pageAt(full, 0)] });

    const saved = await saveDesignDocument(daemon.client, '有洞', onlyFirst);
    expect(saved.ok, saved.ok ? '' : saved.error).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.orphanPageIds).toEqual(['page-3']);
    // 孤儿正文仍在磁盘上（禁静默删用户数据）
    expect(daemon.pagesOf('有洞').has('page-3')).toBe(true);
    expect(daemon.requests.some((request) => request.startsWith('DELETE'))).toBe(false);
  });

  it('load 后 page.id = daemon 页 id（正文里的旧 id 不再冒充身份），再 save 仍写回同一页', async () => {
    const daemon = stubDaemon();
    const body = encodePageBody(
      createDocument({ id: 'doc', pages: [createPage({ id: 'page_1' })] }),
      // 正文里是旧的引擎默认 id `page_1`，页文件是 page-1
      createPage({ id: 'page_1' }),
    );
    daemon.seed('身份', [{ id: 'page-1', body }]);

    const loaded = await loadDesignDocument(daemon.client, '身份');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.pages[0]?.id).toBe('page-1');

    const saved = await saveDesignDocument(daemon.client, '身份', loaded.value);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.pageIds).toEqual(['page-1']);
    expect(daemon.requests.some((request) => request.startsWith('POST'))).toBe(false);
  });

  it('新建文档（页 id 已对齐 page-1）：原位更新空白占位页，不新建、无孤儿', async () => {
    const daemon = stubDaemon();
    const created = await daemon.client.createDocument('新文件');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    // 编辑器侧默认页 id 已与 daemon 的占位页对齐（page-1）
    const local = createDocument({
      id: 'doc_local',
      name: '新文件',
      pages: [createPage({ id: 'page-1' })],
    });

    const saved = await saveDesignDocument(daemon.client, created.value.id, local);
    expect(saved.ok, saved.ok ? '' : saved.error).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.pageIds).toEqual(['page-1']);
    expect(saved.value.orphanPageIds).toEqual([]);
    expect([...daemon.pagesOf(created.value.id).keys()]).toEqual(['page-1']);
    expect(
      daemon.requests.some((request) => request.startsWith('POST') && request.endsWith('/pages')),
    ).toBe(false);
  });

  it('新建文档 + 自定义页 id：按自身 id 建页（身份稳定）；占位页只报告为孤儿、不删除', async () => {
    const daemon = stubDaemon();
    const created = await daemon.client.createDocument('新文件');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const local = createDocument({
      id: 'doc_local',
      name: '新文件',
      pages: [createPage({ id: 'page-editor' })],
    });

    const saved = await saveDesignDocument(daemon.client, created.value.id, local);
    expect(saved.ok, saved.ok ? '' : saved.error).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.pageIds).toEqual(['page-editor']);
    // 占位页仍在磁盘上（只报告，不删）
    expect(saved.value.orphanPageIds).toEqual(['page-1']);
    expect([...daemon.pagesOf(created.value.id).keys()]).toEqual(['page-1', 'page-editor']);
    expect(daemon.requests.some((request) => request.startsWith('DELETE'))).toBe(false);
  });

  it('空文档（`{}`）口径保持：一页空画布，id = page-1', async () => {
    const daemon = stubDaemon();
    const created = await daemon.client.createDocument('空白');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const loaded = await loadDesignDocument(daemon.client, created.value.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.pages).toHaveLength(1);
    expect(loaded.value.pages[0]?.id).toBe('page-1');
    expect(loaded.value.pages[0]?.nodes).toEqual({});
  });

  it('非本格式的非空正文 → 结构错误（不静默吞掉）', async () => {
    const daemon = stubDaemon();
    daemon.seed('外来内容', [{ id: 'page-1', body: { hello: 'world' } }]);

    const loaded = await loadDesignDocument(daemon.client, '外来内容');
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error).toContain('格式');
  });
});
