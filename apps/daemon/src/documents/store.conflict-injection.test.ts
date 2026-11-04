/**
 * @dforge/daemon · 文档存储 409 冲突确定性注入档（TC-DOC-07 · store 层守护回归）。
 *
 * 真源口径：docs/quality/fullstack-test-design-2026-11-03.md TC-DOC-07 行——
 * 跨进程并发写预期「每请求要么 200（写后重读比对一致）要么 409 {code:'conflict'}
 * （重试 3 次用尽）」。既有进程级用例（routes/documents.process.test.ts）在快盘上
 * 40 并发 conflict=0（企业报告 §4/E2 已知缺口），409 信封分支无确定性覆盖；
 * 本用例在 store 层用故障注入把「重试用尽 → conflict」分支钉成确定性绿。
 *
 * 注入缝选择（对照票面「优先 mock manifest 读取」的权衡，已登记）：
 * - 目标效果是票面给定的「manifest 读取恒返回写入前内容」→ 写后重读比对持续失效；
 * - 若只 mock 读侧（readJsonFileOrNull 恒返回旧内容）而写侧真实落盘，3 次尝试后
 *   盘上 manifest 会物理前进到第 3 次写入——与验收断言「正文 v2 未成为已提交态」
 *   （manifest 是提交点）矛盾，也不符合被模拟物理（ rival 若令读为旧，盘上必是 rival 版本）；
 * - 故缝选 fs-atomic 的 writeFileAtomic 且只作用于 manifest 路径：注入窗内该写入被
 *   透明吞掉（确定性模拟「rival 进程恒胜出、盘上恒是它自己的版本」）→ 真实 fs 读取
 *   恒返回写入前字节（票面目标效果成立）→ 比对持续失效 ×3 → conflict。
 *   `MAX_COMMIT_ATTEMPTS` 常量语义未被改动（票面明确禁止）。
 *
 * 断言↔缺陷形态对照（守护的意义）：
 * - conflict 分支被改（如重试用尽仍返回 ok / 丢弃重试直接 200）→ 信封断言红；
 * - 有界重试被改成无界重试或次数语义变化 → 被吞写入次数 ≠ 3 红；
 * - 失败路径污染 manifest（非原子写 / 重试写半截）→ 字节逐位一致断言红；
 * - 提交点错位（manifest 未提交却宣称成功 / 正文被标记已提交）→ 页元数据未前进断言红。
 *
 * 注：盘上正文在失败后是完整的 v2（正文先落盘、manifest 最后更新的合法中间态，
 * TC-DOC-05 明确合法；同族先例 store.commit-order.test.ts 同口径断言不变量）。
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DF_ERROR_HTTP_STATUS } from '@dforge/contracts';
import { expect, it, vi } from 'vitest';

import { createConfigStore } from '../config/store.ts';
import { createDocumentStore } from './store.ts';

const conflictInjection = vi.hoisted(() => ({
  /** 注入窗内被透明吞掉的 manifest 写入目标路径；null = 未注入（写入全部真实落盘）。 */
  swallowedManifestPath: null as string | null,
  /** 已吞掉的 manifest 写入次数（= 有界重试次数的物理证据）。 */
  swallowedWrites: 0,
  /** 全部 writeFileAtomic 落点观测日志（用于取 store 内部 resolveWithin 产出的真实路径）。 */
  writePaths: [] as string[],
}));

vi.mock('../fs-atomic.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fs-atomic.ts')>();
  return {
    ...actual,
    writeFileAtomic: async (...args: Parameters<typeof actual.writeFileAtomic>) => {
      const filePath = args[0];
      conflictInjection.writePaths.push(filePath);
      if (
        conflictInjection.swallowedManifestPath !== null &&
        filePath === conflictInjection.swallowedManifestPath
      ) {
        // rival 恒胜出：本次 manifest 写入不生效，磁盘保持注入前字节（读取随之恒旧）
        conflictInjection.swallowedWrites += 1;
        return undefined;
      }
      return actual.writeFileAtomic(...args);
    },
  };
});

