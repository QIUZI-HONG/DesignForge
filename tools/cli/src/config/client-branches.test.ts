/**
 * `df config` 客户端与 stdin 分支补测（audit-d08 · 缺陷 D-11：cli 关键分支 ≥90%）。
 *
 * 目标集口径（「命令参数面」的 config 侧）：`src/config/daemon.ts`（地址/令牌解析 +
 * daemon 统一信封客户端）与 `src/config/index.ts` 的分发与 stdin 读取分支（help 各形态、
 * 恰给其一校验、clear/set 的成功与被拒两态、TTY 特殊键、EOF/空输入）。
 *
 * 与既有套件的分工：`config-cli.test.ts` 走**真子进程 + 真临时 daemon**（进程级可观测
 * 行为）；本文件**进程内直调**（vitest v8 覆盖率只统计进程内模块图，子进程不计入——
 * 这是本补测文件存在的理由），daemon 侧用**本文件自起 http 桩**（回环随机端口），
 * 令牌/数据根 env 全程显式钉在临时目录，禁触真实 `~/.dforge` 与真实 daemon。
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DAEMON_ROUTES } from '@dforge/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../index.ts';
import {
  CLI_DAEMON_DEFAULT_URL,
  requestDaemon,
  resolveDaemonBaseUrl,
  resolveDaemonToken,
} from './daemon.ts';
import { runConfigCli } from './index.ts';

/** 假 key（形态过桩即可；只在本进程与自起桩之间流转，禁真凭据）。 */
const FAKE_KEY = 'sk-fake-branch-0123456789-0zzz';

/** 桩收到的一次请求（方法/路径/头/体——体为原始字符串，解析由断言侧负责）。 */
interface StubCall {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string | null;
}

interface StubHandle {
  url: string;
  calls: StubCall[];
  close: () => Promise<void>;
}

/** 自起 http 桩（回环随机端口；逐请求按 respond 决定状态码与响应体）。 */
async function startStub(
  respond: (call: StubCall) => { status: number; body: string },
): Promise<StubHandle> {
  const calls: StubCall[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      const call: StubCall = {
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        body: raw === '' ? null : raw,
      };
      calls.push(call);
      const reply = respond(call);
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** 信封：成功形态。 */
function okEnvelope(result: unknown): { status: number; body: string } {
  return { status: 200, body: JSON.stringify({ ok: true, result }) };
}

/** 信封：daemon 明确拒绝形态。 */
function failEnvelope(code: string, message: string): { status: number; body: string } {
  return { status: 200, body: JSON.stringify({ ok: false, error: { code, message } }) };
}

/** 凭据摘要（daemon 回包形状；本文件不出真凭据，掩码/来源都是桩值）。 */
function credentialSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'deepseek',
    hasKey: true,
    maskedKey: 'sk-…0zzz',
    source: 'stored',
    updatedAt: '2026-11-06T00:00:00Z',
    ...overrides,
  };
}

/** 临时数据根（resolveDaemonToken 的文件分支用；进程内直调须钉住，禁读真实 ~/.dforge）。 */
let tempRoot = '';

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'df-cli-branch-'));
  // 传输层安全钉：令牌来源显式置空、数据根钉临时目录、env 基址清空——
  // requestDaemon 内部读 process.env，不钉就会去摸真实 ~/.dforge/daemon-token
  vi.stubEnv('DF_DAEMON_TOKEN', '');
  vi.stubEnv('DF_DATA_ROOT', tempRoot);
  vi.stubEnv('NEXT_PUBLIC_DF_DAEMON_URL', '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (tempRoot !== '') {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    tempRoot = '';
  }
});

