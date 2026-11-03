/**
 * @dforge/daemon · 文档存储进程级集成档（TC-DOC-05/07/10 · 守护回归）。
 *
 * 与 inject 档（documents.test.ts / documents.security.test.ts）互补：这里 spawn **真子进程**
 * daemon（`node --experimental-strip-types src/main.ts`，临时数据根 + 空闲端口，远离 3000/4318），
 * 验证只有真实多进程/真实崩溃才能暴露的语义：
 * - TC-DOC-05：写入中途 SIGKILL —— 原子写 +「manifest 是提交点」的崩溃恢复契约；
 * - TC-DOC-07：同 workspace 双进程并发写 —— 写后重读比对 + 有界重试的 `conflict`(409) 收敛；
 * - TC-DOC-10：双进程并发同名建文档 —— 非递归 mkdir EEXIST 的原子冲突（恰 1 个 201）。
 *
 * 纪律（docs/agents/implementation-workflow.md）：子进程只按精确 PID 回收（禁 pkill -f 模式杀）；
 * 收工前核对子进程全部退出；POSIX-only（SIGKILL 故障注入无 Windows 口径）。
 */

import type { ChildProcessByStdio } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const DAEMON_MAIN = fileURLToPath(new URL('../main.ts', import.meta.url));
const IS_POSIX = process.platform !== 'win32';

/** spawn 出来的 daemon 子进程形态（stdin=ignore，stdout/stderr=pipe）。 */
type DaemonChild = ChildProcessByStdio<null, Readable, Readable>;

/** 取一个空闲端口（先 listen 0 再关；先例：scripts/lib/gates.mjs freePort）。 */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

interface SpawnedDaemon {
  child: DaemonChild;
  port: number;
  baseUrl: string;
}

/** 全体存活子进程登记（finally 兜底回收；只按精确 PID kill）。 */
const liveChildren = new Set<DaemonChild>();

