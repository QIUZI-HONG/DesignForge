// @vitest-environment jsdom
/**
 * 文档载入与保存（D-2 / UX-03）——`/editor` 的「本地真值」闭环回归缝。
 *
 * 缺陷现场：`/editor` 只装配内存「未命名设计文件」，不读 `?documentId=`、不落盘——
 * 从首页点开自己的文档得到空画布、刷新即丢、导出报 `doc_not_found`（验收 D-2）。
 *
 * 本测试用**与 daemon 路由表同形**的内存夹具（信封取 `@dforge/contracts` 的真构造函数，
 * 保证不手抄形状）锁住四条外部可观测行为：
 * 1. `load(id)` 把 daemon 里的文档替换进共享命令栈（节点、文档名、页面 id 全部就位）；
 * 2. 载入失败（文档不存在）→ 错误态可读，且**不破坏**当前会话里的文档；
 * 3. 保存：未落盘文档先按名幂等落盘（同名复用，不产生第二份），页面正文写进 daemon；
 * 4. 保存态迁移：编辑 → 未保存；保存中 → 保存中…；成功 → 已保存；失败 → 失败可重试。
 */
import { apiFailure, apiSuccess, type DfErrorCode } from '@dforge/contracts';
import { createDocument, createPage, createRect, type ScenePage } from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { createDocumentsClient, encodePageBody } from '../persistence/documents-client';
import { createEditorWorkspace, EMPTY_PRESET } from './workspace-session';

/** 内存假 daemon（只实现 documents-client 消费的路由；id = 文档名，与真 daemon 同规则）。 */
interface FakeDocument {
  name: string;
  pages: Map<string, unknown>;
  nextPageNumber: number;
}

interface FakeDaemon {
  fetchImpl: typeof fetch;
  documents: Map<string, FakeDocument>;
  /** 预置一份已落盘文档（页面正文按 encodePageBody 信封写入）。 */
  seed(documentId: string, pages: ScenePage[]): void;
  /** 让下一次请求失败（模拟 daemon 掉线/写盘失败）。 */
  failNext(status: number, code: DfErrorCode, message: string): void;
}

function createFakeDaemon(): FakeDaemon {
  const documents = new Map<string, FakeDocument>();
  let failure: { status: number; code: DfErrorCode; message: string } | null = null;

  const respond = (status: number, payload: unknown): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(payload),
    }) as unknown as Response;

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = new URL(String(input)).pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (failure !== null) {
      const { status, code, message } = failure;
      failure = null;
      return respond(status, apiFailure(code, message));
    }
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};

    if (method === 'GET' && path === '/documents') {
      return respond(
        200,
        apiSuccess({
          documents: [...documents.values()].map((item) => ({
            id: item.name,
            name: item.name,
            pageCount: item.pages.size,
          })),
        }),
      );
    }
    if (method === 'POST' && path === '/documents') {
      const name = String(body.name ?? '');
      if (documents.has(name)) return respond(409, apiFailure('doc_exists', '同名文档已存在'));
      documents.set(name, { name, pages: new Map(), nextPageNumber: 1 });
      return respond(201, apiSuccess({ document: { id: name, name, pageCount: 0 } }));
    }
    const documentMatch = /^\/documents\/([^/]+)$/.exec(path);
    if (method === 'GET' && documentMatch !== null) {
      const id = decodeURIComponent(documentMatch[1] as string);
      const document = documents.get(id);
      if (document === undefined) return respond(404, apiFailure('doc_not_found', '文档不存在'));
      return respond(
        200,
        apiSuccess({
          document: { id, name: document.name, pageCount: document.pages.size },
        }),
      );
    }
    const pageMatch = /^\/documents\/([^/]+)\/pages\/([^/]+)$/.exec(path);
    if (pageMatch !== null) {
      const id = decodeURIComponent(pageMatch[1] as string);
      const pageId = decodeURIComponent(pageMatch[2] as string);
      const document = documents.get(id);
      if (document === undefined) return respond(404, apiFailure('doc_not_found', '文档不存在'));
      if (method === 'GET') {
        if (!document.pages.has(pageId)) {
          return respond(404, apiFailure('not_found', '页面不存在'));
        }
        return respond(200, apiSuccess({ page: { id: pageId }, body: document.pages.get(pageId) }));
      }
      if (method === 'PUT') {
        if (!document.pages.has(pageId)) {
          return respond(404, apiFailure('not_found', '页面不存在'));
        }
        document.pages.set(pageId, body.body);
        return respond(200, apiSuccess({ page: { id: pageId } }));
      }
    }
    const pageCreateMatch = /^\/documents\/([^/]+)\/pages$/.exec(path);
    if (method === 'POST' && pageCreateMatch !== null) {
      const id = decodeURIComponent(pageCreateMatch[1] as string);
      const document = documents.get(id);
      if (document === undefined) return respond(404, apiFailure('doc_not_found', '文档不存在'));
      const pageId = `page-${String(document.nextPageNumber)}`;
      document.nextPageNumber += 1;
      document.pages.set(pageId, null);
      return respond(201, apiSuccess({ page: { id: pageId, name: String(body.name ?? '') } }));
    }
    return respond(404, apiFailure('not_found', `未实现的路由：${method} ${path}`));
  };

  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    documents,
    seed(documentId, pages) {
      const target: FakeDocument = { name: documentId, pages: new Map(), nextPageNumber: 1 };
      const envelope = createDocument({ id: documentId, name: documentId, pages });
      pages.forEach((page, index) => {
        const pageId = `page-${String(index + 1)}`;
        target.pages.set(pageId, encodePageBody(envelope, page));
        target.nextPageNumber = index + 2;
      });
      documents.set(documentId, target);
    },
    failNext(status, code, message) {
      failure = { status, code, message };
    },
  };
}

