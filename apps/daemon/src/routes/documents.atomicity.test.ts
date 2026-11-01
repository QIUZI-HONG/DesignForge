/**
 * @dforge/daemon · 文档提交的失败语义（票 19）。
 *
 * 钉死两条可观测后果：
 * - 「删除」必须能删掉自己创建过的目录——`create()` 中途失败留下的**无 manifest 空壳**
 *   今天既读不到（`doc_not_found`）也删不掉，名字从此被 `EEXIST` 永久占用；
 * - 「保存失败」必须等于「盘上没变」，或**如实说明盘上已变成什么样**（409 不许沉默）。
 *
 * 覆盖面如实说明：跨进程 `conflict` 分支需要「外部提交正好挤进重试」这一时机，
 * 无法在 HTTP 缝上做确定性构造（实测挤爆率 ≈1.3%，见 ~/df-evidence/v2-19/probe.mjs），
 * 因此这里用**条件式断言**（一旦返回 409 就必须交代实况），把「失败不落正文」的
 * 构造性保证交给 `fs-atomic.test.ts` 的原语用例钉死；真实跨进程文档锁另开后续票。
 *
 * 纪律：全部走临时数据目录（testing/harness.ts），不碰 `~/.dforge`。
 */

import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDaemonApp } from '../app.ts';
import { removeTree } from '../fs-atomic.ts';
import { createTestDaemon, injectJson } from '../testing/harness.ts';

/** 复现 `create()` 在 mkdir 之后失败留下的现场：目录 + 正文在，manifest 从未写出。 */
async function seedShellDocument(workspaceDir: string, id: string): Promise<void> {
  await mkdir(join(workspaceDir, `${id}.dfg`, 'pages'), { recursive: true });
  await writeFile(join(workspaceDir, `${id}.dfg`, 'pages', 'page-1.json'), '{}\n', 'utf8');
}

/** 真实 socket 的 JSON 往返（`app.inject` 看不出跨实例并发，只用 inject 会绕开本缺陷）。 */
interface HttpResult {
  status: number;
  json: Record<string, unknown>;
}

