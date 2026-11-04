/**
 * `scripts/lib/daemon-fixture.mjs` 的行为回归测试（arch-05 · 门禁 daemon 来源纪律）。
 *
 * 锁定的外部契约：
 *   1. `DF_DAEMON_URL` 显式给定 → 照用（mode=external），**不起夹具**；
 *   2. 未给定 / 空白 → 自起夹具（临时数据根 + 空闲端口），close 后删临时目录并核对端口释放；
 *   3. 夹具起不来 → 抛 `DaemonFixtureError`（门禁据此 exit 2），文案不含任何缺省实例地址；
 *   4. **无「缺省即连本机」**：`resolveDaemon` 无 env 时绝不返回 4318；仓内 scripts 也不得
 *      再出现 `?? 'http://127.0.0.1:4318'` 之类缺省回退（本用例是红验尸的落点）；
 *   5. `waitForPortRelease` 能区分「仍在听」与「已释放」。
 *
 * 用法：`pnpm test:scripts`。夹具都落在系统临时目录，不读 `~/df-evidence/**`。
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DaemonFixtureError,
  isPortListening,
  resolveDaemon,
  TEMP_ROOT_RM_OPTIONS,
  waitForPortRelease,
} from '../lib/daemon-fixture.mjs';

const scriptsDir = fileURLToPath(new URL('..', import.meta.url));

/** 收集 scripts/*.mjs + scripts/lib/*.mjs（门禁与共享件的全量来源面）。 */
function scriptSources() {
  const files = readdirSync(scriptsDir)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => join(scriptsDir, name));
  const libDir = join(scriptsDir, 'lib');
  for (const name of readdirSync(libDir).filter((entry) => entry.endsWith('.mjs'))) {
    files.push(join(libDir, name));
  }
  return files;
}

