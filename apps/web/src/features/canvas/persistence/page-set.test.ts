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
  pageIdOf,
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
      // 与 daemon 同口径（arch-fix3）：占用判定按大小写归一，
      // 显式 id 已被占用（含 PAGE-1/page-1 变体）→ 409（计划不应发出这种 create）
      const occupied = [...pages.keys()].some(
        (existing) => existing.toLowerCase() === pageId.toLowerCase(),
      );
      if (occupied) return { ok: false, error: 'doc_exists' };
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

  it('旧文档兼容（audit-d01 · D-01）：manifest=[page-1 空占位, page_1 有内容] → 当前页=内容页，占位页沉底不丢', async () => {
    const document = createDocument({ id: 'doc-1', pages: [createPage({ id: 'p' })] });
    const fake = fakeClient({
      pages: [
        // 历史构建把夹具页落成 page_1，daemon 的占位页 page-1 留成空体且排在前列
        { meta: meta('page-1', '页面 1'), body: {} },
        { meta: meta('page_1', '页面 1'), body: body(document, rectPage('page_1', 'n_1')) },
      ],
    });

    const loaded = await loadPageSet(fake.client, 'doc-1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // 空占位页不排前：当前页（会话初始页 = pages[0]）必须是真实内容页
    expect(loaded.value.pages.map((entry) => entry.pageId)).toEqual(['page_1', 'page-1']);
    expect(loaded.value.pages[0]?.page.nodes.n_1?.type).toBe('rect');
    // 占位页仍在页集里（不静默删数据）
    expect(loaded.value.pages[1]?.pageId).toBe('page-1');
    expect(loaded.value.pages[1]?.page.nodes).toEqual({});
  });

  it('兼容不误伤：manifest=[page-1 有内容] 单页 → 顺序与内容照旧', async () => {
    const document = createDocument({ id: 'doc-1', pages: [createPage({ id: 'p' })] });
    const fake = fakeClient({
      pages: [{ meta: meta('page-1'), body: body(document, rectPage('page-1', 'n_1')) }],
    });

    const loaded = await loadPageSet(fake.client, 'doc-1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.pages.map((entry) => entry.pageId)).toEqual(['page-1']);
    expect(loaded.value.pages[0]?.page.nodes.n_1?.type).toBe('rect');
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

  it('新页沿用自身合法 id（身份可往返）；非法/重复 id 优先复用孤儿、用尽才分配新号', () => {
    const document = createDocument({
      id: 'doc-1',
      pages: [rectPage('page_1', 'n_a'), rectPage('bad id', 'n_b'), rectPage('page_1', 'n_c')],
    });
    const plan = planPageSetSave(document, ['page-1']);
    // page_1 是合法自身 id → 建成新页；'bad id' 复用孤儿 page-1（update，不新开页）；
    // 重复的 page_1 无处复用 → 分配 page-2。
    expect(plan.update.map((entry) => entry.pageId)).toEqual(['page-1']);
    expect(plan.create.map((entry) => entry.pageId)).toEqual(['page_1', 'page-2']);
    expect(plan.orphanPageIds).toEqual([]);
    const reused = plan.update[0]?.body.page as { nodes: Record<string, unknown> };
    expect(reused.nodes.n_b).toBeDefined();
  });

  it('反例（Spec P1）：非法 id 页不抢占后续页的合法 preferred——计划内页 id 唯一', () => {
    // existing={page-1,page-2}、文档页=[非法 id 页, page-1, page-2, page-3]
    // 修复前：第 1 页补位分到 page-3，第 4 页 preferred=page-3 直接采用 → 计划两个 create 同 id。
    const document = createDocument({
      id: 'doc-1',
      pages: [
        rectPage('第 1 页', 'n_a'),
        rectPage('page-1', 'n_1'),
        rectPage('page-2', 'n_2'),
        rectPage('page-3', 'n_3'),
      ],
    });
    const plan = planPageSetSave(document, ['page-1', 'page-2']);
    const plannedIds = [...plan.create, ...plan.update].map((entry) => entry.pageId);

    expect(new Set(plannedIds).size).toBe(plannedIds.length);
    // 合法自身 id 优先：page-1/page-2 就地更新，page-3 按身份新建；
    // 非法 id 页改派到首个真正空闲号 page-4（不抢占 page-3）。
    expect(plan.update.map((entry) => entry.pageId)).toEqual(['page-1', 'page-2']);
    expect(plan.create.map((entry) => entry.pageId)).toEqual(['page-4', 'page-3']);
    expect(plan.orphanPageIds).toEqual([]);
  });

  it('两个页带相同 preferred id（精确重复）：计划无重复，后者改派空闲号', () => {
    const document = createDocument({
      id: 'doc-1',
      pages: [rectPage('page-1', 'n_a'), rectPage('page-1', 'n_b')],
    });
    const plan = planPageSetSave(document, []);
    expect(plan.create.map((entry) => entry.pageId)).toEqual(['page-1', 'page-2']);
    expect(plan.update).toEqual([]);
  });

  it('两个页带同一 preferred id（大小写变体）：计划无重复，后者改派（daemon 归一口径）', () => {
    const document = createDocument({
      id: 'doc-1',
      pages: [rectPage('page-1', 'n_a'), rectPage('PAGE-1', 'n_b')],
    });
    const plan = planPageSetSave(document, []);
    expect(plan.create.map((entry) => entry.pageId)).toEqual(['page-1', 'page-2']);
    const folded = plan.create.map((entry) => entry.pageId.toLowerCase());
    expect(new Set(folded).size).toBe(folded.length);
  });

  it('大小写变体命中既有页：按既有页真实 id 写回，不新建重复页文件', () => {
    const document = createDocument({
      id: 'doc-1',
      pages: [rectPage('PAGE-1', 'n_a')],
    });
    const plan = planPageSetSave(document, ['page-1']);
    expect(plan.create).toEqual([]);
    expect(plan.update.map((entry) => entry.pageId)).toEqual(['page-1']);
    expect(plan.orphanPageIds).toEqual([]);
  });

  it('pageIdOf：未保存的页返回 null；计划分配后返回落盘 id，且不回写 page.id', () => {
    const page = rectPage('第 1 页', 'n_a');
    expect(pageIdOf(page)).toBeNull();

    const plan = planPageSetSave(createDocument({ id: 'doc-1', pages: [page] }), ['page-1']);
    expect(pageIdOf(page)).toBe('page-1');
    expect(plan.update[0]?.pageId).toBe('page-1');
    // 会话映射只服务 daemon 寻址，不改文档真值（否则会产生历史条目）
    expect(page.id).toBe('第 1 页');
  });
});

type Fake = ReturnType<typeof fakeClient>;

/** 把一次保存计划应用到内存页文件集合（与 saveDesignDocument 同序：先 update 再 create）。 */
async function applyPlan(fake: Fake, plan: PageSetSavePlan): Promise<void> {
  for (const entry of plan.update) {
    const saved = await fake.client.savePage('doc-1', entry.pageId, entry.body);
    expect(saved.ok, saved.ok ? '' : saved.error).toBe(true);
  }
  for (const entry of plan.create) {
    const created = await fake.client.createPage('doc-1', entry.name, { id: entry.pageId });
    expect(created.ok, created.ok ? '' : created.error).toBe(true);
    const saved = await fake.client.savePage('doc-1', entry.pageId, entry.body);
    expect(saved.ok, saved.ok ? '' : saved.error).toBe(true);
  }
}

/** 当前页文件集合的 id（顺序 = manifest 顺序）。 */
async function pageIdsOf(fake: Fake): Promise<string[]> {
  const detail = await fake.client.getDocument('doc-1');
  if (!detail.ok) throw new Error(detail.error);
  return detail.value.pages.map((page) => page.id);
}

/** 计划里第 index 个文档页落到的页 id（update / create 二选一）。 */
function pageIdFor(plan: PageSetSavePlan, index: number): string {
  const entry =
    plan.update.find((candidate) => candidate.index === index) ??
    plan.create.find((candidate) => candidate.index === index);
  if (entry === undefined) throw new Error(`计划缺少第 ${String(index)} 页`);
  return entry.pageId;
}

describe('planPageSetSave · 非法 id 页重复保存幂等（评审发现 1）', () => {
  it('含 1 个非法 id 页的文档连续保存 3 次：页文件数恒定、孤儿不含刚写入页、重载页数不变', async () => {
    const document = createDocument({
      id: 'doc-1',
      pages: [rectPage('page-1', 'n_1', '第一页'), rectPage('第 1 页', 'n_2', '导入页')],
    });
    const fake = fakeClient({ pages: [{ meta: meta('page-1', '第一页'), body: {} }] });

    const counts: number[] = [];
    const orphans: string[][] = [];
    const assigned: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      const plan = planPageSetSave(document, await pageIdsOf(fake));
      await applyPlan(fake, plan);
      counts.push((await pageIdsOf(fake)).length);
      orphans.push(plan.orphanPageIds);
      assigned.push(pageIdFor(plan, 1));
    }

    expect(counts).toEqual([2, 2, 2]);
    // 第 2、3 次不得把刚写入的页当孤儿（否则下一次保存又新建页）
    expect(orphans[1]).not.toContain(assigned[1]);
    expect(orphans[2]).not.toContain(assigned[2]);
    expect(assigned).toEqual(['page-2', 'page-2', 'page-2']);

    const reloaded = await loadPageSet(fake.client, 'doc-1');
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.pages).toHaveLength(2);
    expect(reloaded.value.pages[1]?.page.nodes.n_2?.type).toBe('rect');
  });

  it('反例（Spec P1）：非法 id 页 + 后续页 preferred page-3——连续两次保存均成功、页文件不重复不增长', async () => {
    const document = createDocument({
      id: 'doc-1',
      pages: [
        rectPage('第 1 页', 'n_a'),
        rectPage('page-1', 'n_1'),
        rectPage('page-2', 'n_2'),
        rectPage('page-3', 'n_3'),
      ],
    });
    const fake = fakeClient({
      pages: [
        { meta: meta('page-1'), body: {} },
        { meta: meta('page-2'), body: {} },
      ],
    });

    // 第一轮：计划内若出现重复 page-3，applyPlan 的 create 会拿到 409 doc_exists（红）
    const first = planPageSetSave(document, await pageIdsOf(fake));
    await applyPlan(fake, first);
    const afterFirst = await pageIdsOf(fake);
    expect(afterFirst).toHaveLength(4);
    expect(new Set(afterFirst).size).toBe(4);

    // 第二轮：全部按身份 update，不建页、不增长（修复前第二次 create 仍撞号 → 整次保存失败）
    const second = planPageSetSave(document, afterFirst);
    expect(second.create).toEqual([]);
    expect(second.orphanPageIds).toEqual([]);
    await applyPlan(fake, second);
    expect((await pageIdsOf(fake)).length).toBe(4);
  });

  it('合法 id 文档重复保存 3 次：完全幂等（不建页、孤儿为空）', async () => {
    const document = createDocument({
      id: 'doc-1',
      pages: [rectPage('page-1', 'n_1'), rectPage('page-2', 'n_2')],
    });
    const fake = fakeClient({
      pages: [
        { meta: meta('page-1'), body: {} },
        { meta: meta('page-2'), body: {} },
      ],
    });

    for (let round = 0; round < 3; round += 1) {
      const plan = planPageSetSave(document, await pageIdsOf(fake));
      expect(plan.create).toEqual([]);
      expect(plan.orphanPageIds).toEqual([]);
      expect(plan.update.map((entry) => entry.pageId)).toEqual(['page-1', 'page-2']);
      await applyPlan(fake, plan);
      expect(await pageIdsOf(fake)).toEqual(['page-1', 'page-2']);
    }
    expect(fake.creates).toEqual([]);
  });

  it('多个非法 id 页：各自稳定、不互相抢占（重载后内容仍在各自分配页）', async () => {
    const document = createDocument({
      id: 'doc-1',
      pages: [rectPage('第 1 页', 'n_a'), rectPage('第 2 页', 'n_b')],
    });
    const fake = fakeClient({ pages: [{ meta: meta('page-1'), body: {} }] });

    const rounds: string[][] = [];
    for (let round = 0; round < 3; round += 1) {
      const plan = planPageSetSave(document, await pageIdsOf(fake));
      await applyPlan(fake, plan);
      rounds.push([pageIdFor(plan, 0), pageIdFor(plan, 1)]);
      expect(plan.orphanPageIds).toEqual([]);
    }
    // 首轮：第 1 页复用孤儿 page-1，第 2 页新建 page-2；之后各自稳定，不互换
    expect(rounds).toEqual([
      ['page-1', 'page-2'],
      ['page-1', 'page-2'],
      ['page-1', 'page-2'],
    ]);
    expect(new Set(rounds[0]).size).toBe(2);
    expect((await pageIdsOf(fake)).length).toBe(2);

    const reloaded = await loadPageSet(fake.client, 'doc-1');
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.pages.map((entry) => entry.pageId)).toEqual(['page-1', 'page-2']);
    expect(reloaded.value.pages[0]?.page.nodes.n_a?.type).toBe('rect');
    expect(reloaded.value.pages[1]?.page.nodes.n_b?.type).toBe('rect');
  });

  it('页面重排后同一页面对象仍写回原页 id（稳定映射，不按新顺序重新抢占）', async () => {
    const first = rectPage('第 1 页', 'n_a');
    const second = rectPage('第 2 页', 'n_b');
    const fake = fakeClient({ pages: [{ meta: meta('page-1'), body: {} }] });

    const initial = createDocument({ id: 'doc-1', pages: [first, second] });
    const firstPlan = planPageSetSave(initial, await pageIdsOf(fake));
    await applyPlan(fake, firstPlan);
    expect([pageIdFor(firstPlan, 0), pageIdFor(firstPlan, 1)]).toEqual(['page-1', 'page-2']);

    // 用户调整页序：新文档对象、同一批页面对象
    const reordered = createDocument({ id: 'doc-1', pages: [second, first] });
    const plan = planPageSetSave(reordered, await pageIdsOf(fake));
    expect([pageIdFor(plan, 0), pageIdFor(plan, 1)]).toEqual(['page-2', 'page-1']);
    expect(plan.create).toEqual([]);
    expect(plan.orphanPageIds).toEqual([]);
  });
});
