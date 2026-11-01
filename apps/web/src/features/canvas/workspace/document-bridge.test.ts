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
import {
  createDocument,
  createInstance,
  createPage,
  createRect,
  type DesignDocument,
  type ScenePage,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { createDocumentsClient, encodePageBody } from '../persistence/documents-client';
import { createDocumentBridge } from './document-bridge';
import { createEditorWorkspace, EMPTY_PRESET } from './workspace-session';

/** 内存假 daemon（只实现 documents-client 消费的路由；id = 文档名，与真 daemon 同规则）。 */
interface FakePage {
  name: string;
  body: unknown;
}

interface FakeDocument {
  name: string;
  /** manifest 页列表（插入顺序 = 页面顺序，与真 daemon 的 manifest 语义一致）。 */
  pages: Map<string, FakePage>;
}

interface FakeDaemon {
  fetchImpl: typeof fetch;
  documents: Map<string, FakeDocument>;
  /** 预置一份已落盘文档（页面正文按 encodePageBody 信封写入；页 id 连续 page-1..N）。 */
  seed(documentId: string, pages: ScenePage[]): void;
  /**
   * 预置一份任意形状的落盘文档（daemon 侧页 id / 页名 / 正文逐页显式给出）——
   * 模拟删页后页 id 跳号、外来内容等「manifest 页 id 与位置不同名」的真实 daemon 状态。
   */
  seedRaw(documentId: string, pages: Array<{ id: string; name: string; body: unknown }>): void;
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
      // 与真 daemon 同规则：新文档自带 page-1（正文 `{}` 空首页约定）
      documents.set(name, {
        name,
        pages: new Map([['page-1', { name: '页面 1', body: {} }]]),
      });
      return respond(201, apiSuccess({ document: { id: name, name, pageCount: 1 } }));
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
          // manifest 页列表（顺序 = 页面顺序）——保存/读取按此寻址
          pages: [...document.pages.entries()].map(([pageId, page]) => ({
            id: pageId,
            name: page.name,
          })),
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
        const page = document.pages.get(pageId);
        if (page === undefined) {
          return respond(404, apiFailure('not_found', '页面不存在'));
        }
        return respond(200, apiSuccess({ page: { id: pageId }, body: page.body }));
      }
      if (method === 'PUT') {
        if (!document.pages.has(pageId)) {
          // 与真 daemon 同规则：PUT 只覆盖 manifest 已有页，不给任意页 id 隐式建页
          return respond(404, apiFailure('not_found', '页面不存在'));
        }
        document.pages.set(pageId, {
          name: document.pages.get(pageId)?.name ?? '',
          body: body.body,
        });
        return respond(200, apiSuccess({ page: { id: pageId } }));
      }
      if (method === 'DELETE') {
        if (!document.pages.has(pageId)) {
          return respond(404, apiFailure('not_found', '页面不存在'));
        }
        if (document.pages.size <= 1) {
          return respond(409, apiFailure('doc_last_page', '不允许删除最后一页（页面常驻 ≥1）'));
        }
        document.pages.delete(pageId);
        return respond(200, apiSuccess({ documentId: id, pageId, deleted: true }));
      }
    }
    const pageCreateMatch = /^\/documents\/([^/]+)\/pages$/.exec(path);
    if (method === 'POST' && pageCreateMatch !== null) {
      const id = decodeURIComponent(pageCreateMatch[1] as string);
      const document = documents.get(id);
      if (document === undefined) return respond(404, apiFailure('doc_not_found', '文档不存在'));
      // 与真 daemon 同规则：页 id 递增分配（page-N），跳过已占用编号
      let counter = document.pages.size + 1;
      while (document.pages.has(`page-${String(counter)}`)) counter += 1;
      const pageId = `page-${String(counter)}`;
      document.pages.set(pageId, { name: String(body.name ?? ''), body: {} });
      return respond(201, apiSuccess({ page: { id: pageId, name: String(body.name ?? '') } }));
    }
    return respond(404, apiFailure('not_found', `未实现的路由：${method} ${path}`));
  };

  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    documents,
    seed(documentId, pages) {
      const target: FakeDocument = { name: documentId, pages: new Map() };
      const envelope = createDocument({ id: documentId, name: documentId, pages });
      pages.forEach((page, index) => {
        const pageId = `page-${String(index + 1)}`;
        target.pages.set(pageId, { name: page.name, body: encodePageBody(envelope, page) });
      });
      documents.set(documentId, target);
    },
    seedRaw(documentId, pages) {
      const target: FakeDocument = { name: documentId, pages: new Map() };
      for (const page of pages) {
        target.pages.set(page.id, { name: page.name, body: page.body });
      }
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

/** 单页 → 画布信封正文（seedRaw 用：模拟 daemon 里已被写过的页正文）。 */
function pageEnvelope(page: ScenePage): unknown {
  const envelope = createDocument({ id: 'doc_seed', name: 'doc_seed', pages: [page] });
  return encodePageBody(envelope, page);
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

  it('打开新建（daemon 尚无设计内容，正文为空对象）的文档：给空画布可编辑，不是错误态', async () => {
    const daemon = createFakeDaemon();
    // 首页「新建设计文件」在 daemon 侧留下的就是这种文档：页面正文 `{}`（opaque 空 JSON）
    daemon.documents.set('刚建的文件', {
      name: '刚建的文件',
      pages: new Map([['page-1', { name: '页面 1', body: {} }]]),
    });
    const workspace = makeWorkspace(daemon);

    const result = await workspace.documents.load('刚建的文件');
    expect(result.ok).toBe(true);
    expect(workspace.canvas.document().name).toBe('刚建的文件');
    expect(workspace.canvas.page().nodes).toEqual({});
    expect(workspace.documents.store.getState()).toMatchObject({
      documentId: '刚建的文件',
      status: 'saved',
    });

    // 画一笔再保存：写回**同一个**文档（不是另建一份），正文换成画布信封
    const rectId = workspace.canvas.createRect({ x: 10, y: 10, width: 40, height: 30 });
    expect((await workspace.documents.save()).ok).toBe(true);
    expect(daemon.documents.size).toBe(1);
    const stored = [...(daemon.documents.get('刚建的文件')?.pages.values() ?? [])][0]?.body as {
      $format?: string;
      page: { nodes: Record<string, unknown> };
    };
    expect(stored.$format).toBe('dforge.canvas.page');
    expect(stored.page.nodes[rectId]).toBeDefined();
  });

  it('读取由 daemon 页列表驱动：页 id 跳号（删过页）也完整读回，顺序与 manifest 一致', async () => {
    const daemon = createFakeDaemon();
    // daemon 侧删过页：manifest 页 id 跳号（page-2..4 已不存在）——按位置猜 page-{N} 会漏读
    daemon.seedRaw('跳号文档', [
      {
        id: 'page-1',
        name: '第一页',
        body: pageEnvelope(createPage({ id: 'page-a', name: '第一页' })),
      },
      {
        id: 'page-5',
        name: '第三页',
        body: pageEnvelope(createPage({ id: 'page-c', name: '第三页' })),
      },
    ]);
    const workspace = makeWorkspace(daemon);

    const result = await workspace.documents.load('跳号文档');
    expect(result.ok).toBe(true);
    const pages = workspace.canvas.document().pages;
    expect(pages.map((page) => page.name)).toEqual(['第一页', '第三页']);
    expect(pages.map((page) => page.id)).toEqual(['page-a', 'page-c']);
  });

  it('空首页约定以 daemon 汇报为准：首 页 id/名取 manifest（不假设 page-1），保存不另建页', async () => {
    const daemon = createFakeDaemon();
    // 新建后 daemon 侧经历过删页重建：空首页的页 id 已不是 page-1
    daemon.seedRaw('重建的文件', [{ id: 'page-7', name: '首页', body: {} }]);
    const workspace = makeWorkspace(daemon);

    const result = await workspace.documents.load('重建的文件');
    expect(result.ok).toBe(true);
    expect(workspace.canvas.page().id).toBe('page-7');
    expect(workspace.canvas.page().name).toBe('首页');

    // 画一笔再保存：写回 daemon 汇报的那一页（不另建），页数仍为 1
    workspace.canvas.createRect({ x: 1, y: 1, width: 8, height: 8 });
    expect((await workspace.documents.save()).ok).toBe(true);
    const doc = daemon.documents.get('重建的文件');
    expect(doc?.pages.size).toBe(1);
    expect([...(doc?.pages.keys() ?? [])][0]).toBe('page-7');
  });

  it('外来/损坏正文不静默吞掉：任一页解不开即整文档报结构非法', async () => {
    const daemon = createFakeDaemon();
    daemon.seedRaw('混入外来内容', [
      { id: 'page-1', name: '页面 1', body: pageEnvelope(pageWithRect('page-a', 'n_a')) },
      { id: 'page-2', name: '外来页', body: { someForeign: 'data' } },
    ]);
    const workspace = makeWorkspace(daemon);

    const result = await workspace.documents.load('混入外来内容');
    // 旧实现在首个解不开的页处静默截断（返回前 1 页、谎报成功）
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('结构非法');
  });
});

