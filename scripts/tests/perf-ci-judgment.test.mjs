/**
 * `scripts/lib/perf-ci-judgment.mjs` 的行为回归测试（CI 判码共享裁决 · audit-d07b）。
 *
 * 为什么需要它：批 7（0b733ae）在 ci.yml 写的 perf 挂点判据是 grep 门禁日志文本
 * （「provisional 字样即红」），而门禁 exit 2 的合法阻塞文案本身就含 provisional
 * 字样 → CI（无 Chromium 恒 exit 2）永不可能绿（run 42313746571 翻车实录）。判定抽成
 * 共享件、改查基线 JSON `provisional` 字段后，**三态语义等强度**是本测试的前提——
 * 四枚主钉（0 收 / 1 红 / 2+转正态收 / 2+回退态红）一旦漂移，CI 会把基线回退的模板态
 * 阻塞当挂点收下（假绿），或把合法阻塞再次误判红。本文件名含「provisional」字样、
 * 判定文案亦含——按新判据（查字段不查文本）这些字样从此无害，本测试自身即反例钉。
 *
 * 断言的都是裁决的**外部契约**：判定函数的三态退出码与输出流，以及 CLI 壳的
 * argv→退出码接线。夹具冻结在仓库内（CI 无仓外基线，禁依赖开发机状态）。
 *
 * 用法：`pnpm test:scripts`。退出码：0 全过 / 1 有失败。
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { perfCiJudgment } from '../lib/perf-ci-judgment.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', 'perf-ci-judgment', name);
const scriptPath = join(here, '..', 'lib', 'perf-ci-judgment.mjs');

test('钉 1：exit 0 → 收（门禁正式判定通过，判定档全达标）', () => {
  const verdict = perfCiJudgment(fixture('baseline-promoted.json'), 0, '渲染性能门禁');
  assert.equal(verdict.exitCode, 0);
  assert.equal(verdict.stream, 'out');
  assert.match(verdict.message, /渲染性能门禁正式判定通过/);
});

test('钉 2：exit 1 → 红（实测超阈值真违规，禁以环境理由掩盖）', () => {
  const verdict = perfCiJudgment(fixture('baseline-promoted.json'), 1, '渲染性能门禁');
  assert.equal(verdict.exitCode, 1);
  assert.equal(verdict.stream, 'err');
  assert.match(verdict.message, /违规：渲染性能门禁 exit=1/);
  assert.match(verdict.message, /真违规/);
});

test('钉 3：exit 2 + 基线 provisional:false → 收（挂点阻塞语义，非通过）', () => {
  const verdict = perfCiJudgment(fixture('baseline-promoted.json'), 2, '渲染性能门禁');
  assert.equal(verdict.exitCode, 0);
  assert.equal(verdict.stream, 'out');
  assert.match(verdict.message, /挂点，非通过/);
  assert.match(verdict.message, /provisional:false/);
});

test('钉 4：exit 2 + 基线 provisional:true → 红（基线回退成模板态不得收）', () => {
  const verdict = perfCiJudgment(fixture('baseline-provisional.json'), 2, '渲染性能门禁');
  assert.equal(verdict.exitCode, 1);
  assert.equal(verdict.stream, 'err');
  assert.match(verdict.message, /provisional:true/);
  assert.match(verdict.message, /模板态/);
});

test('钉 5：其余退出码（如 3）一律红', () => {
  const verdict = perfCiJudgment(fixture('baseline-promoted.json'), 3, '渲染性能门禁');
  assert.equal(verdict.exitCode, 1);
  assert.equal(verdict.stream, 'err');
  assert.match(verdict.message, /exit=3/);
  assert.match(verdict.message, /不符三态语义/);
});

test('exit 2 + 基线 provisional 字段缺失 → 红（无法证明转正态，不得收）', () => {
  const verdict = perfCiJudgment(fixture('baseline-missing-field.json'), 2, '渲染性能门禁');
  assert.equal(verdict.exitCode, 1);
  assert.equal(verdict.stream, 'err');
  assert.match(verdict.message, /缺失或非布尔/);
});

test('exit 2 + 基线文件缺失 → 红（判据在字段，基线不可读一律红）', () => {
  const verdict = perfCiJudgment(fixture('does-not-exist.json'), 2, '渲染性能门禁');
  assert.equal(verdict.exitCode, 1);
  assert.equal(verdict.stream, 'err');
  assert.match(verdict.message, /基线缺失或 JSON 解析失败/);
});

test('exit 2 + 基线损坏 JSON → 红', () => {
  const verdict = perfCiJudgment(fixture('corrupt.json.txt'), 2, '渲染性能门禁');
  assert.equal(verdict.exitCode, 1);
  assert.equal(verdict.stream, 'err');
  assert.match(verdict.message, /基线缺失或 JSON 解析失败/);
});

test('exit 2 + 基线为 JSON null → 红（不抛崩溃，判码红）', () => {
  const verdict = perfCiJudgment(fixture('null.json'), 2, '渲染性能门禁');
  assert.equal(verdict.exitCode, 1);
  assert.match(verdict.message, /缺失或非布尔/);
});

test('「provisional 字样」反例钉：合规收下的判定文案含 provisional 字样仍收（查字段不查文本）', () => {
  // 旧判据 grep 文本会误伤这条合法路径——本测试文件与判定文案均含 provisional 字样，
  // 按新判据（基线 JSON 字段）判定不受任何文案影响。
  const accept = perfCiJudgment(fixture('baseline-promoted.json'), 2, '渲染性能门禁');
  assert.equal(accept.exitCode, 0);
  assert.match(accept.message, /provisional/);
});

test('gate 名仅影响日志措辞，不影响判定（0/1/2 三态均不带名入判）', () => {
  const a = perfCiJudgment(fixture('baseline-provisional.json'), 2, '渲染性能门禁');
  const b = perfCiJudgment(fixture('baseline-provisional.json'), 2, 'perf gate');
  assert.equal(a.exitCode, b.exitCode);
  assert.equal(a.message, b.message);
  assert.match(
    perfCiJudgment(fixture('baseline-promoted.json'), 1, 'perf gate').message,
    /perf gate/,
  );
});

test('CLI：argv 缺参 → 红 + 用法提示（不得静默放行）', () => {
  const run = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /用法/);
});

test('CLI：退出码非非负整数 → 红 + 用法提示', () => {
  const run = spawnSync(process.execPath, [scriptPath, fixture('baseline-promoted.json'), 'x'], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /用法/);
});

test('CLI：接线 = exit 2 + 转正态基线 → 进程 0，判定走 stdout', () => {
  const run = spawnSync(
    process.execPath,
    [scriptPath, fixture('baseline-promoted.json'), '2', '渲染性能门禁'],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0);
  assert.match(run.stdout, /挂点，非通过/);
});

test('CLI：接线 = exit 2 + 回退态基线 → 进程 1，违规走 stderr', () => {
  const run = spawnSync(
    process.execPath,
    [scriptPath, fixture('baseline-provisional.json'), '2', '渲染性能门禁'],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /模板态/);
});

test('CLI：接线 = exit 1 → 进程 1，违规走 stderr', () => {
  const run = spawnSync(
    process.execPath,
    [scriptPath, fixture('baseline-promoted.json'), '1', '渲染性能门禁'],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /真违规/);
});
