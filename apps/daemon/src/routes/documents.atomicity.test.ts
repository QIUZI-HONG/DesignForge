/**
 * @dforge/daemon · 文档提交的失败语义（票 19）。
 *
 * 钉死两条可观测后果：
 * - 「删除」必须能删掉自己创建过的目录——`create()` 中途失败留下的**无 manifest 空壳**
 *   今天既读不到（`doc_not_found`）也删不掉，名字从此被 `EEXIST` 永久占用；
 * - 「保存失败」必须等于「盘上没变」，或**如实说明盘上已变成什么样**（409 不许沉默）。
 *
 * 纪律：全部走临时数据目录（testing/harness.ts），不碰 `~/.dforge`。
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTestDaemon, injectJson } from '../testing/harness.ts';

/** 复现 `create()` 在 mkdir 之后失败留下的现场：目录 + 正文在，manifest 从未写出。 */
async function seedShellDocument(workspaceDir: string, id: string): Promise<void> {
  await mkdir(join(workspaceDir, `${id}.dfg`, 'pages'), { recursive: true });
  await writeFile(join(workspaceDir, `${id}.dfg`, 'pages', 'page-1.json'), '{}\n', 'utf8');
}

describe('documents · 无 manifest 空壳目录必须可回收', () => {
  it('DELETE 空壳 → 200 且目录消失（此前恒 doc_not_found，名字永久占用）', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedShellDocument(daemon.workspaceDir, '壳文档');

      // 空壳在列表里必须可见（否则用户无从知道名字被谁占着）
      const listed = await injectJson(daemon.app, { method: 'GET', url: '/documents' });
      expect(listed.statusCode, listed.raw).toBe(200);
      const list = (listed.payload as {
        result: { documents: unknown[]; warnings: { id: string; code: string }[] };
      }).result;
      expect(list.documents).toHaveLength(0);
      expect(list.warnings.map((warning) => warning.id)).toEqual(['壳文档']);
      expect(list.warnings[0]?.code).toBe('manifest_unreadable');

      const removed = await injectJson(daemon.app, {
        method: 'DELETE',
        url: '/documents/壳文档',
      });
      expect(removed.statusCode, removed.raw).toBe(200);
      expect(await readdir(daemon.workspaceDir)).toEqual([]);
    } finally {
      await daemon.cleanup();
    }
  });

  it('删掉空壳后同名文档可以重建（名字被释放）', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedShellDocument(daemon.workspaceDir, '重建名');

      const blocked = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: '重建名' },
      });
      expect(blocked.statusCode, blocked.raw).toBe(409);

      await injectJson(daemon.app, { method: 'DELETE', url: '/documents/重建名' });

      const recreated = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: '重建名' },
      });
      expect(recreated.statusCode, recreated.raw).toBe(201);
      const recreatedBody = await injectJson(daemon.app, {
        method: 'GET',
        url: '/documents/重建名/pages/page-1',
      });
      expect(recreatedBody.statusCode, recreatedBody.raw).toBe(200);
      const manifest = JSON.parse(
        await readFile(join(daemon.workspaceDir, '重建名.dfg', 'manifest.json'), 'utf8'),
      ) as { pages: { id: string }[] };
      expect(manifest.pages.map((page) => page.id)).toEqual(['page-1']);
      expect(await readdir(join(daemon.workspaceDir, '重建名.dfg', 'pages'))).toEqual([
        'page-1.json',
      ]);
    } finally {
      await daemon.cleanup();
    }
  });
});