describe('requestDaemon：统一信封与传输分支', () => {
  it('成功信封：令牌头 + JSON 体齐；result 原样解出', async () => {
    vi.stubEnv('DF_DAEMON_TOKEN', 'tok-branch-1');
    const stub = await startStub(() => okEnvelope({ written: true }));
    try {
      const result = await requestDaemon<{ written: boolean }>(
        stub.url,
        DAEMON_ROUTES.configCredentialsSet,
        { apiKey: FAKE_KEY },
      );
      expect(result).toEqual({ ok: true, value: { written: true } });
      expect(stub.calls).toHaveLength(1);
      const call = stub.calls[0];
      expect(call?.method).toBe('PUT');
      expect(call?.path).toBe('/config/credentials');
      expect(call?.headers['x-df-token']).toBe('tok-branch-1');
      expect(call?.headers['content-type']).toBe('application/json');
      expect(JSON.parse(call?.body ?? '{}')).toEqual({ apiKey: FAKE_KEY });
    } finally {
      await stub.close();
    }
  });

  it('api 失败信封：kind=api，错误码与文案原样上抛（不含请求体内容）', async () => {
    const stub = await startStub(() => failEnvelope('DF-CRED-REJECTED', 'key 形态不合法'));
    try {
      const result = await requestDaemon(stub.url, DAEMON_ROUTES.configCredentialsSet, {
        apiKey: FAKE_KEY,
      });
      expect(result).toEqual({
        ok: false,
        failure: { kind: 'api', code: 'DF-CRED-REJECTED', message: 'key 形态不合法' },
      });
    } finally {
      await stub.close();
    }
  });

  it('非 JSON 响应 → kind=network「响应不可解析」（HTTP 状态原样入文案）', async () => {
    const stub = await startStub(() => ({ status: 502, body: '<html>bad gateway</html>' }));
    try {
      const result = await requestDaemon(stub.url, DAEMON_ROUTES.configCredentialsClear);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.kind).toBe('network');
        expect(result.failure.message).toContain('响应不可解析');
        expect(result.failure.message).toContain('502');
        expect(result.failure.code).toBeNull();
      }
    } finally {
      await stub.close();
    }
  });

  it('信封形状不合法（JSON 但非 {ok,…}）→ kind=network「响应形状不合法」', async () => {
    const stub = await startStub(() => ({ status: 200, body: JSON.stringify({ hello: 'world' }) }));
    try {
      const result = await requestDaemon(stub.url, DAEMON_ROUTES.configCredentialsClear);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.kind).toBe('network');
        expect(result.failure.message).toContain('形状不合法');
      }
    } finally {
      await stub.close();
    }
  });

  it('连接被拒（回环死端口）→ kind=network「无法连接本地服务」', async () => {
    // 桩先起再关：拿一个「刚释放、必然无人监听」的端口，连接立即 refused，不吃超时
    const stub = await startStub(() => okEnvelope(null));
    const deadUrl = stub.url;
    await stub.close();
    const result = await requestDaemon(deadUrl, DAEMON_ROUTES.configCredentialsClear);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('network');
      expect(result.failure.message).toContain('无法连接本地服务');
      expect(result.failure.message).toContain(deadUrl);
    }
  });

  it('无令牌：env 与数据根文件都空 → 不带 x-df-token 头；无体请求不带 content-type', async () => {
    // env/数据根已在 beforeEach 钉空（临时目录无 daemon-token）——走「无令牌」分支
    const stub = await startStub(() => okEnvelope(null));
    try {
      const result = await requestDaemon(stub.url, DAEMON_ROUTES.configCredentialsClear);
      expect(result).toEqual({ ok: true, value: null });
      const call = stub.calls[0];
      expect(call?.headers['x-df-token']).toBeUndefined();
      expect(call?.headers['content-type']).toBeUndefined();
      expect(call?.body).toBeNull();
    } finally {
      await stub.close();
    }
  });
});

