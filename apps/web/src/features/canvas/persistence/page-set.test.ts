/**
 * 页面集合 ⇄ 页文件集合的 mapping module（arch-01 · 候选 1）。
 *
 * 断言口径：**页 id 是身份，不是位置**。
 * - load 按 daemon manifest 的 `pages[]` 读取（页集有洞 `[page-1,page-3]` 不得截断）；
 * - load 后 `page.id` = daemon 页 id（正文里的旧 id 不再冒充身份）；
 * - save 按 `page.id` 定位（洞场景不覆盖 page-3、不新建 page-4）；
 * - manifest 里多出来的页只进 `orphanPageIds`（禁静默删除用户数据）。
 */

import type { DfgPageMeta, DocumentDetail } from '@dforge/contracts';
import { createDocument, createPage, createRect } from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import {
  encodePageBody,
  loadPageSet,
  type PageSetClient,
  type PageSetSavePlan,
  planPageSetSave,
} from './page-set';

interface FakePage {
  meta: DfgPageMeta;
  body: unknown;
}

/** 内存版页文件集合（只实现 mapping module 需要的四个操作）。 */
function fakeClient(init: { name?: string; pages: FakePage[] }): {
  client: PageSetClient;
  reads: string[];
  writes: Array<{ pageId: string; body: unknown }>;
  creates: Array<{ name: string; id?: string }>;
} {
  const name = init.name ?? '演示文档';
  const pages = new Map(init.pages.map((page) => [page.meta.id, page]));
  const reads: string[] = [];
  const writes: Array<{ pageId: string; body: unknown }> = [];
  const creates: Array<{ name: string; id?: string }> = [];
  let nextNumber = pages.size + 1;

  const detail = (): DocumentDetail => ({
    id: 'doc-1',
    name,
    directory: '/tmp/doc-1.dfg',
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
    pageCount: pages.size,
    sizeBytes: 0,
    pages: [...pages.values()].map((page) => page.meta),
  });

  const client: PageSetClient = {
    async getDocument() {
      return { ok: true, value: detail() };
    },
    async readPage(_documentId, pageId) {
      reads.push(pageId);
      const page = pages.get(pageId);
      if (page === undefined) return { ok: false, error: 'not_found' };
      return { ok: true, value: page.body };
    },
    async createPage(_documentId, pageName, options) {
      const pageId = options?.id ?? `page-${String(nextNumber)}`;
      nextNumber += 1;
      creates.push({ name: pageName, ...(options?.id === undefined ? {} : { id: options.id }) });
      pages.set(pageId, {
        meta: { id: pageId, name: pageName, updatedAt: '2026-11-04T00:00:00.000Z' },
        body: {},
      });
      return { ok: true, value: { id: pageId, name: pageName } };
    },
    async savePage(_documentId, pageId, body) {
      writes.push({ pageId, body });
      const page = pages.get(pageId);
      if (page === undefined) return { ok: false, error: 'not_found' };
      page.body = body;
      return { ok: true, value: undefined };
    },
  };

  return { client, reads, writes, creates };
}

function meta(id: string, name = id): DfgPageMeta {
  return { id, name, updatedAt: '2026-11-04T00:00:00.000Z' };
}

function rectPage(pageId: string, rectId: string, name?: string) {
  return createPage({
    id: pageId,
    ...(name === undefined ? {} : { name }),
    nodes: { [rectId]: createRect({ id: rectId, x: 1, y: 2, width: 3, height: 4 }) },
    rootIds: [rectId],
  });
}

function body(document: ReturnType<typeof createDocument>, page: ReturnType<typeof createPage>) {
  return encodePageBody(document, page);
}

