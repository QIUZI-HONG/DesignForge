/**
 * @dforge/daemon · 文档提交的失败语义（票 19）。
 *
 * 钉死两条可观测后果：
 * - 「删除」必须能删掉自己创建过的目录——`create()` 中途失败留下的**无 manifest 空壳**
 *   今天既读不到（`doc_not_found`）也删不掉，名字从此被 `EEXIST` 永久占用；
 * - 「保存失败」必须等于「盘上没变」，或**如实说明盘上已变成什么样**（409 不许沉默）。
 *
 * 覆盖面如实说明（DA-2 之后已改写，不再沿用「conflict 分支无法确定性构造」的旧口径）：
 * 每次提交都带独有身份（manifest 的 `commitNonce`），并在改名前以 O_EXCL 独占声明
 * 「我从这一份 base 提交」（`fs-atomic.claimCommit`）。于是 `conflict` 分支**可以确定性构造**：
 * 先读到盘上的提交身份，再在文档目录里放好那一枚声明，就等于「另一个写者正从同一 base 提交」——
 * 本次保存必须判定落败（下面的「声明在位」用例）。跨实例赛跑只保留**计数不变量**
 * （成功次数 == 版本前进数），不再用毫秒级 `updatedAt` 去找「唯一赢家」（那是概率判定，实测 1/8 飘）。
 * 仍未覆盖的（属票 21 的跨进程互斥）：提交点**之后**正文发布失败（TOCTOU 把目标名换成目录）
 * 只能靠交错制造，本票不给概率式用例；该分支由 `publishFailure` 兜成类型化错误，注释如实交代。
 *
 * 纪律：全部走临时数据目录（testing/harness.ts），不碰 `~/.dforge`。
 */

