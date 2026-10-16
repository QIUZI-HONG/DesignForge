/**
 * @dforge/daemon · Q1（路径穿越）/ Q2（manifest 并发）修复的**必验清单**。
 *
 * 与 `adversarial.test.ts`（测试工程师独立用例）互补：本文件把修复要求逐条钉死——
 * - 读/写/删三条 `..%2F` 越界路径都被拒，且**树外零副作用**（临时数据目录断言）；
 * - 恶意 manifest（`pages[].id` 穿越）在读/写/删三路都被拒；
 * - 伪造的同名 `victim.dfg` 被删时**只删数据根内那个目录**，根本身/祖先绝不可作递归删目标；
 * - 软链不被跟随（写穿防护）、NFC/NFD 不生成两个目录、控制字符/NUL/超长/绝对路径一律 4xx；
 * - 合法 id（中文/点/横线/下划线）全链路仍可用；
 * - N=20 并发建页 → 20 页齐全且 manifest 可解析；N=10 并发同名建文档 → 恰 1 个 201。
 *
 * 纪律：全部用临时数据目录（testing/harness.ts），不碰 `~/.dforge`。
 */

import { mkdir, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTestDaemon, injectJson } from '../testing/harness.ts';

interface InjectResult {
  statusCode: number;
  payload: unknown;
  raw: string;
}

/** 统一失败信封断言：4xx + `{ok:false,error:{code,message}}` + 不泄漏绝对路径。 */
function expectFailure(
  result: InjectResult,
  options: { code?: string; noLeak?: string } = {},
): void {
  expect(result.statusCode, result.raw).toBeGreaterThanOrEqual(400);
  expect(result.statusCode, result.raw).toBeLessThan(500);
  const payload = result.payload as { ok?: boolean; error?: { code?: string; message?: string } };
  expect(payload.ok, result.raw).toBe(false);
  expect(typeof payload.error?.code, result.raw).toBe('string');
  if (options.code !== undefined) expect(payload.error?.code, result.raw).toBe(options.code);
  if (options.noLeak !== undefined) expect(result.raw, result.raw).not.toContain(options.noLeak);
}

/** 构造一份形状合法、可注入任意 pageId 的 manifest 文本（模拟克隆来的 .dfg）。 */
function manifestText(id: string, pageIds: string[] = ['page-1']): string {
  return `${JSON.stringify(
    {
      schema: 'df.dfg.manifest/v1',
      id,
      name: id,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      pages: pageIds.map((pageId) => ({
        id: pageId,
        name: pageId,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
    },
    null,
    2,
  )}\n`;
}

/** 在临时根（数据根之外）造一个形状合法的 `<id>.dfg` 目录。 */
async function makeOutsideDoc(
  tempDir: string,
  relativeDir: string,
  id: string,
  pageIds: string[] = ['page-1'],
): Promise<string> {
  const dir = join(tempDir, relativeDir, `${id}.dfg`);
  await mkdir(join(dir, 'pages'), { recursive: true });
  await writeFile(join(dir, 'manifest.json'), manifestText(id, pageIds));
  await writeFile(join(dir, 'pages', 'page-1.json'), '{"outside":true}\n');
  return dir;
}

/** 便捷：建文档并回 id。 */
async function createDocument(
  app: Parameters<typeof injectJson>[0],
  name: string,
): Promise<string> {
  const created = await injectJson(app, { method: 'POST', url: '/documents', payload: { name } });
  expect(created.statusCode).toBe(201);
  return (created.payload as { result: { document: { id: string } } }).result.document.id;
}