async function httpJson(
  url: string,
  init: { method: string; payload?: unknown },
): Promise<HttpResult> {
  const response = await fetch(url, {
    method: init.method,
    headers: { 'content-type': 'application/json' },
    ...(init.payload === undefined ? {} : { body: JSON.stringify(init.payload) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text === '' ? {} : (JSON.parse(text) as HttpResult['json']),
  };
}

/** 同一实例对同一页串行保存 count 次；第 i 次的正文带 i，便于事后判定盘上到底是谁的内容。 */
async function sequentialSaves(
  baseUrl: string,
  documentId: string,
  pageId: string,
  count: number,
  owner: string,
): Promise<{ status: number; sent: unknown; json: Record<string, unknown> }[]> {
  const results = [];
  for (let index = 0; index < count; index += 1) {
    const sent = { owner, index };
    const result = await httpJson(
      `${baseUrl}/documents/${encodeURIComponent(documentId)}/pages/${pageId}`,
      { method: 'PUT', payload: { body: sent } },
    );
    results.push({ ...result, sent });
  }
  return results;
}

describe('documents · create() 失败不得留下残骸，也不得伤及既有文档', () => {
  it('同名 create 失败（doc_exists）后，既有文档必须原样可读、数据根无残骸', async () => {
    const daemon = await createTestDaemon();
    try {
      const created = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: '占名文档' },
      });
      expect(created.statusCode, created.raw).toBe(201);
      const saved = await injectJson(daemon.app, {
        method: 'PUT',
        url: '/documents/占名文档/pages/page-1',
        payload: { body: { marker: '既有内容' } },
      });
      expect(saved.statusCode, saved.raw).toBe(200);

      const again = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: '占名文档' },
      });
      expect(again.statusCode, again.raw).toBe(409);
      expect((again.payload as { error: { code: string } }).error.code).toBe('doc_exists');

      // 失败方只许撤掉自己刚建的东西：既有文档一个字节都不能少
      const readable = await injectJson(daemon.app, {
        method: 'GET',
        url: '/documents/占名文档/pages/page-1',
      });
      expect(readable.statusCode, readable.raw).toBe(200);
      const read = (readable.payload as { result: { body: { marker: string } } }).result;
      expect(read.body.marker).toBe('既有内容');
      // 且数据根只有那一个文档目录（无 .tmp / 无空壳）
      expect(await readdir(daemon.workspaceDir)).toEqual(['占名文档.dfg']);
    } finally {
      await daemon.cleanup();
    }
  });

  it('N=10 并发同名建文档：恰 1 个 201，其余 409，且数据根只留下那一个文档目录', async () => {
    const daemon = await createTestDaemon();
    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          injectJson(daemon.app, {
            method: 'POST',
            url: '/documents',
            payload: { name: '并发建文档' },
          }),
        ),
      );
      expect(results.filter((res) => res.statusCode === 201)).toHaveLength(1);
      expect(results.filter((res) => res.statusCode === 409)).toHaveLength(9);
      expect(await readdir(daemon.workspaceDir)).toEqual(['并发建文档.dfg']);
      const manifest = JSON.parse(
        await readFile(join(daemon.workspaceDir, '并发建文档.dfg', 'manifest.json'), 'utf8'),
      ) as { pages: unknown[] };
      expect(manifest.pages).toHaveLength(1);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('documents · 无 manifest 空壳目录必须可回收', () => {
  it('DELETE 空壳 → 200 且目录消失（此前恒 doc_not_found，名字永久占用）', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedShellDocument(daemon.workspaceDir, '壳文档');

      // 空壳在列表里必须可见（否则用户无从知道名字被谁占着）
      const listed = await injectJson(daemon.app, { method: 'GET', url: '/documents' });
      expect(listed.statusCode, listed.raw).toBe(200);
      const list = (
        listed.payload as {
          result: { documents: unknown[]; warnings: { id: string; code: string }[] };
        }
      ).result;
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

  it('空壳含外来文件（非守护进程自有名）→ DELETE 拒绝 4xx 且外来文件分毫未损', async () => {
    const daemon = await createTestDaemon();
    const shellId = 'orphan-shell';
    try {
      // 手造无 manifest 空壳：notes.txt + backup/ 子树，全是外来内容（非 manifest.json/pages//*.tmp）
      const shellDir = join(daemon.workspaceDir, `${shellId}.dfg`);
      await mkdir(join(shellDir, 'backup'), { recursive: true });
      await writeFile(join(shellDir, 'notes.txt'), 'x'.repeat(1300), 'utf8');
      await writeFile(join(shellDir, 'backup', 'data.bin'), 'y'.repeat(4096), 'utf8');
      await writeFile(join(shellDir, 'backup', 'git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8').catch(
        async () => {
          await mkdir(join(shellDir, 'backup', 'git'), { recursive: true });
          await writeFile(join(shellDir, 'backup', 'git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
        },
      );

      const removed = await injectJson(daemon.app, {
        method: 'DELETE',
        url: `/documents/${shellId}`,
      });
      // 收口：递归删只放通「条目 ⊆ {manifest.json, pages/, *.tmp}」的空壳；混入外来文件即拒绝
      expect(removed.statusCode, removed.raw).toBeLessThan(500);
      expect([400, 409]).toContain(removed.statusCode);
      const error = (removed.payload as { error: { code: string } }).error;
      expect(typeof error.code).toBe('string');

      // 关键：外来树必须原样存活——拒绝即零删除
      const notes = await readFile(join(shellDir, 'notes.txt'), 'utf8');
      expect(notes.length).toBe(1300);
      const bin = await readFile(join(shellDir, 'backup', 'data.bin'), 'utf8');
      expect(bin.length).toBe(4096);
      expect((await readdir(shellDir)).sort()).toContain('notes.txt');
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

describe('documents · 保存失败不得把正文以 .tmp 泄漏在 pages/（票 19 标题承诺）', () => {
  it('manifest 提交失败（文档目录 EACCES、pages/ 仍可写）时，被拒正文必须作废、pages/ 回到调用前', async () => {
    const daemon = await createTestDaemon();
    let docDir = '';
    try {
      const created = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: '泄漏守门' },
      });
      expect(created.statusCode, created.raw).toBe(201);
      const id = (created.payload as { result: { document: { id: string } } }).result.document.id;
      docDir = join(daemon.workspaceDir, `${id}.dfg`);
      const pagesDir = join(docDir, 'pages');
      const before = (await readdir(pagesDir)).sort();

      // 复现评审现场：文档目录本身不可写（pages/ 仍可写）——正文暂存会成功、
      // manifest 提交（同目录临时文件 rename）会 EACCES。commitManifest 若没有
      // try/finally 作废已暂存正文，那半截正文就以 .tmp 永久留在 pages/ 里。
      await chmod(docDir, 0o555);
      // 无论最终是 409 还是（F4 收口前的）500，都不许把被拒正文留在盘上。
      await injectJson(daemon.app, {
        method: 'PUT',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
        payload: { body: { marker: '被拒的正文' } },
      });

      const after = (await readdir(pagesDir)).sort();
      expect(
        after.filter((entry) => entry.endsWith('.tmp')),
        'pages/ 泄漏了被拒正文的 .tmp',
      ).toEqual([]);
      expect(after, 'pages/ 目录必须回到调用前的样子').toEqual(before);
    } finally {
      if (docDir !== '') await chmod(docDir, 0o755).catch(() => undefined);
      await daemon.cleanup();
    }
  });
});

/** 单次串行保存的结果（sent = 这次请求送上去的正文）。 */
interface SaveOutcome {
  status: number;
  sent: unknown;
  json: Record<string, unknown>;
}

describe('documents · 两个独立 daemon 实例共享同一数据根（跨实例并发）', () => {
  const apps: FastifyInstance[] = [];
  let root = '';
  let workspaceDir = '';
  let urlA = '';
  let urlB = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'df-v2-19-'));
    workspaceDir = join(root, 'workspace');
    const endpoints: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const app = await createDaemonApp({
        dataRoot: join(root, `data-${String(index)}`),
        workspaceDir,
        envApiKey: null,
        logger: false,
        fetchImpl: (async () => {
          throw new Error('本用例禁止出网');
        }) as unknown as typeof fetch,
      });
      apps.push(app);
      endpoints.push(String(await app.listen({ port: 0, host: '127.0.0.1' })));
    }
    const [first, second] = endpoints;
    urlA = first ?? '';
    urlB = second ?? '';
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await removeTree(root);
  });

  it('两个实例并发保存同一页：磁盘 manifest 必须恰好对应一次成功保存，且正文就是那次保存送的内容', async () => {
    const created = await httpJson(`${urlA}/documents`, {
      method: 'POST',
      payload: { name: '跨实例并发' },
    });
    expect(created.status).toBe(201);
    const documentId = (created.json.result as { document: { id: string } }).document.id;

    // 两个实例**同一页**各串行保存 60 次：每次都要重写整份 manifest，跨实例必然互踩
    const [runA, runB] = await Promise.all([
      sequentialSaves(urlA, documentId, 'page-1', 60, '实例1'),
      sequentialSaves(urlB, documentId, 'page-1', 60, '实例2'),
    ]);
    const all: SaveOutcome[] = [...runA, ...runB];

    // 失败必须是结构化 409，不许塌成 5xx
    expect(all.filter((save) => save.status >= 500).map((save) => save.status)).toEqual([]);
    for (const conflict of all.filter((save) => save.status === 409)) {
      const error = conflict.json.error as {
        code: string;
        message: string;
        details: Record<string, unknown>;
      };
      expect(error.code).toBe('conflict');
      expect(error.message.length).toBeGreaterThan(0);
      // 票 19 blocker 1：失败必须交代盘上到底变没变（禁止「失败但已变」而不说明）
      expect(error.details.published, JSON.stringify(error.details)).toBe(false);
      expect(typeof error.details.manifestVersionOnDisk).toBe('number');
      expect(typeof error.details.attemptedVersion).toBe('number');
    }

    const manifest = JSON.parse(
      await readFile(join(workspaceDir, `${documentId}.dfg`, 'manifest.json'), 'utf8'),
    ) as { pages: { id: string; updatedAt: string }[] };
    const entry = manifest.pages.find((page) => page.id === 'page-1');
    expect(entry).toBeDefined();
    // 盘上 manifest 的这次提交，必须能追溯到**恰好一次**报成功的保存
    const owners = all.filter(
      (save) =>
        save.status === 200 &&
        (save.json.result as { page: { updatedAt: string } }).page.updatedAt === entry?.updatedAt,
    );
    expect(
      owners.length,
      `manifest 里 page-1 的 updatedAt=${entry?.updatedAt} 对应 ${owners.length} 次「成功」保存（应为 1 次）`,
    ).toBe(1);

    // 且盘上正文必须就是那次成功保存送上去的内容——失败的保存不得把正文留在盘上
    const disk = JSON.parse(
      await readFile(join(workspaceDir, `${documentId}.dfg`, 'pages', 'page-1.json'), 'utf8'),
    ) as unknown;
    const owner = owners[0];
    expect(disk, '盘上正文不属于当前 manifest 所对应的那次成功保存').toEqual(owner?.sent);

    const files = (await readdir(join(workspaceDir, `${documentId}.dfg`, 'pages'))).sort();
    expect(files).toEqual(manifest.pages.map((page) => `${page.id}.json`).sort());
  });
});