/** 一份含单个矩形的页面（载入断言用）。 */
function pageWithRect(pageId: string, rectId: string): ScenePage {
  const rect = createRect({ id: rectId, x: 40, y: 60, width: 120, height: 80 });
  return createPage({ id: pageId, name: '页面 1', rootIds: [rectId], nodes: { [rectId]: rect } });
}

/** 造一个注入了夹具 daemon 的工作区。 */
function makeWorkspace(daemon: FakeDaemon) {
  const client = createDocumentsClient({
    baseUrl: 'http://daemon.test',
    fetchImpl: daemon.fetchImpl,
  });
  return createEditorWorkspace(EMPTY_PRESET, { client });
}

describe('载入（?documentId= → daemon 文档）', () => {
  it('载入后：共享命令栈换成 daemon 文档，文档名/页面 id/节点内容全部就位', async () => {
    const daemon = createFakeDaemon();
    daemon.seed('验收演示稿', [pageWithRect('page-loaded', 'n_saved')]);
    const workspace = makeWorkspace(daemon);

    // 载入前：内存「未命名文件」（这正是缺陷现场用户看到的空画布）
    expect(workspace.canvas.document().pages[0]?.id).toBe('page-editor');

    const result = await workspace.documents.load('验收演示稿');
    expect(result.ok).toBe(true);

    const document = workspace.canvas.document();
    expect(document.name).toBe('验收演示稿');
    expect(workspace.canvas.page().id).toBe('page-loaded');
    expect(workspace.pageId).toBe('page-loaded');
    expect(workspace.canvas.page().nodes.n_saved?.type).toBe('rect');
    // 载入 = 与 daemon 同步：不是「未保存」，且选择集清空（旧选择的 id 可能已不存在）
    expect(workspace.canvas.store.getState().selection.ids).toEqual([]);
    expect(workspace.documents.store.getState()).toMatchObject({
      documentId: '验收演示稿',
      name: '验收演示稿',
      status: 'saved',
      error: null,
    });
  });

  it('载入失败：错误态可读，且当前会话文档不被破坏', async () => {
    const daemon = createFakeDaemon();
    const workspace = makeWorkspace(daemon);

    const result = await workspace.documents.load('不存在的文档');
    expect(result.ok).toBe(false);
    expect(workspace.documents.store.getState().status).toBe('error');
    expect(workspace.documents.store.getState().error).toContain('doc_not_found');
    // 文档真值保持原样（不能因为载入失败把用户当前内容清掉）
    expect(workspace.canvas.document().name).toBe('未命名文件');
    expect(workspace.canvas.page().id).toBe('page-editor');
  });
});

describe('保存（⌘S / 顶栏按钮）', () => {
  it('未落盘文档：按名幂等落盘（同名复用），页面正文写进 daemon，状态回「已保存」', async () => {
    const daemon = createFakeDaemon();
    const workspace = makeWorkspace(daemon);
    const rectId = workspace.canvas.createRect({ x: 10, y: 20, width: 30, height: 40 });

    // 新文档：编辑后状态是「未保存」
    expect(workspace.documents.store.getState().status).toBe('dirty');

    const first = await workspace.documents.save();
    expect(first.ok).toBe(true);
    expect(workspace.documents.store.getState()).toMatchObject({
      documentId: '未命名文件',
      status: 'saved',
    });
    expect(daemon.documents.has('未命名文件')).toBe(true);

    // 再保存一次：同名复用（不新建第二份文档），页面里的节点确实落到 daemon 侧
    const second = await workspace.documents.save();
    expect(second.ok).toBe(true);
    expect(daemon.documents.size).toBe(1);
    const bodies = [...(daemon.documents.get('未命名文件')?.pages.values() ?? [])];
    const firstBody = bodies[0] as { page: { nodes: Record<string, unknown> } };
    expect(firstBody.page.nodes[rectId]).toBeDefined();
    expect(workspace.documents.store.getState().status).toBe('saved');

    // 保存后再编辑 → 又回到「未保存」
    workspace.canvas.createRect({ x: 60, y: 60, width: 10, height: 10 });
    expect(workspace.documents.store.getState().status).toBe('dirty');
  });

  it('保存失败：状态为失败并带原因；重试成功', async () => {
    const daemon = createFakeDaemon();
    const workspace = makeWorkspace(daemon);
    workspace.canvas.createRect({ x: 10, y: 20, width: 30, height: 40 });

    daemon.failNext(500, 'internal', '磁盘写失败');
    const failed = await workspace.documents.save();
    expect(failed.ok).toBe(false);
    expect(workspace.documents.store.getState().status).toBe('error');
    expect(workspace.documents.store.getState().error).toContain('磁盘写失败');

    const retried = await workspace.documents.save();
    expect(retried.ok).toBe(true);
    expect(workspace.documents.store.getState().status).toBe('saved');
  });

  it('已载入的文档：保存写回同一文档 id（不新建）', async () => {
    const daemon = createFakeDaemon();
    daemon.seed('验收演示稿', [pageWithRect('page-loaded', 'n_saved')]);
    const workspace = makeWorkspace(daemon);

    expect((await workspace.documents.load('验收演示稿')).ok).toBe(true);
    workspace.canvas.createRect({ x: 5, y: 5, width: 20, height: 20 });

    const saved = await workspace.documents.save();
    expect(saved.ok).toBe(true);
    expect(saved.documentId).toBe('验收演示稿');
    expect(daemon.documents.size).toBe(1);
    expect(workspace.documents.store.getState().status).toBe('saved');
  });
});