/** 缺省回退到 4318 的写法（任一门禁再写回即红）。 */
const FORBIDDEN_DEFAULTS = [
  /DF_DAEMON_URL\s*\?\?/,
  /\?\?\s*['"`]https?:\/\/[^'"`]*:4318/,
  /DAEMON_URL\s*=\s*[^;\n]*\?\?[^;\n]*4318/,
];

test('scripts 全量来源不含「缺省回退到 4318」（无 4318 默认值）', async () => {
  const offenders = [];
  for (const file of scriptSources()) {
    const text = await readFile(file, 'utf8');
    for (const pattern of FORBIDDEN_DEFAULTS) {
      if (pattern.test(text)) offenders.push(`${file} :: ${String(pattern)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `发现缺省 daemon 地址（禁止缺省即连本机）：\n${offenders.join('\n')}`,
  );
});

test('显式 DF_DAEMON_URL：照用外部实例、不起夹具、日志写明', async () => {
  let startCalls = 0;
  const logs = [];
  const daemon = await resolveDaemon({
    env: { DF_DAEMON_URL: 'http://127.0.0.1:5000/' },
    log: (line) => logs.push(line),
    start: async () => {
      startCalls += 1;
      throw new Error('不应被调用');
    },
  });

  assert.equal(daemon.url, 'http://127.0.0.1:5000');
  assert.equal(daemon.mode, 'external');
  assert.equal(startCalls, 0);
  assert.equal(daemon.port, null);
  assert.match(logs.join('\n'), /使用外部 daemon/);
  assert.deepEqual(await daemon.close(), { released: true });
});

test('未设 / 空白 DF_DAEMON_URL：自起夹具（临时数据根 + 空闲端口）并回收', async () => {
  for (const env of [{}, { DF_DAEMON_URL: '   ' }]) {
    const started = [];
    let closed = 0;
    const logs = [];
    const daemon = await resolveDaemon({
      env,
      label: 'unit-test',
      log: (line) => logs.push(line),
      start: async (options) => {
        started.push(options);
        assert.ok(existsSync(options.dataRoot), '夹具数据根应已创建');
        assert.ok(existsSync(options.workspaceDir), '夹具工作目录应已创建');
        assert.equal(options.detached, true, '夹具应独占进程组以便精确回收');
        return {
          url: 'http://127.0.0.1:51234',
          pid: undefined,
          close: async () => {
            closed += 1;
          },
        };
      },
    });

    assert.equal(started.length, 1);
    assert.equal(daemon.mode, 'fixture');
    assert.equal(daemon.url, 'http://127.0.0.1:51234');
    assert.notEqual(daemon.url, 'http://127.0.0.1:4318');
    assert.match(logs.join('\n'), /未设 DF_DAEMON_URL → 自起夹具/);

    const { dataRoot, workspaceDir } = started[0];
    assert.deepEqual(await daemon.close(), { released: true });
    assert.equal(closed, 1);
    assert.equal(existsSync(dataRoot), false, 'close 后应删除临时数据根');
    assert.equal(existsSync(workspaceDir), false, 'close 后应删除临时工作目录');
    assert.match(logs.join('\n'), /夹具已回收/);
  }
});

test('夹具起不来：抛 DaemonFixtureError（exit 2 依据），清理临时目录且文案无缺省地址', async () => {
  let captured = null;
  await assert.rejects(
    resolveDaemon({
      env: {},
      label: 'unit-test-fail',
      log: () => {},
      start: async (options) => {
        captured = options;
        throw new Error('boom: cannot bind');
      },
    }),
    (error) => {
      assert.ok(error instanceof DaemonFixtureError);
      assert.equal(error.code, 'daemon_fixture_unavailable');
      assert.match(error.message, /起不来/);
      assert.doesNotMatch(error.message, /4318/, '阻塞文案不得暗示缺省连本机');
      return true;
    },
  );
  assert.equal(existsSync(captured.dataRoot), false);
  assert.equal(existsSync(captured.workspaceDir), false);
});

test('临时根删除口径：recursive/force + 5 次重试、50ms 间隔（workflow 纪律）', () => {
  assert.deepEqual(TEMP_ROOT_RM_OPTIONS, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
});

test('临时根删除失败不静默：记录路径/原因，且不翻转 released（端口释放即回收成功）', async () => {
  const logs = [];
  const daemon = await resolveDaemon({
    env: {},
    label: 'unit-test-rm-fail',
    log: (line) => logs.push(line),
    start: async () => ({
      url: 'http://127.0.0.1:51236',
      pid: undefined,
      close: async () => {},
    }),
    rmImpl: async () => {
      throw Object.assign(new Error('ENOTEMPTY: directory not empty'), { code: 'ENOTEMPTY' });
    },
  });
  try {
    assert.deepEqual(
      await daemon.close(),
      { released: true },
      '清理失败不得把已释放的夹具判成回收失败',
    );
  } finally {
    await rm(daemon.dataRoot, TEMP_ROOT_RM_OPTIONS);
    await rm(daemon.workspaceDir, TEMP_ROOT_RM_OPTIONS);
  }

  const text = logs.join('\n');
  assert.match(text, /临时目录删除失败（[^）]+）/);
  assert.match(text, /ENOTEMPTY/);
  assert.match(text, /端口 51236 已释放（临时目录未完全删除，见上方告警）/);
});

test('waitForPortRelease：仍在监听 → false；关闭后 → true', async () => {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  assert.equal(await isPortListening(port), true);
  assert.equal(await waitForPortRelease(port, { timeoutMs: 150, intervalMs: 25 }), false);

  await new Promise((resolveClose) => server.close(resolveClose));
  assert.equal(await waitForPortRelease(port, { timeoutMs: 2000, intervalMs: 25 }), true);
});

test('真夹具 daemon：起得来、health 200、close 后端口释放（Node 22.16 也须带 strip-types）', async () => {
  const logs = [];
  const daemon = await resolveDaemon({
    env: {},
    label: 'unit-test-real',
    log: (line) => logs.push(line),
  });
  try {
    assert.equal(daemon.mode, 'fixture');
    assert.notEqual(daemon.port, '4318');
    const response = await fetch(`${daemon.url}/health`);
    assert.equal(response.status, 200);
  } finally {
    const { released } = await daemon.close();
    assert.equal(released, true, `夹具端口未释放：${logs.join('\n')}`);
  }
});