describe('resolveDaemonToken：env 优先 → 数据根令牌文件 → null', () => {
  it('env 非空优先且 trim；env 空串落到数据根文件', async () => {
    expect(await resolveDaemonToken({ DF_DAEMON_TOKEN: '  tok-env  ' })).toBe('tok-env');

    const dataRoot = tempRoot;
    await mkdir(dataRoot, { recursive: true });
    await writeFile(join(dataRoot, 'daemon-token'), '  tok-file\n', 'utf8');
    expect(await resolveDaemonToken({ DF_DAEMON_TOKEN: '', DF_DATA_ROOT: dataRoot })).toBe(
      'tok-file',
    );
  });

  it('文件纯空白 → null（空白视为未给）；文件缺失 → null（不炸调用方）', async () => {
    await mkdir(tempRoot, { recursive: true });
    await writeFile(join(tempRoot, 'daemon-token'), '   \n', 'utf8');
    expect(await resolveDaemonToken({ DF_DATA_ROOT: tempRoot })).toBeNull();

    expect(await resolveDaemonToken({ DF_DATA_ROOT: join(tempRoot, 'no-such-root') })).toBeNull();
    // 纪律注：DF_DATA_ROOT 未给的 homedir 缺省分支会触真实 ~/.dforge，按纪律不在测试里覆盖。
  });
});

describe('resolveDaemonBaseUrl（补 daemon.test.ts 未钉的缺省落点）', () => {
  it('显式与 env 都未给 → 契约包缺省端点（端口窗起点单源）', () => {
    expect(resolveDaemonBaseUrl(null)).toBe(CLI_DAEMON_DEFAULT_URL);
    expect(resolveDaemonBaseUrl('')).toBe(CLI_DAEMON_DEFAULT_URL);
  });
});

