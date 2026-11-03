/**
 * @dforge/daemon · 文档存储提交顺序故障注入（TC-DOC-06 · 守护回归）。
 *
 * 真源口径：vitest 单测 @ documents/store.ts（mock fs 层，不走 HTTP）——
 * vi.mock fs-atomic 的 writeFileAtomic：同一次 savePage 第 1 次（页面正文）成功、
 * 第 2 次（manifest）抛 EACCES → 失败冒泡（路由层据此回 5xx 错误信封，不假成功）；
 * 解除 mock 后读侧一致：manifest version 未自增（manifest 是提交点）、
 * 正文文件恒为完整 JSON（v1 或 v2，绝无半截）、列表 sizeBytes/pageCount 自洽。
 *
 * 断言↔缺陷形态对照（守护的意义）：
 * - 提交顺序倒置（先 manifest 后正文）→ 故障落在正文写上 → manifest 被写入 v3 →
 *   「version 未自增」红；
 * - 失败被吞（假成功）→ savePage 不 reject → 冒泡断言红；
 * - 失败写污染 manifest（非原子写）→ manifest 字节态变化/不可解析 → 红。
 *
 * 注：真源 ④ 字面为「body=v1 正文」；基线物理态是「正文先落盘 ⇒ 盘上正文已是 v2、
 * manifest 仍 v1（未提交新态）」——TC-DOC-05 明确该中间态合法（读侧只见一致旧/新态）。
 * 若按字面断言 body=v1 则基线即红，违背本票「守护回归、基线预期绿」前提，故本用例
 * 断言不变量（正文 ∈ {v1,v2} 完整态 + version 未自增 + manifest 字节不变），偏离已登记。
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { createConfigStore } from '../config/store.ts';
import { createDocumentStore } from './store.ts';

const fsAtomicState = vi.hoisted(() => ({
  /** 已发生的 writeFileAtomic 调用数。 */
  calls: 0,
  /** 故障注入点：第 N 次调用起全部抛 EACCES；null = 未注入。 */
  failFromCall: null as number | null,
}));

vi.mock('../fs-atomic.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fs-atomic.ts')>();
  return {
    ...actual,
    writeFileAtomic: async (...args: Parameters<typeof actual.writeFileAtomic>) => {
      fsAtomicState.calls += 1;
      if (
        fsAtomicState.failFromCall !== null &&
        fsAtomicState.calls >= fsAtomicState.failFromCall
      ) {
        throw Object.assign(new Error('EACCES: permission denied（提交顺序故障注入）'), {
          code: 'EACCES',
        });
      }
      return actual.writeFileAtomic(...args);
    },
  };
});

it('TC-DOC-06 · savePage 正文成功、manifest 写抛 EACCES：失败冒泡、version 未自增、读侧一致、列表自洽', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'df-doc06-'));
  const workspaceDir = join(tempDir, 'workspace');
  try {
    const config = createConfigStore({
      configJsonPath: join(tempDir, 'config.json'),
      defaultWorkspaceDir: workspaceDir,
    });
    await config.load();
    const store = createDocumentStore({ config });

    // 已建文档 v1：create（version=1）+ savePage v1={mark:1}（version=2）
    const created = await store.create('提交顺序');
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unreachable');
    const id = created.value.id;
    const v1Body = { mark: 1 };
    const savedV1 = await store.savePage(id, 'page-1', v1Body);
    expect(savedV1.ok).toBe(true);
    const manifestPath = join(workspaceDir, `${id}.dfg`, 'manifest.json');
    const pagePath = join(workspaceDir, `${id}.dfg`, 'pages', 'page-1.json');
    const manifestBefore = await readFile(manifestPath, 'utf8');

    // 注入：下一次 savePage 的第 1 次 writeFileAtomic（正文 v2）成功、第 2 次（manifest）抛 EACCES
    fsAtomicState.failFromCall = fsAtomicState.calls + 2;
    const v2Body = { mark: 2 };
    // 失败冒泡（路由层据此回 5xx 信封）——不假成功
    await expect(store.savePage(id, 'page-1', v2Body)).rejects.toThrowError(/EACCES/);
    fsAtomicState.failFromCall = null; // 解除 mock

    // manifest 是提交点：version 未自增，且字节态与失败前完全一致（失败的写不碰目标文件）
    const manifestAfter = await readFile(manifestPath, 'utf8');
    expect(manifestAfter).toBe(manifestBefore);
    const manifest = JSON.parse(manifestAfter) as { version: number };
    expect(manifest.version).toBe(2);

    // 读侧一致：正文文件恒为完整 JSON（基线物理态=先落盘的 v2「未提交新态」；绝无半截/混合）
    const diskBody = JSON.parse(await readFile(pagePath, 'utf8')) as unknown;
    expect([v1Body, v2Body]).toContainEqual(diskBody);

    // GET 等价（store 层）：readPage 可读、page 元数据在；get 可读
    const page = await store.readPage(id, 'page-1');
    expect(page.ok).toBe(true);
    if (page.ok) {
      expect([v1Body, v2Body]).toContainEqual(page.value.body);
      expect(page.value.page.id).toBe('page-1');
    }
    const got = await store.get(id);
    expect(got.ok).toBe(true);

    // 列表 sizeBytes/pageCount 自洽：恰 1 个文档、pageCount=1、sizeBytes=manifest+正文字节合计
    const list = await store.list();
    expect(list.documents).toHaveLength(1);
    expect(list.warnings).toEqual([]);
    const summary = list.documents[0];
    expect(summary?.id).toBe(id);
    expect(summary?.pageCount).toBe(1);
    const manifestSize = (await stat(manifestPath)).size;
    const pageSize = (await stat(pagePath)).size;
    expect(summary?.sizeBytes).toBe(manifestSize + pageSize);
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
