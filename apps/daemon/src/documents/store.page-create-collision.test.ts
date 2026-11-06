/**
 * @dforge/daemon · 建页 id 冲突防护（Security S1 · 拒绝覆盖既有页正文）。
 *
 * 缺陷形态（修前）：`createPage` 的「页 id 已占用」只比较 manifest 内字符串，
 * 随后无条件 `writeFileAtomic(pagePath, '{}\n')`——在大小写不敏感文件系统
 * （macOS/Windows）上请求 `PAGE-1` 与既有 `page-1` 指向同一文件，绕过 409 清空正文；
 * manifest 未登记但盘上残留的 `pages/<id>.json` 同样被清空（静默丢数据）。
 *
 * 断言↔缺陷形态对照（守护的意义）：
 * - 去掉写前 `lstat` 或大小写归一占用判定 → 用例 1/2 的「正文逐字节未变」红；
 * - 归一判定误伤（只要 manifest 有页就拒建任意新 id）→ 用例 3/4 红；
 * - 新建页语义被改动（正文初值/manifest 登记）→ 用例 3 红。
 *
 * 全部使用临时数据目录（workspace 隔离），不碰 `~/.dforge`。
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DF_ERROR_HTTP_STATUS } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';

import { createConfigStore } from '../config/store.ts';
import { createDocumentStore, type DocumentStore } from './store.ts';

interface DocContext {
  store: DocumentStore;
  documentId: string;
  /** `<workspaceDir>/<id>.dfg`（store 返回的已解析目录）。 */
  docDir: string;
}

/** 建临时 workspace + 一个文档（manifest 含 page-1），用例结束清理。 */
async function withDocument(run: (ctx: DocContext) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), 'df-s1-page-'));
  try {
    const config = createConfigStore({
      configJsonPath: join(tempDir, 'config.json'),
      defaultWorkspaceDir: join(tempDir, 'workspace'),
    });
    await config.load();
    const store = createDocumentStore({ config });
    const created = await store.create('页冲突防护');
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unreachable');
    await run({
      store,
      documentId: created.value.id,
      docDir: created.value.directory,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

const pagePathOf = (docDir: string, pageId: string): string =>
  join(docDir, 'pages', `${pageId}.json`);

describe('createPage 页 id 冲突防护（Security S1）', () => {
  it('大小写变体 id（PAGE-1 撞 page-1）→ 409 doc_exists，既有正文逐字节未变', async () => {
    await withDocument(async ({ store, documentId, docDir }) => {
      const body = { mark: 'case-collision-keep', nodes: [{ type: 'frame' }] };
      const saved = await store.savePage(documentId, 'page-1', body);
      expect(saved.ok).toBe(true);
      const target = pagePathOf(docDir, 'page-1');
      const before = await readFile(target, 'utf8');
      expect(before.trim().length).toBeGreaterThan(0);

      const created = await store.createPage(documentId, '大小写变体', { id: 'PAGE-1' });
      // 取证优先：正文逐字节未变（缺陷形态下先暴露的是「正文被清空」，而非仅状态码）
      const after = await readFile(target, 'utf8');
      expect(after).toBe(before);
      expect(JSON.parse(after)).toEqual(body);
      // 大小写归一后不得出现第二个页文件（大小写不敏感 FS 上即同一文件被覆盖）
      expect((await readdir(join(docDir, 'pages'))).sort()).toEqual(['page-1.json']);

      expect(created.ok).toBe(false);
      if (created.ok) throw new Error('unreachable');
      expect(created.code).toBe('doc_exists');
      expect(DF_ERROR_HTTP_STATUS[created.code]).toBe(409);
      // details 指明冲突的既有 id
      expect(created.details?.conflictId).toBe('page-1');

      // 读侧仍返回原文；manifest 未混入大写变体
      const read = await store.readPage(documentId, 'page-1');
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.value.body).toEqual(body);
      const detail = await store.get(documentId);
      expect(detail.ok).toBe(true);
      if (detail.ok) {
        expect(detail.value.pages.map((page) => page.id)).toEqual(['page-1']);
      }
    });
  });

  it('盘上残留 pages/page-2.json（manifest 未登记）→ 409 doc_exists，文件内容未变', async () => {
    await withDocument(async ({ store, documentId, docDir }) => {
      const orphan = '{\n  "mark": "orphan-keep",\n  "nonEmpty": true\n}\n';
      const target = pagePathOf(docDir, 'page-2');
      await writeFile(target, orphan, 'utf8');

      const created = await store.createPage(documentId, '残留页', { id: 'page-2' });
      // 取证优先：残留正文逐字节未变（缺陷形态下先暴露的是「文件被清空」）
      expect(await readFile(target, 'utf8')).toBe(orphan);

      expect(created.ok).toBe(false);
      if (created.ok) throw new Error('unreachable');
      expect(created.code).toBe('doc_exists');
      expect(DF_ERROR_HTTP_STATUS[created.code]).toBe(409);
      expect(created.details?.conflictId).toBe('page-2');

      // manifest 未登记该页（提交点未被污染）
      const detail = await store.get(documentId);
      expect(detail.ok).toBe(true);
      if (detail.ok) expect(detail.value.pages.map((page) => page.id)).toEqual(['page-1']);
    });
  });

  it('正常新 id（page-9）→ 201 语义不变：建页成功、正文初值 {}\\n、manifest 登记', async () => {
    await withDocument(async ({ store, documentId, docDir }) => {
      const created = await store.createPage(documentId, '第九页', { id: 'page-9' });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error('unreachable');
      expect(created.value.page.id).toBe('page-9');
      expect(created.value.page.name).toBe('第九页');

      const target = pagePathOf(docDir, 'page-9');
      expect(await readFile(target, 'utf8')).toBe('{}\n');

      const detail = await store.get(documentId);
      expect(detail.ok).toBe(true);
      if (detail.ok) {
        expect(detail.value.pages.map((page) => page.id)).toEqual(['page-1', 'page-9']);
      }
      const read = await store.readPage(documentId, 'page-9');
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.value.body).toEqual({});
    });
  });

  it('大小写归一不误伤：manifest 有 page-1，请求 page-2 → 201 语义不变', async () => {
    await withDocument(async ({ store, documentId, docDir }) => {
      const created = await store.createPage(documentId, '第二页', { id: 'page-2' });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error('unreachable');
      expect(created.value.page.id).toBe('page-2');
      expect(await readFile(pagePathOf(docDir, 'page-2'), 'utf8')).toBe('{}\n');

      const detail = await store.get(documentId);
      expect(detail.ok).toBe(true);
      if (detail.ok) {
        expect(detail.value.pages.map((page) => page.id)).toEqual(['page-1', 'page-2']);
      }
    });
  });
});