describe('保存（⌘S / 顶栏按钮）', () => {
  it('新装配的未落盘文档：保存态是「未保存」（不谎报已保存）', () => {
    const daemon = createFakeDaemon();
    const workspace = makeWorkspace(daemon);
    expect(workspace.documents.store.getState()).toMatchObject({
      documentId: null,
      status: 'dirty',
    });
  });

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
    const firstBody = bodies[0]?.body as { page: { nodes: Record<string, unknown> } };
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

  it('缩页保存：daemon 侧多余页被清理（删除中间页后不留孤儿页，页数不再无界增长）', async () => {
    const daemon = createFakeDaemon();
    const workspace = makeWorkspace(daemon);
    // 三页各有可辨识页名（页面名随信封正文落 daemon，是位置映射的可读证据）
    workspace.panels.stack.dispatch({
      type: 'page.add',
      page: createPage({ id: 'page-two', name: '第二页' }),
    });
    workspace.panels.stack.dispatch({
      type: 'page.add',
      page: createPage({ id: 'page-three', name: '第三页' }),
    });
    expect((await workspace.documents.save()).ok).toBe(true);
    expect(daemon.documents.get('未命名文件')?.pages.size).toBe(3);

    // 真实用户路径：页面面板删除页 = page.remove 命令 → 缩页保存
    workspace.panels.stack.dispatch({ type: 'page.remove', pageId: 'page-two' });
    expect((await workspace.documents.save()).ok).toBe(true);

    const doc = daemon.documents.get('未命名文件');
    expect(doc?.pages.size).toBe(2);
    const pageBodies = [...(doc?.pages.values() ?? [])].map(
      (page) => page.body as { page: { name: string } },
    );
    // 内容按序对应：第 1 页=装配首 页（引擎缺省名）、第 2 页=第三页
    // （旧实现按位置猜 page-{N}：把第三页写进 page-2、第二页留成孤儿页复活）
    expect(pageBodies[0]?.page.name).toBe('页面 1');
    expect(pageBodies[1]?.page.name).toBe('第三页');
    expect(pageBodies.some((body) => body.page.name === '第二页')).toBe(false);

    // 幂等：再次保存页数不反弹
    expect((await workspace.documents.save()).ok).toBe(true);
    expect(doc?.pages.size).toBe(2);

    // 重开：页数一致、顺序不错位（旧实现把孤儿页读回复活、内容错位一页）
    const reopened = makeWorkspace(daemon);
    expect((await reopened.documents.load('未命名文件')).ok).toBe(true);
    const reopenedPages = reopened.canvas.document().pages;
    expect(reopenedPages.map((page) => page.name)).toEqual(['页面 1', '第三页']);
    expect(reopenedPages.length).toBe(2);
  });

  it('同名两会话保存互不覆盖：daemon 同名文档已含内容 → 保存报冲突，原内容原样', async () => {
    const daemon = createFakeDaemon();
    // 会话 A：画一笔并落盘「未命名文件」（初始名两会话相同——这正是缺陷现场）
    const sessionA = makeWorkspace(daemon);
    const rectA = sessionA.canvas.createRect({ x: 10, y: 10, width: 30, height: 30 });
    expect((await sessionA.documents.save()).ok).toBe(true);

    // 会话 B：全新会话（同样叫「未命名文件」），画了不同的内容再保存
    const sessionB = makeWorkspace(daemon);
    const rectB = sessionB.canvas.createRect({ x: 50, y: 50, width: 20, height: 20 });
    const saved = await sessionB.documents.save();

    // 旧实现按名命中即复用 id：B 的内容静默写进 A 的文档（数据丢失）
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.error).toContain('已包含设计内容');
    expect(sessionB.documents.store.getState().status).toBe('error');
    // B 未抢占落盘身份（不能让下一次保存悄悄写到 A 的文档里）
    expect(sessionB.documents.store.getState().documentId).toBeNull();

    // A 的文档原样：仍是 A 画的矩形，B 的矩形没有写进去，也没有多出第二份同名文档
    expect(daemon.documents.size).toBe(1);
    const bodies = [...(daemon.documents.get('未命名文件')?.pages.values() ?? [])];
    const body = bodies[0]?.body as { page: { nodes: Record<string, unknown> } };
    expect(body.page.nodes[rectA]).toBeDefined();
    expect(body.page.nodes[rectB]).toBeUndefined();
  });

  it('空首页约定保持：daemon 同名文档正文为空（唯一页 `{}`）→ 按名复用，不产生第二份', async () => {
    const daemon = createFakeDaemon();
    // 首页「新建设计文件」留下的空文档（manifest 一页、正文 `{}`）
    daemon.seedRaw('未命名文件', [{ id: 'page-1', name: '页面 1', body: {} }]);
    const workspace = makeWorkspace(daemon);
    workspace.canvas.createRect({ x: 10, y: 10, width: 30, height: 30 });

    const saved = await workspace.documents.save();
    expect(saved.ok).toBe(true);
    expect(saved.documentId).toBe('未命名文件');
    expect(daemon.documents.size).toBe(1);
    const bodies = [...(daemon.documents.get('未命名文件')?.pages.values() ?? [])];
    const body = bodies[0]?.body as { page: { nodes: Record<string, unknown> } };
    expect(Object.keys(body.page.nodes).length).toBe(1);
  });

  it('>64 页完整往返：70 页保存 → 重开页数/顺序/内容一致（旧实现硬编码 64 页截断）', async () => {
    const daemon = createFakeDaemon();
    const workspace = makeWorkspace(daemon);
    workspace.canvas.createRect({ x: 10, y: 10, width: 30, height: 30 }); // 首页一个节点
    for (let index = 2; index <= 70; index += 1) {
      workspace.panels.stack.dispatch({
        type: 'page.add',
        page: createPage({ id: `page-p${String(index)}`, name: `第 ${String(index)} 页` }),
      });
    }

    expect((await workspace.documents.save()).ok).toBe(true);
    expect(daemon.documents.get('未命名文件')?.pages.size).toBe(70);

    // 新会话重开：页数、顺序（页名）、首页内容完整（旧实现在第 64 页处静默截断）
    const reopened = makeWorkspace(daemon);
    expect((await reopened.documents.load('未命名文件')).ok).toBe(true);
    const pages = reopened.canvas.document().pages;
    expect(pages.length).toBe(70);
    expect(pages[0]?.name).toBe('页面 1');
    expect(pages[63]?.name).toBe('第 64 页');
    expect(pages[64]?.name).toBe('第 65 页'); // 旧实现的截断线之后
    expect(pages[69]?.name).toBe('第 70 页');
    expect(Object.keys(pages[0]?.nodes ?? {}).length).toBe(1);
    // 载入后当前页落在第一页
    expect(reopened.canvas.page().id).toBe(pages[0]?.id);
  });
});