/** 起一个真子进程 daemon 并等 /health 就绪（数据根/工作目录/端口全注入，不碰真实 ~/.dforge）。 */
async function spawnDaemon(options: {
  dataRoot: string;
  workspaceDir: string;
}): Promise<SpawnedDaemon> {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      DAEMON_MAIN,
      `--data-root=${options.dataRoot}`,
      `--workspace=${options.workspaceDir}`,
      `--port=${port}`,
      '--host=127.0.0.1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  liveChildren.add(child);
  let output = '';
  child.stderr.on('data', (chunk: Buffer) => {
    output += String(chunk);
  });

  // 就绪判定：stdout 打印 `[daemon] listening on http://host:port`（startDaemon 探测后实际落点，
  // 可能与请求端口不同——以实际 URL 为准），再等 /health 200。
  const baseUrl = await new Promise<string>((resolveUrl, rejectUrl) => {
    const timer = setTimeout(
      () => rejectUrl(new Error(`daemon 启动超时：${output.slice(-2000)}`)),
      30_000,
    );
    child.on('exit', (code) =>
      rejectUrl(new Error(`daemon 提前退出（code=${code}）：${output.slice(-2000)}`)),
    );
    const onData = (chunk: Buffer): void => {
      output += String(chunk);
      const match = /\[daemon\] listening on (http:\/\/[^\s]+)/.exec(output);
      const url = match?.[1];
      if (url !== undefined) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolveUrl(url);
      }
    };
    child.stdout.on('data', onData);
  });

  // /health 就绪（应用工厂异步装配完成后才可服务）
  const deadline = Date.now() + 15_000;
  for (;;) {
    const health = await fetch(`${baseUrl}/health`).then(
      (res) => res.status,
      () => null,
    );
    if (health === 200) break;
    if (Date.now() > deadline) {
      throw new Error(`daemon /health 未就绪：${output.slice(-2000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const address = new URL(baseUrl);
  return {
    child,
    port: Number(address.port),
    baseUrl,
  };
}

/** 按精确 PID 回收：SIGTERM 优雅关 → 超时 SIGKILL；已退出则直接通过。 */
async function stopDaemon(daemon: SpawnedDaemon): Promise<void> {
  const { child } = daemon;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const grace = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    await Promise.race([grace, timeout]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', () => resolve());
  });
  liveChildren.delete(child);
}

/** 兜底：SIGKILL 所有仍存活的子进程（精确 PID），避免污染后续测试。 */
async function killAllLive(): Promise<void> {
  for (const child of liveChildren) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await Promise.all(
    [...liveChildren].map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once('exit', () => resolve());
        }),
    ),
  );
  liveChildren.clear();
}

/** 核对端口确已释放（收工纪律：测试完核对端口释放；带有界重试防 TIME_WAIT 抖动）。 */
async function expectPortReleased(port: number): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const released = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (released) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`端口 ${port} 未释放（子进程回收不彻底）`);
}

/** JSON POST/PUT 便捷（fetch 走真实 socket）。 */
async function jsonRequest(
  baseUrl: string,
  method: 'POST' | 'PUT',
  path: string,
  payload: unknown,
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

/** GET JSON 便捷。 */
async function jsonGet(baseUrl: string, path: string): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${baseUrl}${path}`);
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

describe.skipIf(!IS_POSIX)('documents · 进程级崩溃恢复（TC-DOC-05 · 守护回归）', () => {
  it('写入中途 SIGKILL ×10 轮：manifest/page 恒为完整 JSON，读侧只见一致旧态或一致新态，残留 tmp 不污染读写', {
    timeout: 300_000,
  }, async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'df-doc05-'));
    const dataRoot = join(tempRoot, 'data');
    const workspaceDir = join(dataRoot, 'workspace');
    // tp1-fix 评审发现②：spawnDaemon 启动超时/提前退出会在进入回收 try 之前抛错——子进程已登记
    // liveChildren 却无人回收，tempRoot 也泄漏。spawn 调用与包体一并外套兜底 try/finally：
    // killAllLive() 按精确 PID SIGKILL 全体存活子进程（优雅回收后为空集 no-op），rm 下沉兜底层。
    try {
      let daemon = await spawnDaemon({ dataRoot, workspaceDir });
      const rounds: {
        round: number;
        delayMs: number;
        http: number | null;
        version: number;
        mark: string;
      }[] = [];
      try {
        // 前置：已建文档并成功保存 v1 正文
        const created = await jsonRequest(daemon.baseUrl, 'POST', '/documents', {
          name: '崩溃恢复',
        });
        expect(created.status).toBe(201);
        const id = (created.json as { result: { document: { id: string } } }).result.document.id;
        const v1Body = { mark: 'v1', pad: 'v1'.repeat(512) };
        const savedV1 = await jsonRequest(
          daemon.baseUrl,
          'PUT',
          `/documents/${encodeURIComponent(id)}/pages/page-1`,
          { body: v1Body },
        );
        expect(savedV1.status).toBe(200);
        const docDir = join(workspaceDir, `${id}.dfg`);

        // ①② 大正文 PUT + 写入中途 SIGKILL（随机延迟 5–80ms，重复 10 轮）
        // 注：真源要求「数 MB 正文扩大写入窗口」，但 daemon 基线沿用 Fastify 默认 bodyLimit=1MiB
        // （超限 → 413 → 统一信封 400，写入根本不发生，故障注入落空）——守护票不改产品代码，
        // 取限内最大正文 ≈1.02MB 达成同一目的；写入窗口毫秒级，10 轮 5–80ms 抖动覆盖
        // 提交前/中/后三种相位（命中相位随机器而异，断言只认「任一相位下状态恒一致」）。
        let prevVersion = 2; // v1 已提交 → manifest.version === 2
        const writtenBodies: unknown[] = [v1Body];
        for (let round = 1; round <= 10; round += 1) {
          if (round > 1) daemon = await spawnDaemon({ dataRoot, workspaceDir });
          const v2Body = { mark: `v2-r${round}`, pad: 'x'.repeat(1_020_000) };
          writtenBodies.push(v2Body);
          const inFlight = jsonRequest(
            daemon.baseUrl,
            'PUT',
            `/documents/${encodeURIComponent(id)}/pages/page-1`,
            { body: v2Body },
          ).then(
            (res) => res.status,
            () => null, // 连接随进程被杀 → fetch 拒绝（预期形态之一，不算失败）
          );
          const delayMs = 5 + Math.floor(Math.random() * 76);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          daemon.child.kill('SIGKILL'); // 精确 PID，禁 pkill -f
          await new Promise<void>((resolve) => daemon.child.once('exit', () => resolve()));
          liveChildren.delete(daemon.child);
          const httpStatus = await inFlight;

          // 每轮杀完直接读盘：manifest 与正文必须是完整 JSON（绝无半截文件）
          const manifest = JSON.parse(await readFile(join(docDir, 'manifest.json'), 'utf8')) as {
            version: number;
            pages: { id: string }[];
          };
          const body = JSON.parse(await readFile(join(docDir, 'pages', 'page-1.json'), 'utf8')) as {
            mark: string;
          };
          // 单进程单 PUT：version 每轮至多 +1（提交 0 或 1 次）
          expect(manifest.version).toBeGreaterThanOrEqual(prevVersion);
          expect(manifest.version).toBeLessThanOrEqual(prevVersion + 1);
          if (manifest.version === prevVersion + 1) {
            // 本轮已提交（manifest 是提交点）→ 正文必须是本轮完整新态：绝无「version 已进、正文还是旧态」的错位
            expect(body).toEqual(v2Body);
          } else {
            // 未提交 → 正文可以是旧态或任一轮已落盘但未提交的新态（完整即可，绝不混合）
            expect(writtenBodies).toContainEqual(body);
          }
          prevVersion = manifest.version;
          rounds.push({
            round,
            delayMs,
            http: httpStatus,
            version: manifest.version,
            mark: body.mark,
          });
        }

        // ③ 同数据根重启 daemon
        daemon = await spawnDaemon({ dataRoot, workspaceDir });

        // ④ GET manifest 与 page-1（API 读侧）：均可解析、正文 ∈ 已写集合、无 version↔正文错位
        // （manifest.json 是提交点，version 以盘上 manifest 为准——DocumentSummary 不含 version）
        const got = await jsonGet(daemon.baseUrl, `/documents/${encodeURIComponent(id)}`);
        expect(got.status).toBe(200);
        const summary = (got.json as { result: { document: { pageCount: number } } }).result
          .document;
        expect(summary.pageCount).toBe(1);
        const finalManifest0 = JSON.parse(
          await readFile(join(docDir, 'manifest.json'), 'utf8'),
        ) as {
          version: number;
        };
        expect(finalManifest0.version).toBe(prevVersion);
        const page = await jsonGet(
          daemon.baseUrl,
          `/documents/${encodeURIComponent(id)}/pages/page-1`,
        );
        expect(page.status).toBe(200);
        const readBody = (page.json as { result: { body: { mark: string } } }).result.body;
        expect(writtenBodies).toContainEqual(readBody);
        if (finalManifest0.version > 2) {
          // 有过提交 → 读侧正文必须是 v2 形态（绝无「版本已进、正文回旧态」）
          expect(readBody.mark.startsWith('v2')).toBe(true);
        }

        // ⑤ ls .dfg/ 与 pages/：允许 `.<hex>.tmp` 残留，但读侧/列表/后续写全部不受影响
        const docEntries = await readdir(docDir);
        expect(docEntries).toContain('manifest.json');
        expect(docEntries).toContain('pages');
        const pageEntries = await readdir(join(docDir, 'pages'));
        expect(pageEntries).toContain('page-1.json');
        const tmpRemnants = pageEntries.filter((entry) => /^\.[0-9a-f]+\.tmp$/.test(entry));
        const list = await jsonGet(daemon.baseUrl, '/documents');
        expect((list.json as { result: { documents: unknown[] } }).result.documents).toHaveLength(
          1,
        );

        // 后续写完全不受影响：再执行一次 PUT+GET
        const finalBody = { mark: 'final', pad: 'final'.repeat(512) };
        const finalPut = await jsonRequest(
          daemon.baseUrl,
          'PUT',
          `/documents/${encodeURIComponent(id)}/pages/page-1`,
          { body: finalBody },
        );
        expect(finalPut.status).toBe(200);
        const finalRead = await jsonGet(
          daemon.baseUrl,
          `/documents/${encodeURIComponent(id)}/pages/page-1`,
        );
        expect((finalRead.json as { result: { body: unknown } }).result.body).toEqual(finalBody);
        const finalManifest = JSON.parse(await readFile(join(docDir, 'manifest.json'), 'utf8')) as {
          version: number;
        };
        expect(finalManifest.version).toBe(prevVersion + 1);

        // 证据行（测试输出即证据，收口到 ~/df-evidence/tp1-04/）
        console.log(
          `[TC-DOC-05] rounds=${JSON.stringify(rounds)} tmpRemnants=${tmpRemnants.length}`,
        );
      } finally {
        await stopDaemon(daemon);
        await expectPortReleased(daemon.port);
      }
    } finally {
      await killAllLive();
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe.skipIf(!IS_POSIX)('documents · 跨进程并发写（TC-DOC-07 · 守护回归）', () => {
  it('同 workspace 双进程各 20×PUT（Promise.all 全并发）：每请求仅 200/409{conflict}，终态=一次完整提交且 version 与成功次数自洽', {
    timeout: 120_000,
  }, async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'df-doc07-'));
    const workspaceDir = join(tempRoot, 'workspace'); // 两进程共享
    const dataRootA = join(tempRoot, 'data-a'); // 数据根各自独立（遥测/配置互不干扰）
    const dataRootB = join(tempRoot, 'data-b');
    // tp1-fix 评审发现②：spawnDaemon 启动超时/提前退出会在进入回收 try 之前抛错——子进程已登记
    // liveChildren 却无人回收，tempRoot 也泄漏。spawn 调用与包体一并外套兜底 try/finally：
    // killAllLive() 按精确 PID SIGKILL 全体存活子进程（优雅回收后为空集 no-op），rm 下沉兜底层。
    try {
      const daemonA = await spawnDaemon({ dataRoot: dataRootA, workspaceDir });
      const daemonB = await spawnDaemon({ dataRoot: dataRootB, workspaceDir });
      try {
        // 前置：同一文档同页 page-1（经 A 创建，manifest version=1）
        const created = await jsonRequest(daemonA.baseUrl, 'POST', '/documents', {
          name: '并发 409',
        });
        expect(created.status).toBe(201);
        const id = (created.json as { result: { document: { id: string } } }).result.document.id;
        const pageUrl = `/documents/${encodeURIComponent(id)}/pages/page-1`;

        // ① A/B 各循环 20 次 PUT（正文带进程标记+序号，互不相同），Promise.all 全并发
        const submissions = [
          ...Array.from({ length: 20 }, (_unused, index) => ({
            process: 'A' as const,
            baseUrl: daemonA.baseUrl,
            body: { marker: `proc-A-#${index}`, pad: 'a'.repeat(2048) },
          })),
          ...Array.from({ length: 20 }, (_unused, index) => ({
            process: 'B' as const,
            baseUrl: daemonB.baseUrl,
            body: { marker: `proc-B-#${index}`, pad: 'b'.repeat(2048) },
          })),
        ];
        const responses = await Promise.all(
          submissions.map(async (submission) => {
            const result = await jsonRequest(submission.baseUrl, 'PUT', pageUrl, {
              body: submission.body,
            });
            return { submission, result };
          }),
        );

        // ② 每个请求要么 200 要么 409 {code:'conflict'}（写后重读比对 + 有界重试用尽），无其他码、无悬挂
        let successCount = 0;
        for (const { result } of responses) {
          expect([200, 409]).toContain(result.status);
          if (result.status === 200) {
            successCount += 1;
          } else {
            expect(
              (result.json as { error: { code: string } }).error.code,
              JSON.stringify(result.json),
            ).toBe('conflict');
          }
        }
        expect(successCount).toBeGreaterThan(0); // 至少一次完整提交（终态必须落在提交态上）

        // ③ 终态 GET：最终正文=某一次完整写入（恰为 40 份互异正文之一，绝无两进程内容混合）；
        // manifest version 与成功提交次数自洽：version ∈ [2, 1+成功数]——
        // 基线的写后重读比对按「内容一致」确认，两写者同基读时后写者 confirm 读到自己的
        // 内容即算成功（过期覆盖），会吞掉先写者的自增；因此跨进程下 version 不恒等于
        // 1+成功数，但必 ≥2（最后一次写入恒属于成功者：失败者的 confirm 失败⇒其后还有写入）
        // 且被成功数封顶（每次成功至多贡献一次自增）。
        const finalRead = await jsonGet(daemonA.baseUrl, pageUrl);
        expect(finalRead.status).toBe(200);
        const finalBody = (finalRead.json as { result: { body: unknown } }).result.body;
        expect(submissions.map((submission) => submission.body)).toContainEqual(finalBody);
        const manifest = JSON.parse(
          await readFile(join(workspaceDir, `${id}.dfg`, 'manifest.json'), 'utf8'),
        ) as { version: number };
        expect(manifest.version).toBeGreaterThanOrEqual(2);
        expect(manifest.version).toBeLessThanOrEqual(1 + successCount);
        console.log(`[TC-DOC-07] total=40 success=${successCount} conflict=${40 - successCount}`);
      } finally {
        await stopDaemon(daemonA);
        await stopDaemon(daemonB);
        await expectPortReleased(daemonA.port);
        await expectPortReleased(daemonB.port);
      }
    } finally {
      await killAllLive();
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe.skipIf(!IS_POSIX)('documents · 双进程并发建文档（TC-DOC-10 · 守护回归）', () => {
  it('双进程并发同名 POST：恰 1 个 201、其余 409 doc_exists，磁盘仅一个 <id>.dfg 且 manifest 完整', {
    timeout: 120_000,
  }, async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'df-doc10-'));
    const workspaceDir = join(tempRoot, 'workspace');
    // tp1-fix 评审发现②：spawnDaemon 启动超时/提前退出会在进入回收 try 之前抛错——子进程已登记
    // liveChildren 却无人回收，tempRoot 也泄漏。spawn 调用与包体一并外套兜底 try/finally：
    // killAllLive() 按精确 PID SIGKILL 全体存活子进程（优雅回收后为空集 no-op），rm 下沉兜底层。
    try {
      const daemonA = await spawnDaemon({ dataRoot: join(tempRoot, 'data-a'), workspaceDir });
      const daemonB = await spawnDaemon({ dataRoot: join(tempRoot, 'data-b'), workspaceDir });
      try {
        // 双进程变体（同 DF_WORKSPACE_DIR、端口错开）：各 1×POST 同名文档，全并发
        const [resA, resB] = await Promise.all([
          jsonRequest(daemonA.baseUrl, 'POST', '/documents', { name: '并发文档' }),
          jsonRequest(daemonB.baseUrl, 'POST', '/documents', { name: '并发文档' }),
        ]);

        const statuses = [resA.status, resB.status].sort((a, b) => a - b);
        expect(statuses).toEqual([201, 409]); // 恰 1 个 201，其余全部 409
        const conflict = resA.status === 409 ? resA : resB;
        expect((conflict.json as { error: { code: string } }).error.code).toBe('doc_exists');

        // 磁盘仅一个 <id>.dfg 目录且 manifest 完整可读（默认页齐全）
        const entries = await readdir(workspaceDir);
        expect(entries).toEqual(['并发文档.dfg']);
        const manifest = JSON.parse(
          await readFile(join(workspaceDir, '并发文档.dfg', 'manifest.json'), 'utf8'),
        ) as { version: number; pages: { id: string }[] };
        expect(manifest.version).toBe(1);
        expect(manifest.pages.map((page) => page.id)).toEqual(['page-1']);
        expect(
          await readFile(join(workspaceDir, '并发文档.dfg', 'pages', 'page-1.json'), 'utf8'),
        ).toBe('{}\n');
      } finally {
        await stopDaemon(daemonA);
        await stopDaemon(daemonB);
        await expectPortReleased(daemonA.port);
        await expectPortReleased(daemonB.port);
      }
    } finally {
      await killAllLive();
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
