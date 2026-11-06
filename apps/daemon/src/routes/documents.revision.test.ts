// vt:fast（纯 inject，无真实网络/磁盘等待）
/**
 * documents 路由 · 保存冲突检测（audit-d06 · D-05，设计决策 Q2=A：409 拒绝 + 手动刷新）。
 *
 * 缺陷现场（J8 审计实证，~/df-evidence/audit-2026-11/e2e/journeys/J8/）：同一文档
 * 双页先后保存均 200、无 409——后写者以旧基线整页覆盖先写者的更新，静默丢数据
 * （last-write-wins）。本组用例锁住修复后的对外行为：
 *
 * - **条件保存**：PUT/POST 带 `If-Match: <revision>` 时，daemon 在提交锁内比对 manifest
 *   版本——不匹配即 409 `doc_revision_conflict`，既有正文与版本**不变**（不落盘）；
 * - **向后兼容（硬约束）**：**不带版本头**的请求走旧行为（last-write-wins 直接落盘）——
 *   旧客户端不破；
 * - **恢复路径**：冲突后按最新 revision 重试（先刷新再保存）成功——手动刷新即可继续工作；
 * - **公共 API 形状不变**：成功/失败仍是 `{ok,result,error}` 信封（audit 计划 §3 非目标：
 *   信封形状不动，新增字段只出现在 result 内部）。
 *
 * revision 语义：即 manifest.version（每次结构变更自增的单调整数）；测试刻意用**裸字符串
 * 断言码与头名**（不经 contracts 常量），保证契约常量与线上行为中的字面量被双向钉住。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isDfgManifest } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';

import type { TestDaemon } from '../testing/harness.ts';
import { createTestDaemon, injectJson } from '../testing/harness.ts';

/** 建一个文档并返回 { id, revision }（失败即测试失败）。 */
async function createDocument(
  daemon: TestDaemon,
  name = '冲突检测文档',
): Promise<{ id: string; revision: number }> {
  const created = await injectJson(daemon.app, {
    method: 'POST',
    url: '/documents',
    payload: { name },
  });
  expect(created.statusCode).toBe(201);
  const document = (created.payload as { result: { document: { id: string; revision: number } } })
    .result.document;
  return { id: document.id, revision: document.revision };
}

/** 读当前文档 revision（GET 详情）。 */
async function readRevision(daemon: TestDaemon, documentId: string): Promise<number> {
  const detail = await injectJson(daemon.app, {
    method: 'GET',
    url: `/documents/${encodeURIComponent(documentId)}`,
  });
  expect(detail.statusCode).toBe(200);
  return (detail.payload as { result: { document: { revision: number } } }).result.document
    .revision;
}

/** 条件保存一页（带 If-Match 头）。 */
function savePageWithMatch(
  daemon: TestDaemon,
  documentId: string,
  pageId: string,
  body: unknown,
  ifMatch: string,
): ReturnType<typeof injectJson> {
  return injectJson(daemon.app, {
    method: 'PUT',
    url: `/documents/${encodeURIComponent(documentId)}/pages/${encodeURIComponent(pageId)}`,
    payload: { body },
    headers: { 'if-match': ifMatch },
  });
}