describe('runConfigCli：分发与 stdin 分支（进程内；daemon 走自起桩）', () => {
  it('help 各形态：空 argv / help / --help / -h → usage + exit 0', async () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) {
      const logs: string[] = [];
      const outcome = await runConfigCli(
        argv,
        (line) => logs.push(line),
        () => {},
      );
      expect(outcome).toMatchObject({ command: 'config help', exitCode: 0, blockedReason: null });
      expect(logs[0]).toContain('set-key --stdin');
    }
  });

  it('set-key --help：子命令级 usage（command 记为 config set-key）', async () => {
    const logs: string[] = [];
    const outcome = await runConfigCli(
      ['set-key', '--help'],
      (line) => logs.push(line),
      () => {},
    );
    expect(outcome).toMatchObject({ command: 'config set-key', exitCode: 0 });
    expect(logs[0]).toContain('--clear');
  });

  it('未知子命令 / 恰给其一校验：缺两态、同给两态 → 用法错误', async () => {
    await expect(
      runConfigCli(
        ['wat'],
        () => {},
        () => {},
      ),
    ).rejects.toThrow('未知子命令：config wat（支持 set-key）');
    await expect(
      runConfigCli(
        ['set-key'],
        () => {},
        () => {},
      ),
    ).rejects.toThrow(/恰给其一/);
    await expect(
      runConfigCli(
        ['set-key', '--stdin', '--clear'],
        () => {},
        () => {},
      ),
    ).rejects.toThrow(/恰给其一/);
  });

  it('clear 成功：DELETE 打到桩、掩码为 null 照单透传、日志点降级语义', async () => {
    const stub = await startStub(() =>
      okEnvelope({ cleared: true, summary: credentialSummary({ hasKey: false, maskedKey: null }) }),
    );
    try {
      const logs: string[] = [];
      const outcome = await runConfigCli(
        ['set-key', '--clear', '--daemon', stub.url],
        (line) => logs.push(line),
        () => {},
      );
      expect(outcome).toMatchObject({
        command: 'config set-key',
        exitCode: 0,
        blockedReason: null,
      });
      expect(outcome.summary).toMatchObject({ daemon: stub.url, cleared: true, hasKey: false });
      expect(logs[0]).toContain('已清除');
      const call = stub.calls[0];
      expect(call?.method).toBe('DELETE');
      expect(call?.body).toBeNull();
    } finally {
      await stub.close();
    }
  });

  it('clear 被拒：exit 2 + blockedReason；经 runCli 收口时 stderr 带「阻塞：」前缀', async () => {
    const stub = await startStub(() => failEnvelope('DF-CRED-DENIED', '凭据库被拒'));
    try {
      const logs: string[] = [];
      const errs: string[] = [];
      const outcome = await runConfigCli(
        ['set-key', '--clear', '--daemon', stub.url],
        (line) => logs.push(line),
        (line) => errs.push(line),
      );
      expect(outcome.exitCode).toBe(2);
      expect(outcome.blockedReason).toBe('凭据库被拒');
      expect(outcome.summary).toMatchObject({ daemon: stub.url, error: '凭据库被拒' });

      // 「阻塞：」前缀走 stderr、末行 JSON 摘要走 stdout——都是 runCli（dispatchFamily）的收口行为
      const errsTop: string[] = [];
      const logsTop: string[] = [];
      const code = await runCli(
        ['config', 'set-key', '--clear', '--daemon', stub.url],
        (line) => logsTop.push(line),
        (line) => errsTop.push(line),
      );
      expect(code).toBe(2);
      expect(errsTop[0]).toBe('阻塞：凭据库被拒');
      expect(JSON.parse(logsTop.at(-1) ?? '{}')).toMatchObject({
        command: 'config set-key',
        exitCode: 2,
      });
    } finally {
      await stub.close();
    }
  });

  it('set 空 stdin（管道 EOF 无内容）→ 用法错误「标准输入为空」', async () => {
    const stub = await startStub(() => okEnvelope(null));
    try {
      await expect(
        runConfigCli(
          ['set-key', '--stdin', '--daemon', stub.url],
          () => {},
          () => {},
          Readable.from([]),
        ),
      ).rejects.toThrow('标准输入为空：未读到 API key');
      expect(stub.calls).toHaveLength(0);
    } finally {
      await stub.close();
    }
  });

  it('set 成功（管道注入）：体只含 key 字段；source=env 文案与 maskedKey 两态', async () => {
    const stub = await startStub(() =>
      okEnvelope({ summary: credentialSummary({ source: 'env', maskedKey: 'sk-…0zzz' }) }),
    );
    try {
      const logs: string[] = [];
      const errs: string[] = [];
      const outcome = await runConfigCli(
        ['set-key', '--stdin', '--daemon', stub.url],
        (line) => logs.push(line),
        (line) => errs.push(line),
        Readable.from([`${FAKE_KEY}\n`]),
      );
      expect(outcome).toMatchObject({
        command: 'config set-key',
        exitCode: 0,
        blockedReason: null,
      });
      expect(outcome.summary).toMatchObject({ source: 'env', maskedKey: 'sk-…0zzz' });
      expect(logs.join('\n')).toContain('环境变量（优先，只读）');
      expect(logs.join('\n')).not.toContain(FAKE_KEY);
      expect(errs.join('\n')).not.toContain(FAKE_KEY);
      expect(JSON.parse(stub.calls[0]?.body ?? '{}')).toEqual({ apiKey: FAKE_KEY });
    } finally {
      await stub.close();
    }
  });

  it('set 成功（source=stored）：本地凭据库文案；maskedKey 缺省掩码 sk-…', async () => {
    const stub = await startStub(() =>
      okEnvelope({ summary: credentialSummary({ maskedKey: null }) }),
    );
    try {
      const logs: string[] = [];
      const outcome = await runConfigCli(
        ['set-key', '--stdin', '--daemon', stub.url],
        (line) => logs.push(line),
        () => {},
        Readable.from([FAKE_KEY]),
      );
      expect(outcome.exitCode).toBe(0);
      expect(logs.join('\n')).toContain('本地凭据库');
      expect(logs.join('\n')).toContain('sk-…'); // maskedKey 为 null → 缺省掩码
    } finally {
      await stub.close();
    }
  });

  it('set 被拒：exit 2 + blockedReason，输入内容不出现在任何输出通道', async () => {
    const stub = await startStub(() => failEnvelope('DF-CRED-REJECTED', 'key 形态不合法'));
    try {
      const logs: string[] = [];
      const errs: string[] = [];
      const outcome = await runConfigCli(
        ['set-key', '--stdin', '--daemon', stub.url],
        (line) => logs.push(line),
        (line) => errs.push(line),
        Readable.from([FAKE_KEY]),
      );
      expect(outcome.exitCode).toBe(2);
      expect(outcome.blockedReason).toBe('key 形态不合法');
      expect(`${logs.join('\n')}\n${errs.join('\n')}`).not.toContain(FAKE_KEY);
    } finally {
      await stub.close();
    }
  });

  /** TTY 假流（isTTY + setRawMode 记录；_read 空实现，由用例 push 驱动）。 */
  class FakeTty extends Readable {
    isTTY = true;
    readonly rawModes: boolean[] = [];
    setRawMode(mode: boolean): void {
      this.rawModes.push(mode);
    }
    override _read(): void {}
  }

  it('TTY：普通字符 / 两种退格 / 回车提交；raw 开→关，提示走 stderr', async () => {
    const stub = await startStub(() => okEnvelope({ summary: credentialSummary() }));
    try {
      const errs: string[] = [];
      const stdin = new FakeTty();
      const pending = runConfigCli(
        ['set-key', '--stdin', '--daemon', stub.url],
        () => {},
        (line) => errs.push(line),
        stdin,
      );
      stdin.push(`a\u007fb\bkey\r`);
      const outcome = await pending;
      expect(outcome.exitCode).toBe(0);
      expect(stdin.rawModes).toEqual([true, false]);
      expect(errs.join('\n')).toContain('不回显');
      // 逐字符：'a' 被 \u007f 删掉、'b' 被 \b 删掉，随后 key 三个字符落定，回车提交
      expect(JSON.parse(stub.calls[0]?.body ?? '{}')).toEqual({ apiKey: 'key' });
    } finally {
      await stub.close();
    }
  });

  it('TTY Ctrl+C → 用法错误「已取消」，raw 仍恢复（finally 兜底）', async () => {
    const stub = await startStub(() => okEnvelope(null));
    try {
      const stdin = new FakeTty();
      const pending = runConfigCli(
        ['set-key', '--stdin', '--daemon', stub.url],
        () => {},
        () => {},
        stdin,
      );
      stdin.push('partial\u0003');
      await expect(pending).rejects.toThrow('已取消（Ctrl+C）');
      expect(stdin.rawModes).toEqual([true, false]);
      expect(stub.calls).toHaveLength(0);
    } finally {
      await stub.close();
    }
  });

  it('TTY EOF 无回车 → 已输入内容照常提交；回车换行（\\n）同 \\r', async () => {
    const stub = await startStub(() => okEnvelope({ summary: credentialSummary() }));
    try {
      const stdin = new FakeTty();
      const pending = runConfigCli(
        ['set-key', '--stdin', '--daemon', stub.url],
        () => {},
        () => {},
        stdin,
      );
      stdin.push('eof-key');
      stdin.push(null);
      const outcome = await pending;
      expect(outcome.exitCode).toBe(0);
      expect(JSON.parse(stub.calls[0]?.body ?? '{}')).toEqual({ apiKey: 'eof-key' });

      // \n 与 \r 同为提交键（分支两态）
      const stdinLf = new FakeTty();
      const pendingLf = runConfigCli(
        ['set-key', '--stdin', '--daemon', stub.url],
        () => {},
        () => {},
        stdinLf,
      );
      stdinLf.push('lf-key\n');
      await pendingLf;
      expect(JSON.parse(stub.calls[1]?.body ?? '{}')).toEqual({ apiKey: 'lf-key' });
    } finally {
      await stub.close();
    }
  });

  it('isTTY 但无 setRawMode 能力 → 退化管道读（不提示、不 raw），空输入照常报错', async () => {
    const ttyNoRaw = new Readable() as Readable & { isTTY?: boolean };
    ttyNoRaw.isTTY = true; // 无 setRawMode 方法：interactive 判定为 false
    ttyNoRaw.push(null);
    await expect(
      runConfigCli(
        ['set-key', '--stdin', '--daemon', 'http://127.0.0.1:1'],
        () => {},
        () => {},
        ttyNoRaw,
      ),
    ).rejects.toThrow('标准输入为空');
  });
});