describe('安全回归 · Q1 路径穿越：越界读', () => {
  it('GET 越界（..%2F / 多层 / 编码点）一律 4xx，不返回树外正文也不泄漏路径', async () => {
    const daemon = await createTestDaemon();
    try {
      const outside = await makeOutsideDoc(daemon.tempDir, 'outside/evil', 'victim');
      const marker = 'TOP-SECRET-OUTSIDE-BODY';
      await writeFile(join(outside, 'pages', 'page-1.json'), JSON.stringify({ secret: marker }));

      const urls = [
        '/documents/..%2Foutside%2Fevil%2Fvictim/pages/page-1',
        '/documents/..%2Foutside%2Fevil%2Fvictim',
        '/documents/..%2F..%2Foutside%2Fevil%2Fvictim/pages/page-1',
        '/documents/%2E%2E%2Foutside%2Fevil%2Fvictim/pages/page-1',
      ];
      for (const url of urls) {
        const res = await injectJson(daemon.app, { method: 'GET', url });
        expectFailure(res, { noLeak: daemon.tempDir });
        expect(res.raw, url).not.toContain(marker);
      }
      // 越界读不得回显注入串本身（避免把 `..%2F` 反射回响应体）
      const traversal = await injectJson(daemon.app, {
        method: 'GET',
        url: '/documents/..%2Foutside%2Fevil%2Fvictim/pages/page-1',
      });
      expectFailure(traversal, { code: 'doc_invalid_id' });
      expect(traversal.raw).not.toContain('outside');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('安全回归 · Q1 路径穿越：越界写', () => {
  it('PUT/PATCH 越界：树外既有文件不被改写、新目标不被创建', async () => {
    const daemon = await createTestDaemon();
    try {
      const outside = await makeOutsideDoc(daemon.tempDir, 'outside/evil', 'outdoc');
      const existing = join(outside, 'pages', 'page-1.json');
      const manifest = join(outside, 'manifest.json');
      await writeFile(existing, '{"keep":true}\n');
      const before = await readFile(manifest, 'utf8');

      const put = await injectJson(daemon.app, {
        method: 'PUT',
        url: '/documents/..%2Foutside%2Fevil%2Foutdoc/pages/page-1',
        payload: { body: { pwned: true } },
      });
      expectFailure(put, { code: 'doc_invalid_id', noLeak: daemon.tempDir });
      expect(await readFile(existing, 'utf8')).toBe('{"keep":true}\n');
      expect(await readFile(manifest, 'utf8')).toBe(before);

      const patch = await injectJson(daemon.app, {
        method: 'PATCH',
        url: '/documents/..%2Foutside%2Fevil%2Foutdoc',
        payload: { name: 'renamed' },
      });
      expectFailure(patch, { noLeak: daemon.tempDir });
      expect(await readFile(manifest, 'utf8')).toBe(before);

      const createPage = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents/..%2Foutside%2Fevil%2Foutdoc/pages',
        payload: { name: 'p2' },
      });
      expectFailure(createPage, { noLeak: daemon.tempDir });
      expect((await readdir(join(outside, 'pages'))).sort()).toEqual(['page-1.json']);

      // 树外的新目录也不得被创建
      expect(await stat(join(daemon.tempDir, 'outside', 'leak2.dfg')).catch(() => null)).toBeNull();
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('安全回归 · Q1 路径穿越：越界删与删除守卫', () => {
  it('DELETE 越界：树外 .dfg 目录不被递归删除', async () => {
    const daemon = await createTestDaemon();
    try {
      const victim = await makeOutsideDoc(daemon.tempDir, 'outside/evil', 'victim');
      const res = await injectJson(daemon.app, {
        method: 'DELETE',
        url: '/documents/..%2Foutside%2Fevil%2Fvictim',
      });
      expectFailure(res, { code: 'doc_invalid_id', noLeak: daemon.tempDir });
      expect((await stat(victim)).isDirectory()).toBe(true);
      expect(await readFile(join(victim, 'pages', 'page-1.json'), 'utf8')).toContain('outside');
    } finally {
      await daemon.cleanup();
    }
  });

  it('删除守卫：数据根本身与祖先绝不可作为递归删目标', async () => {
    const daemon = await createTestDaemon();
    try {
      await createDocument(daemon.app, 'rootguard');
      for (const url of [
        '/documents/%2E',
        '/documents/..',
        '/documents/%2E%2E',
        '/documents/%2E%2E%2F%2E%2E',
        '/documents/..%2F..%2F..',
      ]) {
        const res = await injectJson(daemon.app, { method: 'DELETE', url });
        expectFailure(res, { noLeak: daemon.tempDir });
      }
      expect((await stat(daemon.workspaceDir)).isDirectory()).toBe(true);
      expect(
        (await stat(join(daemon.workspaceDir, 'rootguard.dfg', 'manifest.json'))).isFile(),
      ).toBe(true);
      expect((await stat(daemon.dataRoot)).isDirectory()).toBe(true);
    } finally {
      await daemon.cleanup();
    }
  });

  it('根内 victim.dfg 被删时只删这一个目录（树外同名目录秋毫无犯）', async () => {
    const daemon = await createTestDaemon();
    try {
      await createDocument(daemon.app, 'victim');
      const inside = join(daemon.workspaceDir, 'victim.dfg');
      const outside = await makeOutsideDoc(daemon.tempDir, 'outside', 'victim');

      const res = await injectJson(daemon.app, { method: 'DELETE', url: '/documents/victim' });
      expect(res.statusCode).toBe(200);
      expect(await stat(inside).catch(() => null)).toBeNull();
      expect((await stat(outside)).isDirectory()).toBe(true);
      expect(await readFile(join(outside, 'pages', 'page-1.json'), 'utf8')).toContain('outside');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('安全回归 · Q1 恶意 manifest（不可信输入）', () => {
  it('manifest.pages[].id 穿越：读/写/删三路都被拒且树外零副作用', async () => {
    const daemon = await createTestDaemon();
    try {
      await createDocument(daemon.app, 'shared');
      const manifestPath = join(daemon.workspaceDir, 'shared.dfg', 'manifest.json');
      const escaped = join(daemon.tempDir, 'outside', 'leak.json');
      await mkdir(join(daemon.tempDir, 'outside'), { recursive: true });
      await writeFile(escaped, '{"keep":true}\n');
      // 恶意 manifest：合法页 + 越界页（../../../outside/leak → tempDir/outside/leak.json）
      await writeFile(manifestPath, manifestText('shared', ['page-1', '../../../outside/leak']));

      const read = await injectJson(daemon.app, {
        method: 'GET',
        url: '/documents/shared/pages/page-1',
      });
      expectFailure(read, { code: 'doc_invalid_manifest', noLeak: daemon.tempDir });

      const write = await injectJson(daemon.app, {
        method: 'PUT',
        url: '/documents/shared/pages/..%2F..%2F..%2Foutside%2Fleak',
        payload: { body: { pwned: true } },
      });
      expectFailure(write, { noLeak: daemon.tempDir });

      const del = await injectJson(daemon.app, {
        method: 'DELETE',
        url: '/documents/shared/pages/..%2F..%2F..%2Foutside%2Fleak',
      });
      expectFailure(del, { noLeak: daemon.tempDir });

      // 树外文件既没被写、也没被删
      expect(await readFile(escaped, 'utf8')).toBe('{"keep":true}\n');
      // 损坏 manifest 的目录：列表跳过并给 warning（不阻塞）
      const list = await injectJson(daemon.app, { method: 'GET', url: '/documents' });
      expect(
        (list.payload as { result: { warnings: { code: string }[] } }).result.warnings,
      ).toEqual([expect.objectContaining({ code: 'manifest_invalid' })]);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('安全回归 · Q1 软链与标识符边界', () => {
  it('根内软链 .dfg 指向树外时读写删均被拒（写穿防护）', async () => {
    const daemon = await createTestDaemon();
    try {
      const target = await makeOutsideDoc(daemon.tempDir, 'outside', 'symtarget');
      const marker = 'SYMLINK-OUTSIDE-BODY';
      await writeFile(join(target, 'pages', 'page-1.json'), JSON.stringify({ secret: marker }));
      await mkdir(daemon.workspaceDir, { recursive: true });
      await symlink(target, join(daemon.workspaceDir, 'link.dfg'));

      const read = await injectJson(daemon.app, {
        method: 'GET',
        url: '/documents/link/pages/page-1',
      });
      expectFailure(read, { noLeak: daemon.tempDir });
      expect(read.raw).not.toContain(marker);

      const write = await injectJson(daemon.app, {
        method: 'PUT',
        url: '/documents/link/pages/page-1',
        payload: { body: { pwned: true } },
      });
      expectFailure(write, { noLeak: daemon.tempDir });
      expect(await readFile(join(target, 'pages', 'page-1.json'), 'utf8')).toContain(marker);

      const del = await injectJson(daemon.app, { method: 'DELETE', url: '/documents/link' });
      expectFailure(del, { noLeak: daemon.tempDir });
      expect((await stat(target)).isDirectory()).toBe(true);
    } finally {
      await daemon.cleanup();
    }
  });

  it('NFC/NFD：同名不生成两个目录；NFD 形态的 id 一律 4xx', async () => {
    const daemon = await createTestDaemon();
    try {
      const nfd = 'e\u0301x';
      const nfc = nfd.normalize('NFC');
      expect(nfc).not.toBe(nfd);

      const created = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: nfd },
      });
      expect(created.statusCode).toBe(201);
      const id = (created.payload as { result: { document: { id: string } } }).result.document.id;
      expect(id).toBe(nfc);

      const again = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: nfc },
      });
      expect(again.statusCode).toBe(409);
      expect((again.payload as { error: { code: string } }).error.code).toBe('doc_exists');

      const list = await injectJson(daemon.app, { method: 'GET', url: '/documents' });
      expect((list.payload as { result: { documents: unknown[] } }).result.documents).toHaveLength(
        1,
      );

      const nfdGet = await injectJson(daemon.app, {
        method: 'GET',
        url: `/documents/${encodeURIComponent(nfd)}`,
      });
      expectFailure(nfdGet, { code: 'doc_invalid_id' });
      const nfcGet = await injectJson(daemon.app, {
        method: 'GET',
        url: `/documents/${encodeURIComponent(nfc)}`,
      });
      expect(nfcGet.statusCode).toBe(200);
    } finally {
      await daemon.cleanup();
    }
  });

  it('控制字符/NUL/超长/绝对路径/通配标识符：读删两路一律 4xx 且不触盘', async () => {
    const daemon = await createTestDaemon();
    try {
      await createDocument(daemon.app, 'keeper');
      const badIds = [
        'a%00b',
        'a%2Fb',
        'a%5Cb',
        'a'.repeat(65),
        '%2Fetc%2Fpasswd',
        '..%2F..',
        'a%2Abcd',
      ];
      for (const raw of badIds) {
        for (const method of ['GET', 'DELETE'] as const) {
          const res = await injectJson(daemon.app, { method, url: `/documents/${raw}` });
          expectFailure(res, { noLeak: daemon.tempDir });
        }
      }
      expect((await readdir(daemon.workspaceDir)).sort()).toEqual(['keeper.dfg']);
    } finally {
      await daemon.cleanup();
    }
  });

  it('合法 id（中文/点/横线/下划线）全链路仍可用：CRUD 一路 2xx', async () => {
    const daemon = await createTestDaemon();
    try {
      for (const name of ['我的 设计', 'a.b_c-d', '页面.1', 'UPPER_123']) {
        const id = await createDocument(daemon.app, name);
        const encoded = encodeURIComponent(id);
        expect(
          (await injectJson(daemon.app, { method: 'GET', url: `/documents/${encoded}` }))
            .statusCode,
          name,
        ).toBe(200);
        expect(
          (
            await injectJson(daemon.app, {
              method: 'PUT',
              url: `/documents/${encoded}/pages/page-1`,
              payload: { body: { hello: name } },
            })
          ).statusCode,
          name,
        ).toBe(200);
        const read = await injectJson(daemon.app, {
          method: 'GET',
          url: `/documents/${encoded}/pages/page-1`,
        });
        expect((read.payload as { result: { body: unknown } }).result.body, name).toEqual({
          hello: name,
        });
        expect(
          (
            await injectJson(daemon.app, {
              method: 'POST',
              url: `/documents/${encoded}/pages`,
              payload: { name: '第二页' },
            })
          ).statusCode,
          name,
        ).toBe(201);
        expect(
          (
            await injectJson(daemon.app, {
              method: 'PATCH',
              url: `/documents/${encoded}`,
              payload: { name: `${name} 改名` },
            })
          ).statusCode,
          name,
        ).toBe(200);
        expect(
          (await injectJson(daemon.app, { method: 'DELETE', url: `/documents/${encoded}` }))
            .statusCode,
          name,
        ).toBe(200);
      }
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('安全回归 · Q2 manifest 并发', () => {
  it('N=20 并发建页：20 个 201、21 页齐全、manifest 可解析且版本自洽', async () => {
    const daemon = await createTestDaemon();
    try {
      await createDocument(daemon.app, 'bulk');
      const results = await Promise.all(
        Array.from({ length: 20 }, (_unused, index) =>
          injectJson(daemon.app, {
            method: 'POST',
            url: '/documents/bulk/pages',
            payload: { name: `P${index}` },
          }),
        ),
      );
      expect(results.filter((res) => res.statusCode === 201)).toHaveLength(20);

      const manifestPath = join(daemon.workspaceDir, 'bulk.dfg', 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        version: number;
        pages: { id: string }[];
      };
      const pageIds = manifest.pages.map((page) => page.id);
      expect(manifest.pages).toHaveLength(21); // page-1 + 20
      expect(new Set(pageIds).size).toBe(21); // id 不重复
      expect(manifest.version).toBe(21); // 1（创建）+ 20（建页）

      // 磁盘上每个 manifest 页都有正文文件（已回 201 的页面绝不丢）
      const files = (await readdir(join(daemon.workspaceDir, 'bulk.dfg', 'pages'))).sort();
      expect(files).toEqual(pageIds.map((id) => `${id}.json`).sort());
      // 不留原子写临时文件
      expect(files.some((file) => file.endsWith('.tmp'))).toBe(false);
    } finally {
      await daemon.cleanup();
    }
  });

  it('N=10 并发同名建文档：恰 1 个 201，其余 9 个 409 doc_exists（冲突口径）', async () => {
    const daemon = await createTestDaemon();
    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          injectJson(daemon.app, {
            method: 'POST',
            url: '/documents',
            payload: { name: '同名并发' },
          }),
        ),
      );
      expect(results.filter((res) => res.statusCode === 201)).toHaveLength(1);
      const conflicts = results.filter((res) => res.statusCode === 409);
      expect(conflicts).toHaveLength(9);
      for (const conflict of conflicts) {
        expect((conflict.payload as { error: { code: string } }).error.code).toBe('doc_exists');
      }
      const manifest = JSON.parse(
        await readFile(join(daemon.workspaceDir, '同名并发.dfg', 'manifest.json'), 'utf8'),
      ) as { pages: unknown[] };
      expect(manifest.pages).toHaveLength(1);
      expect((await readdir(daemon.workspaceDir)).sort()).toEqual(['同名并发.dfg']);
    } finally {
      await daemon.cleanup();
    }
  });

  it('N=12 并发保存不同页 + 建页混合：manifest 页数与磁盘正文一一对应', async () => {
    const daemon = await createTestDaemon();
    try {
      await createDocument(daemon.app, 'mixed');
      await Promise.all(
        Array.from({ length: 3 }, (_unused, index) =>
          injectJson(daemon.app, {
            method: 'POST',
            url: '/documents/mixed/pages',
            payload: { name: `页 ${index}` },
          }),
        ),
      );
      // page-1..page-4 各写 3 次（并发读改写同一 manifest）
      const saves = await Promise.all(
        ['page-1', 'page-2', 'page-3', 'page-4'].flatMap((pageId) =>
          Array.from({ length: 3 }, (_unused, round) =>
            injectJson(daemon.app, {
              method: 'PUT',
              url: `/documents/mixed/pages/${pageId}`,
              payload: { body: { pageId, round, pad: 'x'.repeat(1000) } },
            }),
          ),
        ),
      );
      expect(saves.filter((res) => res.statusCode === 200)).toHaveLength(12);

      const manifest = JSON.parse(
        await readFile(join(daemon.workspaceDir, 'mixed.dfg', 'manifest.json'), 'utf8'),
      ) as { version: number; pages: { id: string; updatedAt: string }[] };
      expect(manifest.pages.map((page) => page.id).sort()).toEqual([
        'page-1',
        'page-2',
        'page-3',
        'page-4',
      ]);
      // 1（创建）+ 3（建页）+ 12（保存）
      expect(manifest.version).toBe(16);
      for (const page of manifest.pages) {
        const body = JSON.parse(
          await readFile(
            join(daemon.workspaceDir, 'mixed.dfg', 'pages', `${page.id}.json`),
            'utf8',
          ),
        ) as { pageId: string; pad: string };
        expect(body.pageId).toBe(page.id);
        expect(body.pad).toHaveLength(1000); // 无半截 JSON
      }
    } finally {
      await daemon.cleanup();
    }
  });
});