describe('documents · 保存冲突检测（audit-d06 · D-05）', () => {
  it('向后兼容钉：不带版本头的保存走旧行为（last-write-wins），文档被他人改过后仍 200', async () => {
    const daemon = await createTestDaemon();
    try {
      const { id } = await createDocument(daemon);
      const url = `/documents/${encodeURIComponent(id)}/pages/page-1`;
      // 「窗口 1」保存基线 A
      const first = await injectJson(daemon.app, {
        method: 'PUT',
        url,
        payload: { body: { v: '窗口1-基线' } },
      });
      expect(first.statusCode).toBe(200);
      // 「窗口 2」（无版本头的旧客户端）在他人已写入后保存基线 B：旧行为=直接覆盖
      const legacy = await injectJson(daemon.app, {
        method: 'PUT',
        url,
        payload: { body: { v: '窗口2-旧客户端' } },
      });
      expect(legacy.statusCode).toBe(200);
      const readBack = await injectJson(daemon.app, { method: 'GET', url });
      expect((readBack.payload as { result: { body: { v: string } } }).result.body.v).toBe(
        '窗口2-旧客户端',
      );
    } finally {
      await daemon.cleanup();
    }
  });

  it('J8 场景：双「窗口」先后条件保存——后写者（旧基线）收到 409 doc_revision_conflict，先写者不被覆盖', async () => {
    const daemon = await createTestDaemon();
    try {
      const { id, revision } = await createDocument(daemon);
      // 两个窗口都基于 revision 载入（J8：双页同文档）
      const url = `/documents/${encodeURIComponent(id)}/pages/page-1`;
      // 「窗口 1」条件保存成功 → 200，revision 前进
      const first = await savePageWithMatch(
        daemon,
        id,
        'page-1',
        { v: '窗口1-位移' },
        String(revision),
      );
      expect(first.statusCode).toBe(200);
      const firstBody = first.payload as { result: { revision: number; page: { id: string } } };
      expect(firstBody.result.revision).toBe(revision + 1);
      expect(firstBody.result.page.id).toBe('page-1');
      // 「窗口 2」仍持旧基线保存 → 409（修复前：200 静默覆盖）
      const second = await savePageWithMatch(
        daemon,
        id,
        'page-1',
        { v: '窗口2-旧基线整页' },
        String(revision),
      );
      expect(second.statusCode).toBe(409);
      const failure = (
        second.payload as { error: { code: string; details?: Record<string, unknown> } }
      ).error;
      expect(failure.code).toBe('doc_revision_conflict');
      expect(failure.details).toMatchObject({
        expectedRevision: revision,
        currentRevision: revision + 1,
      });
      // 先写者的内容原样保留（静默覆盖不再发生）；manifest 版本未再前进
      const readBack = await injectJson(daemon.app, { method: 'GET', url });
      expect(readBack.statusCode).toBe(200);
      expect((readBack.payload as { result: { body: { v: string } } }).result.body.v).toBe(
        '窗口1-位移',
      );
      const manifest = isDfgManifest(
        JSON.parse(
          await readFile(join(daemon.workspaceDir, `${id}.dfg`, 'manifest.json'), 'utf8'),
        ) as unknown,
      );
      expect(manifest).toBe(true);
      expect(
        (
          JSON.parse(
            await readFile(join(daemon.workspaceDir, `${id}.dfg`, 'manifest.json'), 'utf8'),
          ) as { version: number }
        ).version,
      ).toBe(revision + 1);
    } finally {
      await daemon.cleanup();
    }
  });

  it('恢复路径：冲突后刷新（读最新 revision）再条件保存 → 200', async () => {
    const daemon = await createTestDaemon();
    try {
      const { id, revision } = await createDocument(daemon);
      // 他人先写
      const first = await savePageWithMatch(daemon, id, 'page-1', { v: '先写' }, String(revision));
      expect(first.statusCode).toBe(200);
      // 本窗口旧基线 → 409
      const stale = await savePageWithMatch(
        daemon,
        id,
        'page-1',
        { v: '旧基线' },
        String(revision),
      );
      expect(stale.statusCode).toBe(409);
      // 手动刷新：读最新 revision，再保存 → 成功
      const latest = await readRevision(daemon, id);
      expect(latest).toBe(revision + 1);
      const retry = await savePageWithMatch(
        daemon,
        id,
        'page-1',
        { v: '刷新后再保存' },
        String(latest),
      );
      expect(retry.statusCode).toBe(200);
      expect((retry.payload as { result: { revision: number } }).result.revision).toBe(latest + 1);
      const readBack = await injectJson(daemon.app, {
        method: 'GET',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
      });
      expect((readBack.payload as { result: { body: { v: string } } }).result.body.v).toBe(
        '刷新后再保存',
      );
    } finally {
      await daemon.cleanup();
    }
  });

  it('条件保存命中当前 revision → 200（无冲突不误伤）；GET 读页响应带 revision', async () => {
    const daemon = await createTestDaemon();
    try {
      const { id, revision } = await createDocument(daemon);
      const read = await injectJson(daemon.app, {
        method: 'GET',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
      });
      expect(read.statusCode).toBe(200);
      expect((read.payload as { result: { revision: number } }).result.revision).toBe(revision);
      const saved = await savePageWithMatch(daemon, id, 'page-1', { v: 1 }, String(revision));
      expect(saved.statusCode).toBe(200);
    } finally {
      await daemon.cleanup();
    }
  });

  it('建页也受条件保存保护：旧基线建页 → 409；带引号实体标签形态（"N"）同样接受', async () => {
    const daemon = await createTestDaemon();
    try {
      const { id, revision } = await createDocument(daemon);
      // 他人先写一页（revision 前进）
      const first = await savePageWithMatch(daemon, id, 'page-1', { v: 1 }, `"${revision}"`);
      expect(first.statusCode).toBe(200);
      // 旧基线建页 → 409（不静默追加到他人已修改的文档上）
      const staleCreate = await injectJson(daemon.app, {
        method: 'POST',
        url: `/documents/${encodeURIComponent(id)}/pages`,
        payload: { name: '旧基线新页', id: 'page-2' },
        headers: { 'if-match': String(revision) },
      });
      expect(staleCreate.statusCode).toBe(409);
      expect((staleCreate.payload as { error: { code: string } }).error.code).toBe(
        'doc_revision_conflict',
      );
      // 新基线建页 → 201，响应带 revision
      const latest = await readRevision(daemon, id);
      const create = await injectJson(daemon.app, {
        method: 'POST',
        url: `/documents/${encodeURIComponent(id)}/pages`,
        payload: { name: '新页', id: 'page-2' },
        headers: { 'if-match': `"${latest}"` },
      });
      expect(create.statusCode).toBe(201);
      expect((create.payload as { result: { revision: number } }).result.revision).toBe(latest + 1);
    } finally {
      await daemon.cleanup();
    }
  });

  it('非法 If-Match 头（非 revision 整数）→ 400 bad_request；`*` 通配同样拒绝', async () => {
    const daemon = await createTestDaemon();
    try {
      const { id } = await createDocument(daemon);
      for (const bad of ['abc', '*', '1.5', '""']) {
        const saved = await savePageWithMatch(daemon, id, 'page-1', { v: 1 }, bad);
        expect(saved.statusCode, `If-Match=${bad} 应 400`).toBe(400);
        expect((saved.payload as { error: { code: string } }).error.code).toBe('bad_request');
      }
    } finally {
      await daemon.cleanup();
    }
  });
});
