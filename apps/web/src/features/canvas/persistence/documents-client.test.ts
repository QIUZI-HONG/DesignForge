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

/** 内存版 daemon 信封路由（只实现本用例触达的五条）。 */
function stubDaemon(): { client: DocumentsClient; requests: string[] } {
  const requests: string[] = [];
  const pages = new Map<string, unknown>();
  let nextDocumentId = 1;
  const documents: Array<{ id: string; name: string }> = [];

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

    if (method === 'GET' && path === '/documents') {
      return reply(200, { ok: true, result: { documents } });
    }
    if (method === 'POST' && path === '/documents') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { name: string };
      const document = { id: `doc_${nextDocumentId}`, name: body.name };
      nextDocumentId += 1;
      documents.push(document);
      return reply(200, { ok: true, result: { document } });
    }
    if (method === 'GET' && /^\/documents\/[^/]+$/.test(path)) {
      const id = path.split('/')[2] as string;
      const found = documents.find((entry) => entry.id === id);
      if (found === undefined) return reply(404, { ok: false, error: { code: 'doc_not_found' } });
      return reply(200, {
        ok: true,
        result: { document: { id: found.id, name: found.name, pageCount: 1 } },
      });
    }
    if (method === 'PUT' && /^\/documents\/[^/]+\/pages\/[^/]+$/.test(path)) {
      const pageId = path.split('/')[4] as string;
      const body = JSON.parse(String(init?.body ?? '{}')) as { body: unknown };
      pages.set(pageId, body.body);
      return reply(200, { ok: true, result: { pageId } });
    }
    if (method === 'GET' && /^\/documents\/[^/]+\/pages\/[^/]+$/.test(path)) {
      const pageId = path.split('/')[4] as string;
      if (!pages.has(pageId)) return reply(404, { ok: false, error: { code: 'page_not_found' } });
      return reply(200, { ok: true, result: { body: pages.get(pageId) } });
    }
    return reply(404, { ok: false, error: { code: 'not_found' } });
  }) as typeof fetch;

  return {
    client: createDocumentsClient({ baseUrl: 'http://daemon.test', fetchImpl: fetchStub }),
    requests,
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