import { chmod, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
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
      // 覆盖面补齐（SP-2：旧版只列数据根一层）：失败方自己的目录里也不许留临时件/提交声明，
      // 既有正文必须还是那一份——三级（数据根 / 文档目录 / pages）都得干净。
      const docDir = join(daemon.workspaceDir, '占名文档.dfg');
      expect(await readdir(docDir)).toEqual(['manifest.json', 'pages']);
      expect(await readdir(join(docDir, 'pages'))).toEqual(['page-1.json']);
      expect(await readFile(join(docDir, 'pages', 'page-1.json'), 'utf8')).toContain('既有内容');
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
      await mkdir(join(shellDir, 'backup', 'git'), { recursive: true });
      await writeFile(join(shellDir, 'notes.txt'), 'x'.repeat(1300), 'utf8');
      await writeFile(join(shellDir, 'backup', 'data.bin'), 'y'.repeat(4096), 'utf8');
      await writeFile(join(shellDir, 'backup', 'git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');

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

describe('documents · 发布目标不可替换必须在提交点之前拒绝（票 19 · F3）', () => {
  it('正文目标被换成目录（publish 会 EISDIR）：提交前即拒，manifest 不前移、非 500', async () => {
    const daemon = await createTestDaemon();
    try {
      const created = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: '发布目标占位' },
      });
      expect(created.statusCode, created.raw).toBe(201);
      const id = (created.payload as { result: { document: { id: string } } }).result.document.id;
      const docDir = join(daemon.workspaceDir, `${id}.dfg`);
      const manifestPath = join(docDir, 'manifest.json');
      const pagePath = join(docDir, 'pages', 'page-1.json');
      const before = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        version: number;
        pages: { updatedAt: string }[];
      };

      // 复现评审现场：把正文文件换成空目录 → commit 之后的 publish(rename) 必 EISDIR。
      // 若只在提交点之后才发现，manifest 已前移而正文从未发布，文档比调用之前更糟（readPage 打不开）。
      await rm(pagePath, { force: true, recursive: true });
      await mkdir(pagePath);

      const res = await injectJson(daemon.app, {
        method: 'PUT',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
        payload: { body: { marker: '不该落盘' } },
      });
      // 结构化错误、非 5xx
      expect(res.statusCode, res.raw).toBeLessThan(500);
      const error = (res.payload as { error: { code: string } }).error;
      expect(error.code).toBe('doc_invalid_body');
      // 提交点前拒绝 → manifest 分毫未动（version 与 updatedAt 不前移）
      const after = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        version: number;
        pages: { updatedAt: string }[];
      };
      expect(after.version).toBe(before.version);
      expect(after.pages[0]?.updatedAt).toBe(before.pages[0]?.updatedAt);
      // pages/ 里没有泄漏的 .tmp，且那个目录占位仍在（拒绝即零改动）
      const pagesDir = (await readdir(join(docDir, 'pages'))).sort();
      expect(pagesDir).toEqual(['page-1.json']);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('documents · 500 响应不得回显宿主绝对路径（票 19 · F4）', () => {
  it('manifest 提交 EACCES：500 + internal + reason=EACCES；响应无宿主路径，原始错误只进 daemon 日志', async () => {
    const daemon = await createTestDaemon({ logger: true });
    let docDir = '';
    try {
      const created = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: '脱敏检查' },
      });
      expect(created.statusCode, created.raw).toBe(201);
      const id = (created.payload as { result: { document: { id: string } } }).result.document.id;
      docDir = join(daemon.workspaceDir, `${id}.dfg`);
      await chmod(docDir, 0o555);
      const res = await injectJson(daemon.app, {
        method: 'PUT',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
        payload: { body: { marker: '必然失败的保存' } },
      });
      expect(res.statusCode).toBe(500);
      const error = (res.payload as { error: { code: string; details: { reason?: string } } })
        .error;
      expect(error.code).toBe('internal');
      // 稳定错误类摘要可用（运维可判别），但不含 message 里被操作文件的绝对路径
      expect(error.details.reason).toBe('EACCES');
      expect(res.raw, '500 响应体回显了宿主绝对路径').not.toContain(daemon.tempDir);
      expect(res.raw).not.toContain(daemon.workspaceDir);
      expect(res.raw).not.toContain(docDir);
      // 原始异常（含路径）保留在 daemon 日志里——对客户端脱敏，不能对运维致盲
      expect(
        daemon.capturedLogs.some((line) => line.includes('EACCES') && line.includes(docDir)),
        'daemon 日志丢失了原始异常',
      ).toBe(true);
    } finally {
      if (docDir !== '') await chmod(docDir, 0o755).catch(() => undefined);
      await daemon.cleanup();
    }
  });
});

/** 建文档并返回其目录路径与 id。 */
async function createDoc(
  app: FastifyInstance,
  workspaceDir: string,
  name: string,
): Promise<{ id: string; docDir: string }> {
  const created = await injectJson(app, { method: 'POST', url: '/documents', payload: { name } });
  expect(created.statusCode, created.raw).toBe(201);
  const id = (created.payload as { result: { document: { id: string } } }).result.document.id;
  return { id, docDir: join(workspaceDir, `${id}.dfg`) };
}

/** 保存一页（返回状态与响应体）。 */
async function savePage(
  app: FastifyInstance,
  id: string,
  body: unknown,
  pageId = 'page-1',
): Promise<{ statusCode: number; payload: unknown; raw: string }> {
  return injectJson(app, {
    method: 'PUT',
    url: `/documents/${encodeURIComponent(id)}/pages/${pageId}`,
    payload: { body },
  });
}

/** 读盘上 manifest 的提交身份（票 19 DA-2 起每笔提交都必须带，且逐笔不同）。 */
async function nonceOf(manifestPath: string): Promise<string> {
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as { commitNonce?: string };
  expect(typeof parsed.commitNonce, 'manifest 必须带独有提交身份 commitNonce').toBe('string');
  return parsed.commitNonce ?? '';
}

