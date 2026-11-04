/**
 * daemon 基址解析（门禁侧唯一入口，arch-05）。
 *
 * 背景（已取证缺陷）：`verify-figma-inspect` / `verify-market` 把
 * `DF_DAEMON_URL` 缺省写成 `http://127.0.0.1:4318`——4318 是**开发机真实例**的端口窗
 * 起点。门禁一旦按缺省跑，就会连上开发机在跑的 daemon 并读写真实数据根
 * （arch-04 实施中已发生：一次未受控的 inspect 门禁在真实例上建/删了一份临时文档）。
 *
 * 纪律（本 module 的唯一职责）：
 *   1. `DF_DAEMON_URL` **显式给定** → 照用（保留调试能力，日志写明「使用外部 daemon」）；
 *   2. **未给定** → **自起夹具 daemon**（临时数据根 + 空闲端口，复用
 *      `lib/gates.mjs` 的 `startFixtureDaemon`/`freePort`），用完必停（进程组精确回收 +
 *      核对端口释放 + 删临时目录）；
 *   3. 夹具起不来 → 抛 `DaemonFixtureError`，由门禁映射为 **exit 2 阻塞**并给明确文案；
 *      **不得**降级为连接本机实例。
 *
 * 本 module **没有**任何缺省 daemon 地址：不要在调用方再写 `?? 'http://...'`。
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startFixtureDaemon } from './gates.mjs';

/** 夹具不可用（门禁据此 exit 2；文案里不出现任何「缺省实例地址」）。 */
export class DaemonFixtureError extends Error {
  constructor(message, { cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DaemonFixtureError';
    this.code = 'daemon_fixture_unavailable';
  }
}

/** 探一次端口是否有人监听（`connect` 成功 = 在听）。 */
export function isPortListening(port, { host = '127.0.0.1', timeoutMs = 250 } = {}) {
  return new Promise((resolveListening) => {
    const socket = connect({ host, port });
    let settled = false;
    const settle = (listening) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveListening(listening);
    };
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
    socket.setTimeout(timeoutMs, () => settle(false));
  });
}

/**
 * 等端口释放（夹具 `close()` 后的核对项）。
 *
 * @param {number} port
 * @param {{ timeoutMs?: number, intervalMs?: number, isListening?: (port: number) => Promise<boolean> }} [options]
 * @returns {Promise<boolean>} true = 端口已释放
 */
export async function waitForPortRelease(
  port,
  { timeoutMs = 5000, intervalMs = 50, isListening = isPortListening } = {},
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!(await isListening(port))) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
  }
}

function safePrefix(label) {
  return String(label).replace(/[^a-zA-Z0-9._-]+/g, '-');
}

/**
 * 清临时根的删除口径（docs/agents/implementation-workflow.md 纪律）。
 *
 * 为什么必须可重试：夹具数据根里有 telemetry 追加写（`apps/daemon/src/context.ts`），
 * 目录可能在删除瞬间仍被写入；一次 ENOTEMPTY 不该留下静默残留。
 * `maxRetries`/`retryDelay` 由 `fs.rm` 内部重试承担（arch-fix2 发现 C）。
 */
export const TEMP_ROOT_RM_OPTIONS = Object.freeze({
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 50,
});

/**
 * 解析门禁要用的 daemon 基址：显式 env 优先，否则自起夹具。
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   label?: string,
 *   log?: (line: string) => void,
 *   start?: typeof startFixtureDaemon,
 *   mkdtempImpl?: (prefix: string) => Promise<string>,
 *   rmImpl?: (path: string) => Promise<void>,
 *   timeoutMs?: number,
 *   releaseTimeoutMs?: number,
 * }} [options]
 * @returns {Promise<{
 *   url: string,
 *   mode: 'external' | 'fixture',
 *   port: string | null,
 *   dataRoot: string | null,
 *   workspaceDir: string | null,
 *   close: () => Promise<{ released: boolean }>,
 * }>}
 */
export async function resolveDaemon({
  env = process.env,
  label = 'gate',
  log = (line) => console.error(line),
  start = startFixtureDaemon,
  mkdtempImpl = (prefix) => mkdtemp(join(tmpdir(), prefix)),
  rmImpl = (path) => rm(path, TEMP_ROOT_RM_OPTIONS),
  timeoutMs = 20_000,
  releaseTimeoutMs = 5000,
} = {}) {
  const explicit = typeof env.DF_DAEMON_URL === 'string' ? env.DF_DAEMON_URL.trim() : '';
  if (explicit !== '') {
    const url = explicit.replace(/\/+$/, '');
    log(`[daemon] 使用外部 daemon（DF_DAEMON_URL 显式给定）：${url}`);
    return {
      url,
      mode: 'external',
      port: null,
      dataRoot: null,
      workspaceDir: null,
      close: async () => ({ released: true }),
    };
  }

  const slug = safePrefix(label);

  /**
   * 清临时根：删除失败**记录**（路径 + 原因），不静默吞掉，也不翻转 `close()` 的
   * `released` 判定——回收成功口径是端口释放（既有 harness 先例）；残留目录须可见可查。
   */
  const removeTempRoot = async (dir) => {
    try {
      await rmImpl(dir);
      return true;
    } catch (error) {
      log(
        `[daemon] ⚠ 临时目录删除失败（${dir}）：${String(error?.message ?? error).slice(0, 500)}`,
      );
      return false;
    }
  };

  log(`[daemon] 未设 DF_DAEMON_URL → 自起夹具 daemon（${slug}）：临时数据根 + 空闲端口。`);
  const dataRoot = await mkdtempImpl(`df-gate-${slug}-data-`);
  const workspaceDir = await mkdtempImpl(`df-gate-${slug}-ws-`);

  let daemon;
  try {
    daemon = await start({ dataRoot, workspaceDir, timeoutMs, detached: true });
  } catch (error) {
    await removeTempRoot(dataRoot);
    await removeTempRoot(workspaceDir);
    throw new DaemonFixtureError(
      `门禁夹具 daemon 起不来（${slug}）：${String(error?.message ?? error).slice(0, 1500)}`,
      { cause: error },
    );
  }

  const port = Number(new URL(daemon.url).port);
  // 兜底：门禁异常退出（未走到 close）也要回收夹具进程组。
  const onExit = () => {
    try {
      if (daemon.pid !== undefined) process.kill(-daemon.pid, 'SIGTERM');
    } catch {
      // 已退出。
    }
  };
  process.once('exit', onExit);

  let closed = false;
  const close = async () => {
    if (closed) return { released: true };
    closed = true;
    process.off('exit', onExit);
    await daemon.close();
    const released = await waitForPortRelease(port, { timeoutMs: releaseTimeoutMs });
    const dataRootRemoved = await removeTempRoot(dataRoot);
    const workspaceDirRemoved = await removeTempRoot(workspaceDir);
    if (released) {
      log(
        dataRootRemoved && workspaceDirRemoved
          ? `[daemon] 夹具已回收：端口 ${String(port)} 已释放，临时数据根已删除。`
          : `[daemon] 夹具已回收：端口 ${String(port)} 已释放（临时目录未完全删除，见上方告警）。`,
      );
    } else {
      log(`[daemon] ✗ 夹具端口未释放（${String(port)}）——请检查残留 daemon 进程。`);
    }
    return { released };
  };

  log(`[daemon] 夹具就绪：${daemon.url}（数据根 ${dataRoot}）`);
  return {
    url: daemon.url,
    mode: 'fixture',
    port: String(port),
    dataRoot,
    workspaceDir,
    close,
  };
}
