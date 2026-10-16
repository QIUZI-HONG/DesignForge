/**
 * `scripts/lib/guard-io.mjs` 的行为回归测试（门禁公共件 · 去重抽取）。
 *
 * 为什么需要它：`readArg` / `displayPath` / `readText` / 确定序目录遍历此前在三份守卫里
 * 逐字重复，抽取共享件后**判据链不变**是本测试的前提——守卫的对外行为（三态退出码、
 * 报错里用仓储相对路径）靠这些原语，原语语义一旦漂移，守卫会静默变红/变绿。
 *
 * 断言的都是原语的**外部契约**：argv 解析、路径展示、读取失败形态、遍历顺序与排除规则；
 * 夹具冻结在仓库内（CI 无仓外证据，禁依赖开发机状态）。
 *
 * 用法：`pnpm test:scripts`。退出码：0 全过 / 1 有失败。
 */

import assert from 'node:assert/strict';
import { dirname, join, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { collectFiles, displayPath, REPO_ROOT, readArg, readText } from '../lib/guard-io.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, 'fixtures', 'guard-io', 'root');

/** 守卫实际用的目标谓词（.ts 全收、.test.ts 除外）。 */
const isTsSource = (name) => name.endsWith('.ts') && !name.endsWith('.test.ts');

test('readArg：命中 `--name=value` 取等号后的原样串（含空串）', () => {
  assert.equal(readArg('layers', ['node', 'guard.mjs', '--layers=abc']), 'abc');
  assert.equal(readArg('layers', ['node', 'guard.mjs', '--layers=']), '');
  assert.equal(readArg('layers', ['node', 'guard.mjs', '--json']), undefined);
  // 只认首个命中（与抽取前一致：process.argv.find）
  assert.equal(readArg('x', ['--x=1', '--x=2']), '1');
});

test('displayPath：仓储内给相对正斜杠路径，仓储外原样返回', () => {
  assert.equal(
    displayPath(join(REPO_ROOT, 'scripts', 'guard-vocab.mjs')),
    'scripts/guard-vocab.mjs',
  );
  const outside = `${sep}definitely-outside-dforge${sep}file.ts`;
  assert.equal(displayPath(outside), outside);
});

test('readText：读得到给文本；读不到给 `{ error }`（含展示路径，供阻塞文案）', () => {
  const text = readText(join(fixtureRoot, 'a.ts'));
  assert.equal(typeof text, 'string');
  assert.match(text, /export const a = 'a'/);

  const missing = readText(join(fixtureRoot, 'does-not-exist.ts'));
  assert.equal(typeof missing, 'object');
  assert.match(missing.error, /读取不到/);
  assert.match(missing.error, /guard-io\/root\/does-not-exist\.ts/);
});

test('collectFiles：根不存在给 null（调用方转阻塞），单文件根给自身', () => {
  assert.equal(collectFiles(join(fixtureRoot, 'nowhere'), { isTarget: isTsSource }), null);
  assert.deepEqual(collectFiles(join(fixtureRoot, 'a.ts'), { isTarget: isTsSource }), [
    join(fixtureRoot, 'a.ts'),
  ]);
});

test('collectFiles：按名排序、排除目录整棵跳过、谓词外文件不入（输出确定）', () => {
  const files = collectFiles(fixtureRoot, {
    isTarget: isTsSource,
    excludeDirs: ['__fixtures__'],
  });
  assert.deepEqual(files, [
    join(fixtureRoot, 'a.ts'),
    join(fixtureRoot, 'nested', 'b.ts'),
    join(fixtureRoot, 'z.ts'),
  ]);
  assert.doesNotMatch(files.join('\n'), /a\.test\.ts|__fixtures__/);
});