describe('documents · 提交身份与 CAS：败者必须拿到带类型 conflict（票 19 · DA-2）', () => {
  it('每笔提交换一次身份：连续保存的 manifest 字节两两不同（逐值比较认不出赢家）', async () => {
    const daemon = await createTestDaemon();
    try {
      const { id, docDir } = await createDoc(daemon.app, daemon.workspaceDir, '独有身份');
      const manifestPath = join(docDir, 'manifest.json');
      const seenBytes: string[] = [];
      const seenNonces: string[] = [];
      const versionBefore = (
        JSON.parse(await readFile(manifestPath, 'utf8')) as { version: number }
      ).version;
      for (let index = 0; index < 5; index += 1) {
        const saved = await savePage(daemon.app, id, { marker: `第 ${String(index)} 次` });
        expect(saved.statusCode, saved.raw).toBe(200);
        seenBytes.push(await readFile(manifestPath, 'utf8'));
        seenNonces.push(await nonceOf(manifestPath));
      }
      // 身份唯一 → 任意两笔提交的 manifest 字节不同（旧实现：正文不在 manifest 里 +
      // updatedAt 毫秒精度 → 同一毫秒的两笔字节完全相同，两边都判「我提交了」）
      expect(new Set(seenBytes).size).toBe(seenBytes.length);
      expect(new Set(seenNonces).size).toBe(seenNonces.length);
      const versionAfter = (JSON.parse(await readFile(manifestPath, 'utf8')) as { version: number })
        .version;
      expect(versionAfter - versionBefore).toBe(seenBytes.length);
    } finally {
      await daemon.cleanup();
    }
  });

  it('同一 base 已有提交者在飞（O_EXCL 声明在位）→ 409 conflict，manifest 与正文分毫未动', async () => {
    const daemon = await createTestDaemon();
    let claimPath = '';
    try {
      const { id, docDir } = await createDoc(daemon.app, daemon.workspaceDir, 'CAS 败者');
      const manifestPath = join(docDir, 'manifest.json');
      const pagePath = join(docDir, 'pages', 'page-1.json');
      const winner = await savePage(daemon.app, id, { marker: '赢家正文' });
      expect(winner.statusCode, winner.raw).toBe(200);
      const manifestBefore = await readFile(manifestPath, 'utf8');
      const bodyBefore = await readFile(pagePath, 'utf8');
      const versionBefore = (JSON.parse(manifestBefore) as { version: number }).version;

      // 确定性替身（旧口径「无法在 HTTP 缝上构造 conflict」到此作废）：daemon 提交前会以
      // O_EXCL 建 `<doc>/.commit-<base 的 commitNonce>` 声明「我从这份 base 提交」。
      // 该名字已被占 = 另一个写者正从同一 base 在飞 → 本次必须判定落败。
      claimPath = join(docDir, `.commit-${await nonceOf(manifestPath)}`);
      await writeFile(claimPath, `${'f'.repeat(24)}\n`, { mode: 0o600 });

      const lost = await savePage(daemon.app, id, { marker: '败者正文' });
      expect(lost.statusCode, lost.raw).toBe(409);
      const error = (
        lost.payload as {
          error: { code: string; message: string; details: Record<string, unknown> };
        }
      ).error;
      expect(error.code).toBe('conflict');
      expect(error.message).toContain('本次保存未生效');
      expect(error.details.published, JSON.stringify(error.details)).toBe(false);
      expect(error.details.attemptedVersion).toBe(versionBefore + 1);
      expect(error.details.manifestVersionOnDisk).toBe(versionBefore);
      expect(error.details.preemptedBy).toBe('claim');

      // 「失败 = 盘上没变」钉到字节级：manifest 一字节未动
      expect(await readFile(manifestPath, 'utf8')).toBe(manifestBefore);
      // 关键反 eager 断言：把正文改回「提交点之前直接 writeFileAtomic」时这条必须转红
      // （409 却正文已变 = 票 19 标题违背）
      expect(await readFile(pagePath, 'utf8')).toBe(bodyBefore);
      // 失败方的暂存正文必须作废，且不许把赢家的声明一起删掉
      expect(await readdir(join(docDir, 'pages'))).toEqual(['page-1.json']);
      expect(await readdir(docDir)).toContain(`.commit-${await nonceOf(manifestPath)}`);

      // 声明只挡那一笔：撤掉之后同一页照常提交（不是永久锁）
      await rm(claimPath, { force: true });
      claimPath = '';
      const retry = await savePage(daemon.app, id, { marker: '败者正文' });
      expect(retry.statusCode, retry.raw).toBe(200);
      expect(JSON.parse(await readFile(pagePath, 'utf8'))).toEqual({ marker: '败者正文' });
      expect(
        (JSON.parse(await readFile(manifestPath, 'utf8')) as { version: number }).version,
      ).toBe(versionBefore + 1);
      // 提交结束后声明不残留（成功也释放，否则后续写者被永久挡住）
      expect(
        (await readdir(docDir)).filter((entry) => entry.startsWith('.commit-')),
        '提交声明未释放，会把后续写者永久挡在 EEXIST 上',
      ).toEqual([]);
    } finally {
      if (claimPath !== '') await rm(claimPath, { force: true }).catch(() => undefined);
      await daemon.cleanup();
    }
  });

  it('声明过期（持有者崩溃残留）→ 接管：保存照常成功且不留声明', async () => {
    const daemon = await createTestDaemon();
    let claimPath = '';
    try {
      const { id, docDir } = await createDoc(daemon.app, daemon.workspaceDir, '过期接管');
      const manifestPath = join(docDir, 'manifest.json');
      const pagePath = join(docDir, 'pages', 'page-1.json');
      expect((await savePage(daemon.app, id, { marker: '第一笔' })).statusCode).toBe(200);
      const versionBefore = (
        JSON.parse(await readFile(manifestPath, 'utf8')) as { version: number }
      ).version;

      claimPath = join(docDir, `.commit-${await nonceOf(manifestPath)}`);
      await writeFile(claimPath, `${'e'.repeat(24)}\n`, { mode: 0o600 });
      // 把声明的 mtime 推到过期上界之外（fs-atomic 的 CLAIM_STALE_MS=30s）：等价于持有者崩溃
      const stale = new Date(Date.now() - 120_000);
      await utimes(claimPath, stale, stale);

      const taken = await savePage(daemon.app, id, { marker: '接管者正文' });
      expect(taken.statusCode, taken.raw).toBe(200);
      expect(
        (JSON.parse(await readFile(manifestPath, 'utf8')) as { version: number }).version,
      ).toBe(versionBefore + 1);
      expect(JSON.parse(await readFile(pagePath, 'utf8'))).toEqual({ marker: '接管者正文' });
      expect(await readdir(docDir)).not.toContain(claimPath.slice(docDir.length + 1));
    } finally {
      if (claimPath !== '') await rm(claimPath, { force: true }).catch(() => undefined);
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

  it('两个实例并发保存同一页：成功次数必须等于版本前进数，且盘上正文来自某一笔成功保存', async () => {
    const created = await httpJson(`${urlA}/documents`, {
      method: 'POST',
      payload: { name: '跨实例并发' },
    });
    expect(created.status).toBe(201);
    const documentId = (created.json.result as { document: { id: string } }).document.id;
    const docDir = join(workspaceDir, `${documentId}.dfg`);
    const manifestPath = join(docDir, 'manifest.json');
    const bodyPath = join(docDir, 'pages', 'page-1.json');
    const versionBefore = (JSON.parse(await readFile(manifestPath, 'utf8')) as { version: number })
      .version;

    // 两个实例**同一页**各串行保存 60 次：每次都要重写整份 manifest，跨实例必然互踩
    const [runA, runB] = await Promise.all([
      sequentialSaves(urlA, documentId, 'page-1', 60, '实例1'),
      sequentialSaves(urlB, documentId, 'page-1', 60, '实例2'),
    ]);
    const all: SaveOutcome[] = [...runA, ...runB];
    const successes = all.filter((save) => save.status === 200);
    const conflicts = all.filter((save) => save.status === 409);

    // 判定面收口（SP-2：旧版把 409 断言套在实测零命中的 filter 里，那段代码从不执行）：
    // 每笔保存要么 200、要么类型化 409——5xx 与「第三种沉默」都不许出现。
    expect(all.filter((save) => save.status >= 500).map((save) => save.status)).toEqual([]);
    expect(successes.length + conflicts.length, JSON.stringify(all.map((s) => s.status))).toBe(
      all.length,
    );
    for (const conflict of conflicts) {
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

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      version: number;
      pages: { id: string; updatedAt: string }[];
    };
    // **主判据（确定性）**：成功次数 == 版本前进数。
    // 这就是「一个赢家」的可核算形式——旧实现按值确认认不出赢家，二轮实测 2×400 同页保存
    // 拿到 800 个 200 而版本只前进 405（395 笔空转 200，其中一方的正文被静默盖掉）。
    expect(
      manifest.version - versionBefore,
      `成功 ${String(successes.length)} 笔但版本只前进 ${String(manifest.version - versionBefore)}（旧缺陷：并发提交双双判定成功）`,
    ).toBe(successes.length);

    // 盘上正文必须来自某一笔**成功**的保存；失败的保存一律不许把正文留在盘上
    const disk = JSON.parse(await readFile(bodyPath, 'utf8')) as { owner: string; index: number };
    const sameBody = (value: unknown): boolean => JSON.stringify(value) === JSON.stringify(disk);
    expect(
      successes.some((save) => sameBody(save.sent)),
      `盘上正文 ${JSON.stringify(disk)} 不属于任何一笔成功保存`,
    ).toBe(true);
    expect(conflicts.some((save) => sameBody(save.sent))).toBe(false);

    // 栅栏（无并发时提交点必须闭合）：赛跑结束后再单独保存一次，盘上 manifest 的页时间戳与
    // 正文都必须就是这一笔。**取代**旧版「用 updatedAt 反查恰好一次成功」的概率判定——
    // updatedAt 只有毫秒精度，实测 1/8 概率两个进程落在同一毫秒（owners 为 0 或 2）。
    const fence = await httpJson(
      `${urlA}/documents/${encodeURIComponent(documentId)}/pages/page-1`,
      { method: 'PUT', payload: { body: { owner: '栅栏', index: 0 } } },
    );
    expect(fence.status).toBe(200);
    const fenced = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      version: number;
      pages: { id: string; updatedAt: string }[];
    };
    expect(
      fenced.pages.find((page) => page.id === 'page-1')?.updatedAt,
      '栅栏保存成功后盘上页时间戳必须是这一笔',
    ).toBe((fence.json.result as { page: { updatedAt: string } }).page.updatedAt);
    expect(JSON.parse(await readFile(bodyPath, 'utf8'))).toEqual({ owner: '栅栏', index: 0 });
    expect(fenced.version - versionBefore).toBe(successes.length + 1);

    // 残余判定补齐（SP-2：旧版只看 pages/ 一层，漏了文档目录与数据根里
    // manifest 临时文件 / 提交声明的残骸）：三级都要干净，且声明只覆盖在飞窗口。
    expect(await readdir(docDir)).toEqual(['manifest.json', 'pages']);
    expect((await readdir(join(docDir, 'pages'))).sort()).toEqual(
      fenced.pages.map((page) => `${page.id}.json`).sort(),
    );
    expect(await readdir(workspaceDir)).toEqual([`${documentId}.dfg`]);
  });
});