describe('保存前结构校验（票 17 · blocker 2：写不校验、读全校验 = 一次写坏永久锁定）', () => {
  it('画布状态含悬空实例引用 → save 被拒、错误态可读、盘上正文分毫未动；修好后能正常保存', async () => {
    const daemon = createFakeDaemon();
    daemon.seed('待检文档', [pageWithRect('page-seed', 'n_ok')]);
    const workspace = makeWorkspace(daemon);
    expect((await workspace.documents.load('待检文档')).ok).toBe(true);

    // 命令层不阻止构造悬空引用（引擎只在校验层打回）：插入指向不存在主组件的实例
    const dangling = createInstance({ id: 'i_ghost', componentId: 'ghost' });
    workspace.panels.stack.dispatch({
      type: 'node.insert',
      pageId: 'page-seed',
      node: dangling,
      parentId: null,
    });

    const bodyBefore = structuredClone(daemon.documents.get('待检文档')?.pages.get('page-1')?.body);

    const failed = await workspace.documents.save();
    expect(failed.ok).toBe(false);
    expect(workspace.documents.store.getState().status).toBe('error');
    expect(workspace.documents.store.getState().error).toContain('missing-component');
    // 拒在写盘之前：daemon 的页正文仍是载入时那份（不含 i_ghost）
    expect(daemon.documents.get('待检文档')?.pages.get('page-1')?.body).toEqual(bodyBefore);

    // 移除悬空实例 → 结构合法 → 保存成功，正文落到 daemon
    workspace.panels.stack.dispatch({
      type: 'node.remove',
      pageId: 'page-seed',
      nodeId: 'i_ghost',
    });
    const ok = await workspace.documents.save();
    expect(ok.ok).toBe(true);
    expect(workspace.documents.store.getState().status).toBe('saved');
    const savedBody = daemon.documents.get('待检文档')?.pages.get('page-1')?.body as {
      page: { nodes: Record<string, unknown> };
    };
    expect(savedBody.page.nodes.n_ok).toBeDefined();
    expect(savedBody.page.nodes.i_ghost).toBeUndefined();
  });

  it('载入后原样保存（无悬空引用）不被校验误伤：正常写回', async () => {
    const daemon = createFakeDaemon();
    daemon.seed('合法文档', [pageWithRect('page-seed', 'n_ok')]);
    const workspace = makeWorkspace(daemon);
    expect((await workspace.documents.load('合法文档')).ok).toBe(true);
    expect((await workspace.documents.save()).ok).toBe(true);
    expect(workspace.documents.store.getState().status).toBe('saved');
  });
});

