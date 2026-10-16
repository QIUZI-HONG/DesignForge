/**
 * `scripts/guard-vocab.mjs` 的**双侧证据**回归测试（工作包 B · 词表同源门禁）。
 *
 * 为什么需要它（判据链纪律：每条新门禁必须带双侧证据）：
 *  - 正例必须 exit 0——真实仓库（契约真源 + 各层生产代码）与正例夹具都不得误报；
 *  - 违规夹具必须 exit 1——层内写死词表字面量、从非契约模块引词表、类型别名写死联合、
 *    权重表写死对象，每一类都要被点名；
 *  - 前置不成立必须 exit 2——真源缺失、层文件缺失、初始化表达式静态判不出根，
 *    一律「阻塞」而不是假装通过。
 *
 * 用法：`pnpm test:scripts`（node --test + 根 glob，覆盖 scripts/tests 下全部 `*.test.mjs`）。
 * 退出码：0 全过 / 1 有失败。
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const guard = join(repoRoot, 'scripts', 'guard-vocab.mjs');
const fixtureDir = join(here, 'fixtures', 'guard-vocab');
const fixture = (name) => join(fixtureDir, name);

/** 跑守卫（--json；可选覆盖真源/层根，夹具运行不得触碰真实仓库路径）。 */
function runGuard(options = {}) {
  const args = [guard, '--json'];
  if (options.source) args.push(`--source=${options.source}`);
  if (options.layers) args.push(`--layers=${options.layers}`);
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: repoRoot });
  const stdout = (result.stdout ?? '').trim();
  assert.notEqual(stdout, '', `守卫未输出 JSON（stderr: ${result.stderr}）`);
  return { status: result.status, report: JSON.parse(stdout) };
}

const violationsOf = (report) => (report.violations ?? []).map(String).join('\n');
const undeterminedOf = (report) => (report.undetermined ?? []).map(String).join('\n');

// --- 决定性的正例：真实仓库必须干净（本批就是把它清干净的）---

test('真实仓库（契约真源 + ingest 各层）→ exit 0', () => {
  const { status, report } = runGuard();

  assert.equal(violationsOf(report), '');
  assert.equal(undeterminedOf(report), '');
  assert.equal(status, 0);
});

test('正例夹具（层内全部自真源派生）→ exit 0，且确已扫到层文件', () => {
  const { status, report } = runGuard({ layers: fixture('ok') });

  assert.equal(violationsOf(report), '');
  assert.equal(status, 0);
  assert.match((report.checked ?? []).join('\n'), /ok\/layer\.ts/);
});

// --- 违规夹具：每一类漂移写法都要被点名（exit 1）---

test('违规①：层内写死 kind 数组（含近似拼写）→ exit 1 且点名文件/名字', () => {
  const { status, report } = runGuard({ layers: fixture('drift-kind') });

  assert.equal(status, 1, `未抓到词表字面量：${violationsOf(report) || undeterminedOf(report)}`);
  assert.match(violationsOf(report), /drift-kind\/layer\.ts/);
  assert.match(violationsOf(report), /ASSET_KINDS/);
  assert.match(violationsOf(report), /字面量/);
});

test('违规②：lane 词表写成缺项子集字面量 → exit 1 且点名 LANES', () => {
  const { status, report } = runGuard({ layers: fixture('drift-lane') });

  assert.equal(status, 1, `未抓到子集字面量：${violationsOf(report) || undeterminedOf(report)}`);
  assert.match(violationsOf(report), /LANES/);
});

test('违规③：词表从本地模块 import（非 @dforge/contracts）→ exit 1', () => {
  const { status, report } = runGuard({ layers: fixture('foreign-root') });

  assert.equal(status, 1, `未抓到伪真源：${violationsOf(report) || undeterminedOf(report)}`);
  assert.match(violationsOf(report), /LAYER_KINDS|真源/);
});

test('违规④：类型别名写死字面量联合（AssetKind）→ exit 1 且点名', () => {
  const { status, report } = runGuard({ layers: fixture('type-union') });

  assert.equal(
    status,
    1,
    `未抓到类型词表字面量：${violationsOf(report) || undeterminedOf(report)}`,
  );
  assert.match(violationsOf(report), /AssetKind/);
  assert.match(violationsOf(report), /类型/);
});

test('违规⑤：五维权重表写死对象字面量 → exit 1 且点名 QUALITY_WEIGHTS', () => {
  const { status, report } = runGuard({ layers: fixture('weights-literal') });

  assert.equal(status, 1, `未抓到权重表字面量：${violationsOf(report) || undeterminedOf(report)}`);
  assert.match(violationsOf(report), /QUALITY_WEIGHTS/);
});

// --- 阻塞语义（exit 2，禁当通过也禁误报违规）---

test('阻塞①：初始化表达式静态判不出根（函数调用）→ exit 2', () => {
  const { status, report } = runGuard({ layers: fixture('unresolvable') });

  assert.equal(status, 2, `应记无法判定：违规=${violationsOf(report)}`);
  assert.match(undeterminedOf(report), /KINDS/);
});

test('阻塞②：契约真源缺失 → exit 2（前置不成立）', () => {
  const { status, report } = runGuard({ source: fixture('missing-vocab.ts') });

  assert.equal(status, 2);
  assert.match(undeterminedOf(report), /真源|vocab/);
});

test('阻塞③：层根目录不存在 → exit 2', () => {
  const { status, report } = runGuard({ layers: fixture('does-not-exist') });

  assert.equal(status, 2);
  assert.match(undeterminedOf(report), /层|不存在/);
});
