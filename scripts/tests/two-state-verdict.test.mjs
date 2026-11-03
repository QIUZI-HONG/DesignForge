/**
 * `scripts/lib/two-state-verdict.mjs` 的行为回归测试（CI 判码共享裁决 · tp2-03）。
 *
 * 为什么需要它：tp1-05 在 ci.yml 留下 ai/image 两段 ~40 行同构判码（评审 Nit#7），
 * 抽取共享裁决后**逐语义等价**是本测试的前提——三态判定（0 收 / 1 红 / 2 仅当
 * `meta.stepsFailed===0` 且 `blockedReason` 非空，证据缺失或解析失败一律红）一旦漂移，
 * CI 会把 bootstrap 阻塞当 UI 段挂点收下（假绿），或把真阻塞误判红。
 *
 * 断言的都是裁决的**外部契约**：判定函数的三态退出码与输出流，以及 CLI 壳的
 * argv→退出码接线。夹具冻结在仓库内（CI 无仓外证据，禁依赖开发机状态）。
 *
 * 用法：`pnpm test:scripts`。退出码：0 全过 / 1 有失败。
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { twoStateVerdict } from '../lib/two-state-verdict.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', 'two-state-verdict', name);
const scriptPath = join(here, '..', 'lib', 'two-state-verdict.mjs');

test('exit 0 → 收（门禁在 CI 完整通过，含 UI 段）', () => {
  const verdict = twoStateVerdict(fixture('blocked-good.json'), 0, 'AI 两态门禁');
  assert.deepEqual(
    { exitCode: verdict.exitCode, stream: verdict.stream },
    { exitCode: 0, stream: 'out' },
  );
  assert.match(verdict.message, /AI 两态门禁在 CI 完整通过（含 UI 段）/);
});

test('exit 1 → 红（真失败，不得当阻塞）', () => {
  const verdict = twoStateVerdict(fixture('blocked-good.json'), 1, 'AI 两态门禁');
  assert.equal(verdict.exitCode, 1);
  assert.equal(verdict.stream, 'err');
  assert.match(verdict.message, /违规：AI 两态门禁 exit=1/);
  assert.match(verdict.message, /真失败，不得当阻塞/);
});

test('其余退出码（如 3）一律红', () => {
  const verdict = twoStateVerdict(fixture('blocked-good.json'), 3, 'AI 两态门禁');
  assert.equal(verdict.exitCode, 1);
  assert.equal(verdict.stream, 'err');
  assert.match(verdict.message, /exit=3/);
});

test('exit 2 + 合规证据（stepsFailed=0 且 blockedReason 非空）→ 收（阻塞语义挂点）', () => {
  const verdict = twoStateVerdict(fixture('blocked-good.json'), 2, 'AI 两态门禁');
  assert.equal(verdict.exitCode, 0);
  assert.equal(verdict.stream, 'out');
  assert.match(verdict.message, /13 步全过/);
  assert.match(verdict.message, /仅 UI 挂载段阻塞/);
});

test('exit 2 + 证据文件缺失 → 红', () => {
  const verdict = twoStateVerdict(fixture('does-not-exist.json'), 2, 'AI 两态门禁');
  assert.equal(verdict.exitCode, 1);
  assert.equal(verdict.stream, 'err');
  assert.match(verdict.message, /证据缺失或 JSON 解析失败/);
  assert.match(verdict.message, /bootstrap 阻塞不得冒充 UI 段挂点/);
});

test('exit 2 + 损坏 JSON → 红', () => {
  const verdict = twoStateVerdict(fixture('corrupt.json'), 2, 'AI 两态门禁');
  assert.equal(verdict.exitCode, 1);
  assert.equal(verdict.stream, 'err');
  assert.match(verdict.message, /证据缺失或 JSON 解析失败/);
});

test('exit 2 + 伪造 stepsFailed=1 → 红（bootstrap 阻塞不得冒充 UI 段挂点）', () => {
  const verdict = twoStateVerdict(fixture('forged-steps-failed.json'), 2, 'AI 两态门禁');
  assert.equal(verdict.exitCode, 1);
  assert.equal(verdict.stream, 'err');
  assert.match(verdict.message, /证据不符/);
  assert.match(verdict.message, /stepsFailed=1/);
});

test('exit 2 + stepsFailed=0 但 blockedReason 为空串 → 红', () => {
  const verdict = twoStateVerdict(fixture('empty-reason.json'), 2, 'AI 两态门禁');
  assert.equal(verdict.exitCode, 1);
  assert.match(verdict.message, /证据不符/);
});

test('exit 2 + blockedReason 缺失（非字符串）→ 红', () => {
  const verdict = twoStateVerdict(fixture('missing-reason.json'), 2, 'AI 两态门禁');
  assert.equal(verdict.exitCode, 1);
  assert.match(verdict.message, /证据不符/);
});

test('exit 2 + meta 缺失（stepsFailed 落 ?? -1 兜底）→ 红', () => {
  const verdict = twoStateVerdict(fixture('missing-meta.json'), 2, 'AI 两态门禁');
  assert.equal(verdict.exitCode, 1);
  assert.match(verdict.message, /stepsFailed=-1/);
});

test('exit 2 + 证据为 JSON null → 红（不抛崩溃，判码红）', () => {
  const verdict = twoStateVerdict(fixture('null.json'), 2, 'AI 两态门禁');
  assert.equal(verdict.exitCode, 1);
  assert.match(verdict.message, /证据不符/);
});

test('gate 名仅影响日志措辞，不影响判定（证据不符文案与原两段一致，不含 gate 名）', () => {
  const a = twoStateVerdict(fixture('forged-steps-failed.json'), 2, 'AI 两态门禁');
  const b = twoStateVerdict(fixture('forged-steps-failed.json'), 2, '出图两态门禁');
  assert.equal(a.exitCode, b.exitCode);
  assert.equal(a.message, b.message);
  // gate 名出现在带名的两段文案里（0=完整通过 / 1=真失败）。
  assert.match(twoStateVerdict(fixture('blocked-good.json'), 0, '出图两态门禁').message, /出图两态门禁/);
  assert.match(twoStateVerdict(fixture('blocked-good.json'), 1, 'AI 两态门禁').message, /AI 两态门禁/);
});

test('CLI：argv 缺参 → 红 + 用法提示（不得静默放行）', () => {
  const run = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /用法/);
});

test('CLI：退出码非非负整数 → 红 + 用法提示', () => {
  const run = spawnSync(process.execPath, [scriptPath, fixture('blocked-good.json'), 'x'], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /用法/);
});

test('CLI：接线 = 判定函数退出码与输出流（合规阻塞 → 进程 0）', () => {
  const run = spawnSync(
    process.execPath,
    [scriptPath, fixture('blocked-good.json'), '2', 'AI 两态门禁'],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0);
  assert.match(run.stdout, /仅 UI 挂载段阻塞/);
});

test('CLI：接线 = 伪造 stepsFailed=1 → 进程 1，违规走 stderr', () => {
  const run = spawnSync(
    process.execPath,
    [scriptPath, fixture('forged-steps-failed.json'), '2', 'AI 两态门禁'],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /证据不符/);
});