describe('地址栏同步的参数名（宿主契约：编辑器 `?documentId=` / `_canvas` `?doc=`）', () => {
  /** 造一个最小宿主（文档真值 + 变更广播），直接驱动桥。 */
  function makeBridge(client: ReturnType<typeof createDocumentsClient>, param?: string) {
    let current = createDocument({
      id: 'doc_local',
      name: '本地稿',
      pages: [createPage({ id: 'page_local' })],
    });
    const listeners = new Set<() => void>();
    const bridge = createDocumentBridge({
      host: {
        document: () => current,
        adopt: (next) => {
          if (next.pages.length === 0) return false;
          current = next;
          for (const listener of [...listeners]) listener();
          return true;
        },
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
      client,
      initial: { documentId: null, name: current.name },
      ...(param === undefined ? {} : { syncUrlParam: param }),
    });
    return bridge;
  }

  it('缺省写 `?documentId=`（编辑器契约）且保留其余参数；`syncUrlParam` 可改参数名（`_canvas` 的 `?doc=`）', async () => {
    // 两个宿主各用独立 daemon：本用例只锁地址栏参数契约；同名互不覆盖的保存语义
    // 由「保存」组专门回归（这里若共用 daemon，第二宿主会正确地撞上同名冲突）
    const editorDaemon = createFakeDaemon();
    const editorClient = createDocumentsClient({
      baseUrl: 'http://daemon.test',
      fetchImpl: editorDaemon.fetchImpl,
    });

    window.history.replaceState(null, '', '/editor?daemon=http%3A%2F%2Flocalhost%3A4318');
    const bridge = makeBridge(editorClient);
    expect((await bridge.save()).ok).toBe(true);
    const url = new URL(window.location.href);
    expect(url.searchParams.get('documentId')).toBe('本地稿');
    // 其余查询参数（端点续写）不被地址栏同步冲掉
    expect(url.searchParams.get('daemon')).toBe('http://localhost:4318');
    bridge.dispose();

    const studioDaemon = createFakeDaemon();
    const studioClient = createDocumentsClient({
      baseUrl: 'http://daemon.test',
      fetchImpl: studioDaemon.fetchImpl,
    });
    window.history.replaceState(null, '', '/_canvas');
    const studioBridge = makeBridge(studioClient, 'doc');
    expect((await studioBridge.save()).ok).toBe(true);
    const studioUrl = new URL(window.location.href);
    expect(studioUrl.searchParams.get('doc')).toBe('本地稿');
    expect(studioUrl.searchParams.has('documentId')).toBe(false);
    studioBridge.dispose();
  });
});

describe('本地替换（导入 IR：清落盘身份，不写回上一份文档）', () => {
  it('adoptLocal 后：documentId 归 null、回「未保存」；再保存按名新建而不是覆盖上一份', async () => {
    const daemon = createFakeDaemon();
    daemon.seed('原文档', [pageWithRect('page-original', 'n_original')]);
    const workspace = makeWorkspace(daemon);
    expect((await workspace.documents.load('原文档')).ok).toBe(true);
    expect(workspace.documents.store.getState().documentId).toBe('原文档');

    // 导入另一份内容（本地替换：与载入的语义区别——不继承上一份的落盘身份）
    const imported = createDocument({
      id: 'doc_imported',
      name: '导入稿',
      pages: [pageWithRect('page-imported', 'n_imported')],
    });
    expect(workspace.documents.adoptLocal(imported)).toBe(true);
    expect(workspace.documents.store.getState()).toMatchObject({
      documentId: null,
      name: '导入稿',
      status: 'dirty',
    });

    // 再保存：按名落成**新**文档，原文档的正文不被改动
    const saved = await workspace.documents.save();
    expect(saved.ok).toBe(true);
    expect(saved.documentId).toBe('导入稿');
    expect(daemon.documents.size).toBe(2);
    const originalBody = [...(daemon.documents.get('原文档')?.pages.values() ?? [])][0]?.body as {
      page: { nodes: Record<string, unknown> };
    };
    expect(originalBody.page.nodes.n_original).toBeDefined();
    expect(originalBody.page.nodes.n_imported).toBeUndefined();
  });

  it('adoptLocal：无可用页面（0 页）→ 不采纳，会话与文档态保持原样', async () => {
    const daemon = createFakeDaemon();
    const workspace = makeWorkspace(daemon);
    const before = workspace.canvas.document();

    // 引擎造不出 0 页文档（`createDocument` 有硬校验），这里用宽容形状直接构造防御路径
    const empty = { id: 'doc_empty', name: '空稿', pages: [] } as unknown as DesignDocument;
    expect(workspace.documents.adoptLocal(empty)).toBe(false);
    expect(workspace.canvas.document()).toBe(before);
    expect(workspace.documents.store.getState().name).toBe('未命名文件');
  });
});
