/**
 * 工作包 F · `df config set-key` 凭据 stdin 注入 —— CLI 子进程缝（先例：verify-market 的
 * cli-contract 套件）。本文件用**真子进程**跑 `bin/df.mjs`（Node 原生 TS 类型擦除直跑，
 * 与用户执行路径一致），stdin 走真管道——「不回显 / 不进 shell 历史 / 只掩码」是进程级
 * 可观测行为，in-process 调用覆盖不到。
 *
 * daemon 侧：**自起临时 daemon 子进程**（verify-market 套件的同款纪律：临时目录、
 * 不碰开发机 `~/.dforge`、不依赖外部凭据）。子进程环境显式清空 `DF_DEEPSEEK_API_KEY`，
 * 杜绝开发机环境把真 key 带进来（否则 `--clear` 用例失真）。
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(HERE, '..', '..', 'bin', 'df.mjs');
const DAEMON_MAIN = join(HERE, '..', '..', '..', '..', 'apps', 'daemon', 'src', 'main.ts');

/** 哨兵 key（假值；形态过 daemon 的 isPlausibleApiKey）。末 4 位 = `0zzz`。 */
const SENTINEL_KEY = 'sk-b3-keycli-sentinel-0123456789-0zzz';
/** 期望掩码（daemon 的 maskSecret 口径：保留 `sk-` 前缀与末 4 位）。 */
const SENTINEL_MASK = 'sk-…0zzz';
/** 用于断言「输出不含明文」的特征片段（不含前后缀，避免与掩码撞车）。 */
const SENTINEL_FRAGMENT = 'keycli-sentinel';

interface DaemonHandle {
  url: string;
  tempDir: string;
  child: ChildProcess;
}

/** 轮询直到条件成立（启动行为事件，超时抛错）。 */
async function waitFor<T>(probe: () => T | null, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** 起临时 daemon（子进程 + 临时数据根；不读开发机 `~/.dforge`）。 */
async function startDaemon(): Promise<DaemonHandle> {
  const tempDir = await mkdtemp(join(tmpdir(), 'df-b3-keycli-'));
  const child = spawn(process.execPath, [DAEMON_MAIN], {
    env: {
      PATH: process.env.PATH ?? '',
      DF_DATA_ROOT: join(tempDir, 'data'),
      DF_WORKSPACE_DIR: join(tempDir, 'workspace'),
      DF_HOST: '127.0.0.1',
      // 显式清空：不继承开发机可能存在的真实 key（--clear 用例的前提）
      DF_DEEPSEEK_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  let url: string;
  try {
    url = await waitFor(
      () => output.match(/\[daemon\] listening on (http:\/\/\S+)/)?.[1] ?? null,
      20_000,
      `daemon 启动（输出尾部：${output.slice(-300)}）`,
    );
  } catch (error) {
    child.kill('SIGKILL');
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
  return { url, tempDir, child };
}

interface CliRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** 跑 `df` 子进程（stdin 走真管道；`NEXT_PUBLIC_DF_DAEMON_URL` 缺省清空，防开发机串口）。 */
async function runDf(args: readonly string[], stdin: string | null = null): Promise<CliRun> {
  const child = spawn(process.execPath, [CLI_BIN, ...args], {
    env: { ...process.env, NEXT_PUBLIC_DF_DAEMON_URL: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  child.stdin.end(stdin ?? '');
  const code = await new Promise<number | null>((resolve) => {
    child.on('close', resolve);
  });
  return { code, stdout, stderr };
}

/** 末行必须是可解析 JSON（门禁脚本契约，与 df market 同款）。 */
function lastJson(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split('\n');
  return JSON.parse(lines.at(-1) ?? '') as Record<string, unknown>;
}

/** 从测试侧直连 daemon 读数（断言「落库」是 daemon 真行为，不是 CLI 自说自话）。 */
async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = (await response.json()) as { ok: boolean; result: T };
  return payload.result;
}

let daemon: DaemonHandle;

beforeAll(async () => {
  daemon = await startDaemon();
}, 40_000);

afterAll(async () => {
  if (daemon !== undefined) {
    daemon.child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      daemon.child.on('close', () => {
        resolve();
      });
      setTimeout(() => {
        daemon.child.kill('SIGKILL');
        resolve();
      }, 3000);
    });
    await rm(daemon.tempDir, { recursive: true, force: true });
  }
});

describe('df config set-key --stdin：凭据 stdin 注入（工作包 F）', () => {
  it('stdin 注入假 key → exit 0、输出仅掩码、daemon 落库且摘要一致', async () => {
    const run = await runDf(
      ['config', 'set-key', '--stdin', '--daemon', daemon.url],
      `${SENTINEL_KEY}\n`,
    );
    expect(run.code).toBe(0);

    // 输出只打掩码：明文（含特征片段）不得出现在 stdout / stderr 任何位置
    expect(run.stdout).not.toContain(SENTINEL_KEY);
    expect(run.stderr).not.toContain(SENTINEL_KEY);
    expect(`${run.stdout}${run.stderr}`).not.toContain(SENTINEL_FRAGMENT);
    expect(run.stdout).toContain(SENTINEL_MASK);

    // 末行 JSON（机器可读摘要），只含掩码字段
    const summary = lastJson(run.stdout);
    expect(summary).toMatchObject({
      command: 'config set-key',
      exitCode: 0,
      maskedKey: SENTINEL_MASK,
      hasKey: true,
      source: 'stored',
    });
    expect(JSON.stringify(summary)).not.toContain(SENTINEL_FRAGMENT);

    // daemon 真的收到了正确形状并落库（PUT /config/credentials → 摘要回读）
    const config = await getJson<{ credentials: { deepseek: Record<string, unknown> } }>(
      `${daemon.url}/config`,
    );
    expect(config.credentials.deepseek).toMatchObject({
      hasKey: true,
      maskedKey: SENTINEL_MASK,
      source: 'stored',
    });
  }, 60_000);

  it('set-key --clear → exit 0；随后 /ai/status configured=false（daemon 侧真降级）', async () => {
    // 布景：先经 daemon 接口写入再清（不经 CLI 写，保证本用例自包含）
    const put = await fetch(`${daemon.url}/config/credentials`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: SENTINEL_KEY }),
    });
    expect(put.status).toBe(200);
    const before = await getJson<{ configured: boolean }>(`${daemon.url}/ai/status`);
    expect(before.configured).toBe(true);

    const run = await runDf(['config', 'set-key', '--clear', '--daemon', daemon.url]);
    expect(run.code).toBe(0);
    expect(`${run.stdout}${run.stderr}`).not.toContain(SENTINEL_KEY);
    expect(`${run.stdout}${run.stderr}`).not.toContain(SENTINEL_FRAGMENT);

    const summary = lastJson(run.stdout);
    expect(summary).toMatchObject({
      command: 'config set-key',
      exitCode: 0,
      cleared: true,
      hasKey: false,
      maskedKey: null,
    });

    const after = await getJson<{ configured: boolean }>(`${daemon.url}/ai/status`);
    expect(after.configured).toBe(false);
  }, 60_000);
});