it('TC-DOC-07 · store 层注入：写后重读比对持续失效 ×3 → conflict(409) 信封、manifest 字节未破坏、v2 未成已提交态', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'df-doc07-'));
  const workspaceDir = join(tempDir, 'workspace');
  try {
    const config = createConfigStore({
      configJsonPath: join(tempDir, 'config.json'),
      defaultWorkspaceDir: workspaceDir,
    });
    await config.load();
    const store = createDocumentStore({ config });

    // v1 基线：create（version=1）+ savePage v1={mark:1}（version=2；manifest 两次真实落盘）
    const created = await store.create('并发冲突注入');
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unreachable');
    const id = created.value.id;
    const v1Body = { mark: 1 };
    const savedV1 = await store.savePage(id, 'page-1', v1Body);
    expect(savedV1.ok).toBe(true);
    if (!savedV1.ok) throw new Error('unreachable');

    // manifest 落点取自写入观测日志（store 内部经 resolveWithin 产出；mock 匹配不自行拼路径）
    const manifestPath = [...conflictInjection.writePaths]
      .reverse()
      .find((path) => path.endsWith('/manifest.json'));
    if (manifestPath === undefined) throw new Error('unreachable: 观测日志无 manifest 写入');
    const pagePath = join(workspaceDir, `${id}.dfg`, 'pages', 'page-1.json');
    const manifestBefore = await readFile(manifestPath, 'utf8');

    // 注入：窗内 manifest 写入被吞（rival 恒胜出）→ 写后重读（真实 fs）恒返回写入前内容
    conflictInjection.swallowedManifestPath = manifestPath;
    const v2Body = { mark: 2 };
    const conflicted = await store.savePage(id, 'page-1', v2Body);
    conflictInjection.swallowedManifestPath = null; // 解除注入（比对恢复真实）

    // ① conflict(409) 信封：3 次尝试全失效（路由层 sendFail 据此回 409 {code:'conflict'}）
    expect(conflicted.ok).toBe(false);
    if (conflicted.ok) throw new Error('unreachable');
    expect(conflicted.code).toBe('conflict');
    expect(conflicted.message).toContain('重试 3 次');
    expect(conflicted.details).toEqual({ documentId: id });
    // 409 语义钉死：contracts 的错误码 → HTTP 状态映射 conflict → 409
    expect(DF_ERROR_HTTP_STATUS.conflict).toBe(409);

    // ② 有界重试物理证据：恰 3 次 manifest 写入被吞（MAX_COMMIT_ATTEMPTS=3 语义未改）
    expect(conflictInjection.swallowedWrites).toBe(3);

    // ③ manifest 字节未被破坏：与注入前逐字节一致（失败的写不碰提交点，无半截/污染）
    const manifestAfter = await readFile(manifestPath, 'utf8');
    expect(manifestAfter).toBe(manifestBefore);

    // ④ 正文 v2 未成为已提交态：manifest（提交点）未记录本次写入——页元数据停在 v1 提交值
    const readBack = await store.readPage(id, 'page-1');
    expect(readBack.ok).toBe(true);
    if (!readBack.ok) throw new Error('unreachable');
    expect(readBack.value.page.updatedAt).toBe(savedV1.value.updatedAt);
    // 盘上正文 = 写前落盘的完整 v2（TC-DOC-05 合法中间态；绝无半截/混合）
    const diskBody = JSON.parse(await readFile(pagePath, 'utf8')) as unknown;
    expect([v1Body, v2Body]).toContainEqual(diskBody);

    // ⑤ 终态自洽（TC-DOC-07 口径）：列表恰 1 文档、pageCount=1、sizeBytes 自洽
    const list = await store.list();
    expect(list.documents).toHaveLength(1);
    expect(list.warnings).toEqual([]);
    const summary = list.documents[0];
    expect(summary?.id).toBe(id);
    expect(summary?.pageCount).toBe(1);
    const manifestSize = (await stat(manifestPath)).size;
    const pageSize = (await stat(pagePath)).size;
    expect(summary?.sizeBytes).toBe(manifestSize + pageSize);

    // ⑥ 冲突路径不楔死 store：解除 rival 后同页可正常提交（重试状态/锁/临时文件无残留影响）
    const recovered = await store.savePage(id, 'page-1', { mark: 3 });
    expect(recovered.ok).toBe(true);
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
