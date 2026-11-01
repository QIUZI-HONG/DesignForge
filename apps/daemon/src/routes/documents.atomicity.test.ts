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
 * create/delete 竞态（SE-5）同样只保留**不变量判据**：每一笔都必须 2xx 或类型化 4xx、
 * 失败响应不得含宿主路径、赛跑结束后必须能收口删除并重建——不断言「竞态一定制造出某种交错」。
 * 仍未覆盖的（属票 21 的跨进程互斥）：提交点**之后**正文发布失败（TOCTOU 把目标名换成目录）
 * 只能靠交错制造，本票不给概率式用例；该分支由 `publishFailure` 兜成类型化错误，注释如实交代。
 *
 * 纪律：全部走临时数据目录（testing/harness.ts），不碰 `~/.dforge`。
 */

import { chmod, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DfErrorCode } from '@dforge/contracts';
import { DF_ERROR_HTTP_STATUS } from '@dforge/contracts';
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
  /** 原始响应体（SE-5 用它判定「绝不回显宿主绝对路径」，不能只看解析后的 JSON）。 */
  raw: string;
}

async function httpJson(
  url: string,
  init: { method: string; payload?: unknown },
): Promise<HttpResult> {
  const response = await fetch(url, {
    method: init.method,
    // 无体的 DELETE/GET 不带 content-type：Fastify 见到 JSON content-type 会拒空体（400）
    ...(init.payload === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.payload) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text === '' ? {} : (JSON.parse(text) as HttpResult['json']),
    raw: text,
  };
}

/** 同一实例对同一页串行保存 count 次；第 i 次的正文带 i，便于事后判定盘上到底是谁的内容。 */
async function sequentialSaves(
  baseUrl: string,
  documentId: string,
  pageId: string,
  count: number,
  owner: string,
): Promise<(HttpResult & { sent: unknown })[]> {
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

/** 盘上的提交残骸：文档目录里的 `.commit-*` 声明 + `pages/` 里未发布的 `.tmp` 正文。 */
async function commitResidue(docDir: string): Promise<string[]> {
  const shell = await readdir(docDir).catch(() => [] as string[]);
  const pages = await readdir(join(docDir, 'pages')).catch(() => [] as string[]);
  return [
    ...shell.filter((entry) => entry.startsWith('.commit-')),
    ...pages.filter((entry) => entry.endsWith('.tmp')).map((entry) => `pages/${entry}`),
  ];
}

/**
 * 盯住**提交声明**本身：`.commit-<base>` 一出现就说明这一笔已经越过「读 base」，
 * 正处在声明→CAS→rename→复读这几步里；此时动手才叫落在提交窗口中间。
 *
 * 为什么不能只靠「同时发保存和删除」：三轮实测里，DELETE 的往返（解析 JSON + 校验空壳 +
 * 带重试 rm）比保存剩下的几步还慢，往往抢在声明之前就把目录收走，保存只是干净地 404——
 * 窗口根本没开，绿是空的。观察到声明再动手，把命中从「撞运气」变成「每轮都从窗口里切」。
 */
async function watchClaimFile(docDir: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const shell = await readdir(docDir).catch(() => [] as string[]);
    if (shell.some((entry) => entry.startsWith('.commit-'))) return true;
    if (Date.now() >= deadline) return false;
  }
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

  it('空壳里**借用白名单名字**的外来树不得被递归删（三轮 D2：白名单原判据只看名字）', async () => {
    const daemon = await createTestDaemon();
    try {
      const shellDir = join(daemon.workspaceDir, 'name-theft.dfg');
      // 三轮 D2 实测三例全被 200 + destroyed：`*.tmp`/`.commit-*` 名下建**目录**、
      // 以及把外来树塞进 `pages/` 里——白名单只比对名字，形态一概不看。
      await mkdir(join(shellDir, 'secret.tmp', 'inner'), { recursive: true });
      await writeFile(join(shellDir, 'secret.tmp', 'inner', 'keys.pem'), 'PRIVATE-A', 'utf8');
      await mkdir(join(shellDir, '.commit-zzz', 'inner'), { recursive: true });
      await writeFile(join(shellDir, '.commit-zzz', 'inner', 'keys.pem'), 'PRIVATE-E', 'utf8');
      await mkdir(join(shellDir, 'pages', 'inner'), { recursive: true });
      await writeFile(join(shellDir, 'pages', 'inner', 'keys.pem'), 'PRIVATE-B', 'utf8');

      const removed = await injectJson(daemon.app, {
        method: 'DELETE',
        url: '/documents/name-theft',
      });
      expect(removed.statusCode, removed.raw).toBe(400);
      expect((removed.payload as { error: { code: string } }).error.code).toBe('doc_invalid_id');

      // 拒绝即零删除：三棵外来树都必须在盘上
      expect(await readFile(join(shellDir, 'secret.tmp', 'inner', 'keys.pem'), 'utf8')).toBe(
        'PRIVATE-A',
      );
      expect(await readFile(join(shellDir, '.commit-zzz', 'inner', 'keys.pem'), 'utf8')).toBe(
        'PRIVATE-E',
      );
      expect(await readFile(join(shellDir, 'pages', 'inner', 'keys.pem'), 'utf8')).toBe(
        'PRIVATE-B',
      );
      // 拒因要点名到具体条目，不能只报「含外来内容」
      const details = (removed.payload as { error: { details?: { foreignEntries?: string[] } } })
        .error.details;
      expect(details?.foreignEntries).toContain('pages/inner');
    } finally {
      await daemon.cleanup();
    }
  });

  it('空壳里守护进程自有形态的条目仍可收口（页文件 + 崩溃残留 tmp/claim 都是文件）', async () => {
    const daemon = await createTestDaemon();
    try {
      const shellDir = join(daemon.workspaceDir, 'own-shape.dfg');
      await mkdir(join(shellDir, 'pages'), { recursive: true });
      // create() 中途失败的真实形态：先写正文（store.ts 的 page-1.json），manifest 还没落地
      await writeFile(join(shellDir, 'pages', 'page-1.json'), '{}\n', 'utf8');
      await writeFile(join(shellDir, 'pages', '.aabbccdd.tmp'), 'x', 'utf8');
      await writeFile(join(shellDir, '.commit-0123456789abcdef'), 'x', 'utf8');

      const removed = await injectJson(daemon.app, {
        method: 'DELETE',
        url: '/documents/own-shape',
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

  it('占位目录**非空**（publish 会 ENOTEMPTY 而非 EISDIR）：同一道提交点前的闸门，行为必须一致', async () => {
    // DA-3 的探针（评审要求「核实而非假设」ae6c7a9 真的挡在提交点之前）：
    // `rename(file -> 目录)` 对**空**目录报 EISDIR、对**非空**目录报 ENOTEMPTY，
    // 是两条不同的 errno；闸门若只按其中一种形状判定，另一种就会溜到提交点之后
    // （manifest 已前移、正文从未发布）。这里用非空目录把第二种形状钉住。
    const daemon = await createTestDaemon();
    try {
      const created = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: '非空目录占位' },
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

      await rm(pagePath, { force: true, recursive: true });
      await mkdir(pagePath);
      // 关键差异：目录里**有东西** → rename 的失败码从 EISDIR 变成 ENOTEMPTY
      await writeFile(join(pagePath, 'inside.txt'), '外来内容\n', 'utf8');

      const res = await injectJson(daemon.app, {
        method: 'PUT',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
        payload: { body: { marker: '不该落盘' } },
      });
      expect(res.statusCode, res.raw).toBeLessThan(500);
      expect((res.payload as { error: { code: string } }).error.code).toBe('doc_invalid_body');
      // 提交点之前拒绝 → manifest 分毫未动
      const after = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        version: number;
        pages: { updatedAt: string }[];
      };
      expect(after.version).toBe(before.version);
      expect(after.pages[0]?.updatedAt).toBe(before.pages[0]?.updatedAt);
      // 拒绝即零改动：目录与其中的外来文件都原样在位，pages/ 没有 .tmp 残骸
      expect(await readdir(pagePath)).toEqual(['inside.txt']);
      expect(await readFile(join(pagePath, 'inside.txt'), 'utf8')).toBe('外来内容\n');
      expect(
        (await readdir(join(docDir, 'pages'))).filter((entry) => entry.endsWith('.tmp')).length,
        '被拒的正文以 .tmp 留在 pages/',
      ).toBe(0);
      // 响应不回显宿主路径（同 F4 口径）
      expect(res.raw).not.toContain(daemon.workspaceDir);
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

  it('create 侧同样脱敏：数据根不可写（mkdir EACCES，非竞态错误族）→ 500 不回显宿主路径', async () => {
    // SE-5 的另一半：`create()` 里 ENOENT/ENOTDIR 已收敛为类型化 conflict，但**权限类**
    // 错误仍是有意的 500（宿主环境坏了，不是用户的并发冲突）。这条用例钉住的是
    // 「无论从 create 逃出哪一族错误，500 的形状都不许带宿主路径」——
    // 评审实测的 14/400 泄漏正是从 create 出去的（details.reason 逐字回显 fs message）。
    const daemon = await createTestDaemon({ logger: true });
    try {
      await chmod(daemon.workspaceDir, 0o555);
      const res = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: '根不可写' },
      });
      expect(res.statusCode).toBe(500);
      const error = (res.payload as { error: { code: string; details: { reason?: string } } })
        .error;
      expect(error.code).toBe('internal');
      expect(error.details.reason).toBe('EACCES');
      expect(res.raw, 'create 的 500 回显了宿主绝对路径').not.toContain(daemon.tempDir);
      expect(res.raw).not.toContain(daemon.workspaceDir);
      expect(
        daemon.capturedLogs.some(
          (line) =>
            line.includes('EACCES') && line.includes(join(daemon.workspaceDir, '根不可写.dfg')),
        ),
        'daemon 日志丢失了 create 失败的原始异常（脱敏不等于致盲）',
      ).toBe(true);
    } finally {
      await chmod(daemon.workspaceDir, 0o755).catch(() => undefined);
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
      // 三轮 D1 新增的可观测面：落败的 errno 必须如实带出（EEXIST=声明被占，与 ENOENT 族
      // 在响应里分得开，运维不必翻日志猜是哪一类）
      expect(error.details.errno, JSON.stringify(error.details)).toBe('EEXIST');

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

  it('提交路径里的 fs 错误必须分类：pages 被换成普通文件 → 409 带 preemptedBy/errno，不许 500（三轮 D1）', async () => {
    // 三轮 D1 的确定性替身：HEAD 上 `plan` 的暂存写把 fs 错误裸抛出去——`pages` 不是目录时
    // mkdir 撞 EEXIST，同一笔保存**每一轮**都塌成 `500 internal`（实测 HEAD 与修复后各跑 3 遍：
    // 500/500/500 对 409/409/409）。跨进程 TOCTOU 窗口靠撞运气只有 1/3 检出率，这类形状错误
    // 则可以钉死，所以两条都要：本条负责「分类本身」，下面的赛跑负责「真并发下也不出 5xx」。
    const daemon = await createTestDaemon();
    try {
      const { id, docDir } = await createDoc(daemon.app, daemon.workspaceDir, 'pages 是文件');
      const pagesPath = join(docDir, 'pages');
      const manifestPath = join(docDir, 'manifest.json');
      const manifestBefore = await readFile(manifestPath, 'utf8');
      await removeTree(pagesPath);
      await writeFile(pagesPath, '不是目录\n', { mode: 0o600 });

      const lost = await savePage(daemon.app, id, { marker: '探针正文' });
      expect(lost.statusCode, lost.raw).toBe(409);
      const error = (
        lost.payload as {
          error: { code: string; message: string; details: Record<string, unknown> };
        }
      ).error;
      expect(error.code).toBe('conflict');
      // 失败即盘上没变：manifest 一字节未动，被拒正文也不许以 .tmp 留在树里
      expect(await readFile(manifestPath, 'utf8'), '被拒的保存动了 manifest').toBe(manifestBefore);
      expect(error.details.published, JSON.stringify(error.details)).toBe(false);
      expect(error.details.preemptedBy, JSON.stringify(error.details)).toBe('plan');
      expect(error.details.errno, JSON.stringify(error.details)).toBe('EEXIST');
      expect(lost.raw, '失败响应回显了宿主绝对路径').not.toContain(daemon.workspaceDir);
      // 分类不许靠翻日志：形状错误也要在 details 里说清落在哪一步
      expect(error.message).toContain('plan');

      // 拒得不永久：把 `pages` 恢复成目录后同一笔保存照常成功（证明上面是判定落败，不是死锁）
      await removeTree(pagesPath);
      await mkdir(pagesPath, { recursive: true });
      const retry = await savePage(daemon.app, id, { marker: '恢复后正文' });
      expect(retry.statusCode, retry.raw).toBe(200);
      expect(JSON.parse(await readFile(join(pagesPath, 'page-1.json'), 'utf8'))).toEqual({
        marker: '恢复后正文',
      });
      expect(
        (await readdir(pagesPath)).filter((entry) => entry.endsWith('.tmp')),
        '恢复后的提交留下 .tmp',
      ).toEqual([]);
    } finally {
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

describe('documents · create/delete 竞态不得塌成 500（票 19 · SE-5）', () => {
  const apps: FastifyInstance[] = [];
  let root = '';
  let workspaceDir = '';
  let urlA = '';
  let urlB = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'df-v2-19-se5-'));
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

  it('两实例交叉同名建/删 80 轮：零 5xx、失败皆类型化、终态可收口重建、失败响应不回显宿主路径', async () => {
    const NAME = '竞态文档';
    const ID = '竞态文档';
    const docDir = join(workspaceDir, `${ID}.dfg`);

    /** 一笔竞态操作及其可观测结果。 */
    interface Op {
      kind: 'create' | 'delete';
      status: number;
      code: string | null;
      raw: string;
    }
    const call = async (
      kind: Op['kind'],
      url: string,
      init: { method: string; payload?: unknown },
    ): Promise<Op> => {
      const res = await httpJson(url, init);
      return {
        kind,
        status: res.status,
        code:
          res.status >= 400
            ? ((res.json.error as { code: string } | undefined)?.code ?? null)
            : null,
        raw: res.raw,
      };
    };

    // 80 轮 × 2 实例 × (create + delete)：create 与 delete 在同一目录名上真并发
    // （评审实测的正是这个形状：400 次 POST 里 14 次 500，details.reason 带绝对路径）
    const ops: Promise<Op>[] = [];
    for (let round = 0; round < 80; round += 1) {
      for (const url of [urlA, urlB]) {
        ops.push(call('create', `${url}/documents`, { method: 'POST', payload: { name: NAME } }));
        ops.push(
          call('delete', `${url}/documents/${encodeURIComponent(ID)}`, { method: 'DELETE' }),
        );
      }
    }
    const results = await Promise.all(ops);

    // 1) 失败面收口：竞态里**一笔 5xx 都不许有**（旧缺陷：提交段 ENOENT 直落 500）
    const serverErrors = results.filter((op) => op.status >= 500);
    expect(
      serverErrors.map((op) => `${op.kind}:${String(op.status)}`),
      `create/delete 竞态出现 ${String(serverErrors.length)} 笔 5xx（旧缺陷：ENOENT 直落 500）`,
    ).toEqual([]);

    // 2) 非 2xx 必须是带类型的错误码，且状态码与契约的错误码表一致（不许「第三种沉默」，
    //    也不许「409 的形状装在 500 的状态里」）
    const allowedCodes = [
      'conflict',
      'doc_exists',
      'doc_not_found',
      'doc_invalid_id',
      'doc_invalid_manifest',
    ];
    for (const op of results) {
      if (op.status === 201 || op.status === 200) continue;
      expect(op.code, JSON.stringify(op)).not.toBeNull();
      expect(allowedCodes, JSON.stringify(op)).toContain(op.code ?? '');
      expect(DF_ERROR_HTTP_STATUS[op.code as DfErrorCode], `${String(op.code)} 状态码错位`).toBe(
        op.status,
      );
    }

    // 3) **失败**响应一律不许含宿主绝对路径（F4/SE-5 脱敏纪律在赛场合流）。
    //    成功信封里的 `document.directory` 是产品真值（本地优先：用户要知道 .dfg 在哪），
    //    故只核查 4xx/5xx 的响应体——旧缺陷正是 500 的 details.reason 逐字带上被操作文件路径。
    const failureRaw = results
      .filter((op) => op.status >= 400)
      .map((op) => op.raw)
      .join('\n');
    expect(failureRaw, '竞态失败响应回显了宿主绝对路径').not.toContain(root);
    expect(failureRaw).not.toContain(workspaceDir);
    expect(failureRaw).not.toContain(docDir);

    // 4) 赛跑**之后**的终态真值（串行核查，不与在飞的请求竞速）：
    //    先 DELETE 收口——竞态不许留下「删不掉」的残骸（票 19 的空壳承诺在竞赛下同样成立），
    //    且 DELETE 的结论必须是类型化的（200 已删 / 404 本就不在）。
    const quiesce = await call('delete', `${urlA}/documents/${encodeURIComponent(ID)}`, {
      method: 'DELETE',
    });
    expect(
      [200, 404],
      `竞态后收口 DELETE 拿到非类型化结果：${quiesce.status} ${quiesce.raw}`,
    ).toContain(quiesce.status);
    expect(quiesce.code === null || quiesce.code === 'doc_not_found', quiesce.raw).toBe(true);

    // 数据根里不能再有这个名字（也没有别的残骸）：名字必须已释放，可重建
    const rootEntries = await readdir(workspaceDir);
    expect(rootEntries, `竞态留下无法删除的残骸：${JSON.stringify(rootEntries)}`).toEqual([]);

    // 5) 栅栏：同名重建必须成功且读得到（名字没被空壳/声明/临时文件永久占住）
    const fenceCreate = await call('create', `${urlB}/documents`, {
      method: 'POST',
      payload: { name: NAME },
    });
    expect(fenceCreate.status, `栅栏 create 未成功：${fenceCreate.raw}`).toBe(201);
    const listed = await httpJson(`${urlA}/documents`, { method: 'GET' });
    expect(listed.status).toBe(200);
    const docs = (listed.json.result as { documents: { id: string }[] }).documents;
    expect(
      docs.map((doc) => doc.id),
      JSON.stringify(docs),
    ).toEqual([ID]);
    const detail = await httpJson(`${urlA}/documents/${encodeURIComponent(ID)}`, {
      method: 'GET',
    });
    expect(detail.status, detail.raw).toBe(200);
    const docDirEntries = await readdir(docDir);
    expect(
      docDirEntries.filter((entry) => entry.endsWith('.tmp') || entry.startsWith('.commit-')),
      `栅栏之后文档目录仍有临时文件/提交声明残骸：${JSON.stringify(docDirEntries)}`,
    ).toEqual([]);
    expect(docDirEntries.sort()).toEqual(['manifest.json', 'pages']);
  });

  it('交叉「保存 × 删除」竞态：ENOENT 族必须落类型化 409/404，一笔 5xx 都不许有（三轮 D1）', async () => {
    const ID = '保存删除竞态';
    const first = await httpJson(`${urlA}/documents`, { method: 'POST', payload: { name: ID } });
    expect(first.status, first.raw).toBe(201);

    interface Op {
      status: number;
      code: string | null;
      raw: string;
      /** 窗口证据：500 的 `details.reason`（修复前）或 409 的 `details.errno`（修复后）。 */
      errno: string | null;
      /** 提交点已过（manifest 前移成功）——只有 DA-3 的发布失败会带这个标记。 */
      manifestCommitted: boolean;
    }
    const toOp = (res: { status: number; json: Record<string, unknown>; raw: string }): Op => {
      const error = res.json.error as
        | { code?: string; details?: Record<string, unknown> }
        | undefined;
      const errno =
        typeof error?.details?.reason === 'string'
          ? error.details.reason
          : typeof error?.details?.errno === 'string'
            ? error.details.errno
            : null;
      return {
        status: res.status,
        code: res.status >= 400 ? (error?.code ?? null) : null,
        raw: res.raw,
        errno,
        manifestCommitted: error?.details?.manifestCommitted === true,
      };
    };
    const send = async (url: string, init: { method: string; payload?: unknown }): Promise<Op> =>
      toOp(await httpJson(url, init));

    // 三轮 D1 实测的形状：保存正在飞（提交声明已建、manifest 还没 rename），另一路写者把整个
    // 文档目录摘掉 → claimCommit 之后的 base 复读 / manifest rename 报 ENOENT。HEAD 上这类败笔
    // 裸抛出 catch，一路塌成 500 internal；协议里没有一条路径能把「这一笔没做成」如实说出来。
    // 打法（对照实测两轮修正）：① 大正文只会拉长**声明之前**的暂存写，删除落进去后保存的
    // ensureDir 会把目录重建，反而干净提交成功——所以正文取小；② 走协议的 DELETE 往返比保存
    // 剩下的几步慢，60 轮里窗口几乎没开过——所以由测试进程扮演「不在协议里的第三方」，
    // 一见 `.commit-*` 声明就立刻 rm（亚毫秒级），刀才落得进窗口。
    // 如实交代检出力：这个窗口绝大多数落点在**提交点之后**（实测 60 轮里约 59 笔是
    // doc_invalid_body/DA-3 那一支），HEAD 的裸抛 500 只有约 1/3 的轮次能撞出来——所以本条
    // 是「真并发下绝不出 5xx、失败必类型化、盘上必无残骸」的**兜底网**；分类本身的确定性
    // 证明在前面那条 pages-as-file（HEAD 上 3/3 塌 500，修复后 3/3 出 409）。
    const createdId = (first.json.result as { document: { id: string } }).document.id;
    const docDir = join(workspaceDir, `${createdId}.dfg`);
    const ROUNDS = 60;
    const results: Op[] = [];
    const saves: Op[] = [];
    let windowsSeen = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      // 先扫上一轮的残骸再动手：残骸非空说明「失败=盘上没变」这条已经被破坏了，
      // 让下一轮的窗口观察建立在一个已污染的状态上没有意义，直接把这一轮判红。
      const residue = await commitResidue(docDir);
      expect(residue, `第 ${String(round)} 轮开始前文档目录已有提交残骸`).toEqual([]);
      // 上一轮的删除已把文档收走：重建（201 / 409 doc_exists，两者都是类型化）
      results.push(await send(`${urlB}/documents`, { method: 'POST', payload: { name: ID } }));
      const saving = send(`${urlA}/documents/${encodeURIComponent(ID)}/pages/page-1`, {
        method: 'PUT',
        payload: { body: { round } },
      });
      const opened = await watchClaimFile(docDir, 60);
      if (opened) {
        await removeTree(docDir).catch(() => undefined);
        windowsSeen += 1;
      }
      // 另一实例按协议收尾（多半只剩 404，但它的响应同样必须类型化、不回显宿主路径）
      results.push(await send(`${urlB}/documents/${encodeURIComponent(ID)}`, { method: 'DELETE' }));
      saves.push(await saving);
    }
    results.push(...saves);
    const raceOps = results.filter((item) => item.errno === 'ENOENT' || item.errno === 'ENOTDIR');
    // 覆盖自证：「观察到提交声明」= 那一笔确实飞到了读 base 之后、提交点之前，
    // 删除正是落在这段里。观察不到就说明打法失效——宁可红着回来改打法，
    // 也不交一个「不可能失败」的绿。
    expect(
      windowsSeen,
      `${String(ROUNDS)} 轮都没观察到 .commit-* 声明：盯盘器/打法失效，本条已退化成空过`,
    ).toBeGreaterThan(0);

    const serverErrors = results.filter((op) => op.status >= 500);
    expect(
      serverErrors.map((op) => op.status),
      `保存×删除竞态出现 ${String(serverErrors.length)} 笔 5xx（旧缺陷：裸抛的 ENOENT 直落 500）`,
    ).toEqual([]);
    // 带 errnos 的败笔分两种合法形状，都必须类型化、都不许是 5xx：
    // - 提交点**之前**被抢先（claim / CAS / readback）→ conflict（409），这一笔没写成，客户端重试即可；
    // - 提交点**之后**正文发布目标消失（DA-3：manifest 已前移、published:false）→ doc_invalid_body，
    //   这一笔已部分生效，报 conflict 会谎称「什么都没动」，而读侧会如实报正文不可用（票 21 裁决不回滚）。
    for (const op of raceOps) {
      if (op.manifestCommitted) {
        expect(op.code, op.raw).toBe('doc_invalid_body');
        expect(op.status, op.raw).toBe(DF_ERROR_HTTP_STATUS.doc_invalid_body);
      } else {
        expect(op.code, op.raw).toBe('conflict');
        expect(op.status, op.raw).toBe(409);
      }
    }

    const allowedCodes = [
      'conflict',
      'doc_not_found',
      'doc_exists',
      'doc_invalid_id',
      'doc_invalid_manifest',
      'doc_invalid_body',
    ];
    for (const op of results) {
      if (op.status < 400) continue;
      expect(op.code, op.raw).not.toBeNull();
      expect(allowedCodes, op.raw).toContain(op.code ?? '');
      expect(
        DF_ERROR_HTTP_STATUS[op.code as DfErrorCode],
        `${String(op.code)} 状态码错位：${op.raw}`,
      ).toBe(op.status);
      expect(op.raw, '失败响应回显了宿主绝对路径').not.toContain(workspaceDir);
    }

    // 竞态后必须收得回来：删净（404）或存在（200），再同名重建拿 201
    const quiesce = await send(`${urlA}/documents/${encodeURIComponent(ID)}`, { method: 'DELETE' });
    expect([200, 404], `竞态后收口 DELETE 非类型化：${quiesce.status} ${quiesce.raw}`).toContain(
      quiesce.status,
    );
    const rebuild = await send(`${urlB}/documents`, { method: 'POST', payload: { name: ID } });
    expect(rebuild.status, rebuild.raw).toBe(201);
    const saved = await send(`${urlA}/documents/${encodeURIComponent(ID)}/pages/page-1`, {
      method: 'PUT',
      payload: { body: { after: '竞态结束后的一笔正常保存' } },
    });
    expect(saved.status, saved.raw).toBe(200);
    // 风暴体量是击中窗口的必要条件（见上）；这里只放宽超时，不放宽任何断言。
  }, 30_000);
});
