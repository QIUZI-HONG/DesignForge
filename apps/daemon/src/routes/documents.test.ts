import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isDfgManifest } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';
import type { TestDaemon } from '../testing/harness.ts';
import { createTestDaemon, injectJson } from '../testing/harness.ts';

/** 常用：建一个文档并返回 id（失败即测试失败）。 */
async function createDocument(daemon: TestDaemon, name = '演示文档'): Promise<string> {
  const created = await injectJson(daemon.app, {
    method: 'POST',
    url: '/documents',
    payload: { name },
  });
  expect(created.statusCode).toBe(201);
  return (created.payload as { result: { document: { id: string } } }).result.document.id;
}

describe('documents · 创建与目录态', () => {
  it('创建后落 .dfg 目录态：manifest.json 可校验 + 默认页面 + 原子写无残留临时文件', async () => {
    const daemon = await createTestDaemon();
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: '我的 设计' },
      });
      expect(statusCode).toBe(201);
      const document = (
        payload as { result: { document: { id: string; directory: string; pageCount: number } } }
      ).result.document;
      expect(document.id).toBe('我的-设计');
      expect(document.pageCount).toBe(1);

      const manifestRaw = await readFile(
        join(daemon.workspaceDir, '我的-设计.dfg', 'manifest.json'),
        'utf8',
      );
      const manifest = JSON.parse(manifestRaw) as unknown;
      expect(isDfgManifest(manifest)).toBe(true);

      const entries = await readdir(join(daemon.workspaceDir, '我的-设计.dfg'));
      expect(entries.sort()).toEqual(['manifest.json', 'pages']);
      // 目录名混入「我的 设计」不合法路径字符已在契约层拒绝，此处确保无 .tmp 残留
      const pageEntries = await readdir(join(daemon.workspaceDir, '我的-设计.dfg', 'pages'));
      expect(pageEntries).toEqual(['page-1.json']);
      expect(pageEntries.some((entry) => entry.endsWith('.tmp'))).toBe(false);
    } finally {
      await daemon.cleanup();
    }
  });

  it('同名冲突 → 409 doc_exists；非法名 → 400 doc_invalid_name', async () => {
    const daemon = await createTestDaemon();
    try {
      await createDocument(daemon, '唯一');
      const duplicate = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: '唯一' },
      });
      expect(duplicate.statusCode).toBe(409);
      expect((duplicate.payload as { error: { code: string } }).error.code).toBe('doc_exists');

      const invalid = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: 'a/b' },
      });
      expect(invalid.statusCode).toBe(400);
      expect((invalid.payload as { error: { code: string } }).error.code).toBe('doc_invalid_name');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('documents · 列表与读取', () => {
  it('列表含体积与页数；按 updatedAt 倒序', async () => {
    const daemon = await createTestDaemon();
    try {
      await createDocument(daemon, '甲');
      await createDocument(daemon, '乙');
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'GET',
        url: '/documents',
      });
      expect(statusCode).toBe(200);
      const result = (
        payload as {
          result: {
            documents: { id: string; sizeBytes: number; warnings?: unknown }[];
            warnings: unknown[];
          };
        }
      ).result;
      expect(result.documents.map((doc) => doc.id).sort()).toEqual(['乙', '甲']);
      for (const document of result.documents) {
        expect(document.sizeBytes).toBeGreaterThan(0);
      }
      expect(result.warnings).toEqual([]);
    } finally {
      await daemon.cleanup();
    }
  });

  it('不存在文档 → 404 doc_not_found', async () => {
    const daemon = await createTestDaemon();
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'GET',
        url: '/documents/missing',
      });
      expect(statusCode).toBe(404);
      expect((payload as { error: { code: string } }).error.code).toBe('doc_not_found');
    } finally {
      await daemon.cleanup();
    }
  });

  it('manifest 损坏的目录：列表跳过并给 warning（不整批失败）', async () => {
    const daemon = await createTestDaemon();
    try {
      await createDocument(daemon, '好文档');
      const brokenDir = join(daemon.workspaceDir, '坏文档.dfg');
      await (await import('node:fs/promises')).mkdir(brokenDir, { recursive: true });
      await (await import('node:fs/promises')).writeFile(
        join(brokenDir, 'manifest.json'),
        '{ 不是 JSON',
      );

      const { payload } = await injectJson(daemon.app, { method: 'GET', url: '/documents' });
      const result = (
        payload as {
          result: { documents: { id: string }[]; warnings: { id: string; code: string }[] };
        }
      ).result;
      expect(result.documents.map((doc) => doc.id)).toEqual(['好文档']);
      expect(result.warnings).toEqual([
        expect.objectContaining({ id: '坏文档', code: 'manifest_invalid' }),
      ]);
    } finally {
      await daemon.cleanup();
    }
  });

  it('重命名只改 manifest.name（id/目录不变）', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '原名');
      const renamed = await injectJson(daemon.app, {
        method: 'PATCH',
        url: `/documents/${encodeURIComponent(id)}`,
        payload: { name: '新名字' },
      });
      expect(renamed.statusCode).toBe(200);
      const document = (
        renamed.payload as { result: { document: { id: string; name: string; directory: string } } }
      ).result.document;
      expect(document.id).toBe(id);
      expect(document.name).toBe('新名字');
      expect(document.directory.endsWith(`${id}.dfg`)).toBe(true);
      expect((await stat(document.directory)).isDirectory()).toBe(true);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('documents · 页面读写（正文 opaque JSON）', () => {
  it('保存正文并回读（形状保真；manifest 版本自增）', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '正文往返');
      const body = {
        width: 1440,
        height: 900,
        children: [{ kind: 'rect', x: 10, y: 20, width: 100, height: 50, fill: '#FF0000' }],
      };
      const saved = await injectJson(daemon.app, {
        method: 'PUT',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
        payload: { body },
      });
      expect(saved.statusCode).toBe(200);

      const read = await injectJson(daemon.app, {
        method: 'GET',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
      });
      expect(read.statusCode).toBe(200);
      const result = (read.payload as { result: { body: unknown; page: { id: string } } }).result;
      expect(result.body).toEqual(body);
      expect(result.page.id).toBe('page-1');

      const manifest = JSON.parse(
        await readFile(join(daemon.workspaceDir, `${id}.dfg`, 'manifest.json'), 'utf8'),
      ) as { version: number };
      expect(manifest.version).toBe(2);
    } finally {
      await daemon.cleanup();
    }
  });

  it('缺 body 字段 → 400 doc_invalid_body；页面不存在 → 404 not_found', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '错误分支');
      const noBody = await injectJson(daemon.app, {
        method: 'PUT',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
        payload: { notBody: 1 },
      });
      expect(noBody.statusCode).toBe(400);
      expect((noBody.payload as { error: { code: string } }).error.code).toBe('doc_invalid_body');

      const missingPage = await injectJson(daemon.app, {
        method: 'GET',
        url: `/documents/${encodeURIComponent(id)}/pages/page-99`,
      });
      expect(missingPage.statusCode).toBe(404);
      expect((missingPage.payload as { error: { code: string } }).error.code).toBe('not_found');
    } finally {
      await daemon.cleanup();
    }
  });

  it('页面增删：新增 page-2；删最后一页拒绝（409 doc_last_page）', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '多页');
      const created = await injectJson(daemon.app, {
        method: 'POST',
        url: `/documents/${encodeURIComponent(id)}/pages`,
        payload: { name: '详情页' },
      });
      expect(created.statusCode).toBe(201);
      const page = (created.payload as { result: { page: { id: string; name: string } } }).result
        .page;
      expect(page.id).toBe('page-2');
      expect(page.name).toBe('详情页');

      const deleteFirst = await injectJson(daemon.app, {
        method: 'DELETE',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
      });
      expect(deleteFirst.statusCode).toBe(200);

      const deleteLast = await injectJson(daemon.app, {
        method: 'DELETE',
        url: `/documents/${encodeURIComponent(id)}/pages/page-2`,
      });
      expect(deleteLast.statusCode).toBe(409);
      expect((deleteLast.payload as { error: { code: string } }).error.code).toBe('doc_last_page');
    } finally {
      await daemon.cleanup();
    }
  });

  it('删除文档后其页面读取 404；重复删除 404', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '待删');
      const removed = await injectJson(daemon.app, {
        method: 'DELETE',
        url: `/documents/${encodeURIComponent(id)}`,
      });
      expect(removed.statusCode).toBe(200);
      expect((removed.payload as { result: { deleted: boolean } }).result.deleted).toBe(true);

      const again = await injectJson(daemon.app, {
        method: 'DELETE',
        url: `/documents/${encodeURIComponent(id)}`,
      });
      expect(again.statusCode).toBe(404);
    } finally {
      await daemon.cleanup();
    }
  });
});