describe('loadPageSet · 按 manifest 的 pages[] 读取', () => {
  it('页集有洞 [page-1, page-3]：两页都读回，page.id = daemon 页 id（不截断、不按下标补位）', async () => {
    const document = createDocument({ id: 'doc-1', pages: [createPage({ id: 'ignored' })] });
    const first = rectPage('stale-body-id', 'n_1', '画布第一页');
    const third = rectPage('page_3', 'n_3', '画布第三页');
    const fake = fakeClient({
      pages: [
        { meta: meta('page-1', '第一页'), body: body(document, first) },
        { meta: meta('page-3', '第三页'), body: body(document, third) },
      ],
    });

    const loaded = await loadPageSet(fake.client, 'doc-1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.pages.map((entry) => entry.pageId)).toEqual(['page-1', 'page-3']);
    expect(loaded.value.pages.map((entry) => entry.page.id)).toEqual(['page-1', 'page-3']);
    // 页名取正文真值（manifest 名可能因建页后改名而过期）；页 id 才是 manifest 身份
    expect(loaded.value.pages.map((entry) => entry.page.name)).toEqual([
      '画布第一页',
      '画布第三页',
    ]);
    expect(loaded.value.unresolvedPageIds).toEqual([]);
    // 只读 manifest 列出的两个 id（不试探 page-2 / page-4）
    expect(fake.reads).toEqual(['page-1', 'page-3']);
  });

  it('顺序页集 [page-1, page-2] 回归：顺序与内容不变', async () => {
    const document = createDocument({ id: 'doc-1', pages: [createPage({ id: 'p' })] });
    const fake = fakeClient({
      pages: [
        { meta: meta('page-1'), body: body(document, rectPage('x', 'n_a')) },
        { meta: meta('page-2'), body: body(document, rectPage('y', 'n_b')) },
      ],
    });

    const loaded = await loadPageSet(fake.client, 'doc-1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.pages.map((entry) => entry.pageId)).toEqual(['page-1', 'page-2']);
    expect(loaded.value.pages[0]?.page.nodes.n_a?.type).toBe('rect');
    expect(loaded.value.pages[1]?.page.nodes.n_b?.type).toBe('rect');
  });

  it('空文档（新建设计文件的 `{}` 正文）：一页空画布，id 沿用 daemon 页 id', async () => {
    const fake = fakeClient({ pages: [{ meta: meta('page-1', '页面 1'), body: {} }] });

    const loaded = await loadPageSet(fake.client, 'doc-1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.pages).toHaveLength(1);
    expect(loaded.value.pages[0]?.page.id).toBe('page-1');
    expect(loaded.value.pages[0]?.page.nodes).toEqual({});
  });

  it('非本格式的非空正文 → 结构错误（点名页 id，不静默吞掉别人的数据）', async () => {
    const fake = fakeClient({
      pages: [{ meta: meta('page-1'), body: { hello: 'world' } }],
    });

    const loaded = await loadPageSet(fake.client, 'doc-1');
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error).toContain('page-1');
    expect(loaded.error).toContain('格式');
  });

  it('manifest 列出但读不出的页 → 进 unresolvedPageIds（其余页仍返回）', async () => {
    const document = createDocument({ id: 'doc-1', pages: [createPage({ id: 'p' })] });
    const stored = fakeClient({
      pages: [{ meta: meta('page-1'), body: body(document, rectPage('x', 'n_1')) }],
    });
    // manifest 详情里有 page-2，但页文件集合里没有 → readPage 404
    const withGhost: PageSetClient = {
      ...stored.client,
      async getDocument() {
        return {
          ok: true,
          value: {
            id: 'doc-1',
            name: '演示文档',
            directory: '/tmp/doc-1.dfg',
            createdAt: '2026-11-04T00:00:00.000Z',
            updatedAt: '2026-11-04T00:00:00.000Z',
            pageCount: 2,
            sizeBytes: 0,
            pages: [meta('page-1'), meta('page-2')],
          },
        };
      },
    };

    const loaded = await loadPageSet(withGhost, 'doc-1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.pages.map((entry) => entry.pageId)).toEqual(['page-1']);
    expect(loaded.value.unresolvedPageIds).toEqual(['page-2']);
  });
});

describe('planPageSetSave · 按 id 定位、孤儿只报告', () => {
  it('洞文档 [page-1, page-3]：两页都按 id update，不 create、无孤儿', () => {
    const document = createDocument({
      id: 'doc-1',
      pages: [rectPage('page-1', 'n_1'), rectPage('page-3', 'n_3')],
    });
    const plan = planPageSetSave(document, ['page-1', 'page-3']);
    expect(plan.update.map((entry) => entry.pageId)).toEqual(['page-1', 'page-3']);
    expect(plan.create).toEqual([]);
    expect(plan.orphanPageIds).toEqual([]);
  });

  it('身份而非位置：文档页序与 id 集合相同的页按下标交换后，update 仍各自对号', () => {
    const document = createDocument({
      id: 'doc-1',
      // 文档顺序是 page-3 在前、page-1 在后；页文件集合顺序相反
      pages: [rectPage('page-3', 'n_3'), rectPage('page-1', 'n_1')],
    });
    const plan = planPageSetSave(document, ['page-1', 'page-3']);
    const entryFor = (pageId: string) => {
      const entry = plan.update.find((candidate) => candidate.pageId === pageId);
      if (entry === undefined) throw new Error(`缺少 ${pageId} 的 update 计划`);
      return entry;
    };
    expect((entryFor('page-3').body.page as { id: string }).id).toBe('page-3');
    expect(
      (entryFor('page-3').body.page as { nodes: Record<string, unknown> }).nodes.n_3,
    ).toBeDefined();
    expect(
      (entryFor('page-1').body.page as { nodes: Record<string, unknown> }).nodes.n_1,
    ).toBeDefined();
    expect(plan.create).toEqual([]);
  });

  it('孤儿页只进 orphanPageIds（不生成 delete/覆盖动作）', () => {
    const document = createDocument({
      id: 'doc-1',
      pages: [rectPage('page-1', 'n_1')],
    });
    const plan: PageSetSavePlan = planPageSetSave(document, ['page-1', 'page-3']);
    expect(plan.orphanPageIds).toEqual(['page-3']);
    expect(plan.update.map((entry) => entry.pageId)).toEqual(['page-1']);
    expect(plan.create).toEqual([]);
  });

  it('新页沿用自身合法 id（身份可往返）；非法/重复 id 才分配首个空闲 page-N', () => {
    const document = createDocument({
      id: 'doc-1',
      pages: [rectPage('page_1', 'n_a'), rectPage('bad id', 'n_b'), rectPage('page_1', 'n_c')],
    });
    const plan = planPageSetSave(document, ['page-1']);
    expect(plan.update).toEqual([]);
    expect(plan.create.map((entry) => entry.pageId)).toEqual(['page_1', 'page-2', 'page-3']);
    expect(plan.orphanPageIds).toEqual(['page-1']);
  });
});
