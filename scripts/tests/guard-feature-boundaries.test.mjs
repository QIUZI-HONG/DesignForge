/**
 * `scripts/guard-feature-boundaries.mjs` 的**双侧证据**回归测试（工作包 E · feature 边界机检）。
 *
 * 为什么需要它（判据链纪律：每条新门禁必须带双侧证据）：
 *  - 正例必须 exit 0——真实仓库（features 根 + app 根）与正例夹具都不得误报：公开面导入、
 *    自身 feature 深导入、`app/**` 引 `features/<name>/register`（ADR-0004 ② 具名例外）都放行；
 *  - 违规夹具必须 exit 1——feature→feature 深导入、app→feature 深导入、app 显式引 `/index`、
 *    feature 引他 feature 的 register（ADR「feature 之间禁引」）、feature 引他 feature 的样式，
 *    每一类都要被点名（文件 + 行号 + 导入目标）；
 *  - 前置不成立必须 exit 2——源码树读不到、动态导入静态判不出目标，一律「阻塞」而不是假装通过。
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
const guard = join(repoRoot, 'scripts', 'guard-feature-boundaries.mjs');
const fixtureDir = join(here, 'fixtures', 'guard-feature-boundaries');
const fixture = (name) => join(fixtureDir, name);

/** 跑守卫（--json；可选覆盖源码根，夹具运行不得触碰真实仓库路径）。 */
function runGuard(options = {}) {
  const args = [guard, '--json'];
  if (options.root) args.push(`--root=${options.root}`);
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: repoRoot });
  const stdout = (result.stdout ?? '').trim();
  assert.notEqual(stdout, '', `守卫未输出 JSON（stderr: ${result.stderr}）`);
  return { status: result.status, report: JSON.parse(stdout) };
}

/** 跑守卫的人类可读日志面（不加 --json；日志走 stderr）。 */
function runGuardLog(options = {}) {
  const args = [guard];
  if (options.root) args.push(`--root=${options.root}`);
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: repoRoot });
  return { status: result.status, log: result.stderr ?? '' };
}

const violationsOf = (report) => (report.violations ?? []).map(String).join('\n');
const undeterminedOf = (report) => (report.undetermined ?? []).map(String).join('\n');
const exceptionsOf = (report) => (report.exceptions ?? []).map(String).join('\n');

// --- 决定性的正例：真实仓库必须干净（双侧判据两个根都不得误报）---

test('真实仓库（features 根 + app 根）→ exit 0，且确已扫到两个根的文件', () => {
  const { status, report } = runGuard();

  assert.equal(violationsOf(report), '');
  assert.equal(undeterminedOf(report), '');
  assert.equal(status, 0);
  const checked = (report.checked ?? []).join('\n');
  assert.match(checked, /features\/market\/index\.ts/);
  assert.match(checked, /app\/page\.tsx/);
});

test('真实仓库的登记例外被点名登记（register 接缝 + 样式入口），而不是静默放行', () => {
  const { report } = runGuard();

  assert.match(exceptionsOf(report), /register/);
  assert.match(exceptionsOf(report), /\.css/);
});

test('真实仓库的判据范围是双侧根：verify/ 白盒套件不在判据内（范围写明，非静默缺席）', () => {
  const { status, report } = runGuard();

  assert.equal(status, 0);
  assert.doesNotMatch(violationsOf(report), /verify\//);
  assert.match((report.scope?.excluded ?? []).join('\n'), /verify/);
});

test('正例夹具（公开面 + 自身深导入 + app 引 register/样式）→ exit 0，且确已扫到夹具文件', () => {
  const { status, report } = runGuard({ root: fixture('ok') });

  assert.equal(violationsOf(report), '');
  assert.equal(undeterminedOf(report), '');
  assert.equal(status, 0);
  assert.match((report.checked ?? []).join('\n'), /ok\/features\/beta\/view\.ts/);
});

test('register 例外样例：app 引 features/<name>/register → exit 0', () => {
  const { status, report } = runGuard({ root: fixture('register-ok') });

  assert.equal(violationsOf(report), '');
  assert.equal(status, 0);
  assert.match(exceptionsOf(report), /register/);
});

// --- 违规夹具：每一类跨边界深导入都要被点名（exit 1）---

test('违规①：feature→feature 深导入 → exit 1 且点名文件/行号/导入目标', () => {
  const { status, report } = runGuard({ root: fixture('feature-deep') });

  assert.equal(
    status,
    1,
    `未抓到跨 feature 深导入：${violationsOf(report) || undeterminedOf(report)}`,
  );
  assert.match(violationsOf(report), /feature-deep\/features\/beta\/view\.ts:2/);
  assert.match(violationsOf(report), /@\/features\/alpha\/state\/session/);
});

test('违规②：app→feature 深导入 → exit 1 且点名', () => {
  const { status, report } = runGuard({ root: fixture('app-deep') });

  assert.equal(status, 1, `未抓到 app 根深导入：${violationsOf(report) || undeterminedOf(report)}`);
  assert.match(violationsOf(report), /app-deep\/app\/page\.tsx/);
  assert.match(violationsOf(report), /@\/features\/alpha\/model\/store/);
});

test('违规③：feature 引他 feature 的 register（ADR-0004 ②「feature 之间禁引」）→ exit 1', () => {
  const { status, report } = runGuard({ root: fixture('register-from-feature') });

  assert.equal(
    status,
    1,
    `未抓到 feature 引 register：${violationsOf(report) || undeterminedOf(report)}`,
  );
  assert.match(violationsOf(report), /register-from-feature\/features\/beta\/boot\.ts/);
  assert.match(violationsOf(report), /@\/features\/alpha\/register/);
  assert.match(violationsOf(report), /ADR-0004/);
});

test('违规④：app 显式引 `/index`（等价公开面但非登记写法）→ exit 1 且给公开面提示', () => {
  const { status, report } = runGuard({ root: fixture('index-explicit') });

  assert.equal(status, 1, `未抓到显式 /index：${violationsOf(report) || undeterminedOf(report)}`);
  assert.match(violationsOf(report), /@\/features\/alpha\/index/);
  assert.match(violationsOf(report), /公开面写法就是 '@\/features\/alpha'/);
});

test('违规⑤：feature→feature 引样式（样式例外限 app 根）→ exit 1', () => {
  const { status, report } = runGuard({ root: fixture('style-feature-deep') });

  assert.equal(
    status,
    1,
    `未抓到跨 feature 样式深引：${violationsOf(report) || undeterminedOf(report)}`,
  );
  assert.match(violationsOf(report), /style-feature-deep\/features\/beta\/view\.ts/);
  assert.match(violationsOf(report), /alpha\.css/);
});

// --- 阻塞语义（exit 2，禁当通过也禁误报违规）---

test('阻塞①：源码根不存在 → exit 2（前置不成立，判据读不到源码树）', () => {
  const { status, report } = runGuard({ root: fixture('does-not-exist') });

  assert.equal(status, 2, `应记阻塞：违规=${violationsOf(report)}`);
  assert.match(undeterminedOf(report), /不存在|读不到/);
});

test('阻塞②：源码根缺 features 根 → exit 2（双侧判据不成立）', () => {
  const { status, report } = runGuard({ root: fixture('missing-features') });

  assert.equal(status, 2);
  assert.match(undeterminedOf(report), /features/);
});

test('阻塞③：动态导入目标静态判不出（模板含插值）→ exit 2', () => {
  const { status, report } = runGuard({ root: fixture('dynamic-unresolvable') });

  assert.equal(status, 2, `应记无法判定：违规=${violationsOf(report)}`);
  assert.match(undeterminedOf(report), /动态导入|判不出/);
});

// --- 日志口径：1 优先于 2，但两类问题必须同时列出（阻塞信息不得被吞）---

test('混合夹具（深导入违规 + 动态导入未判定并存）→ exit 1（违规优先），两类清单都非空', () => {
  const { status, report } = runGuard({ root: fixture('mixed') });

  assert.equal(status, 1, `违规优先语义：${violationsOf(report)} / ${undeterminedOf(report)}`);
  assert.match(violationsOf(report), /beta\/view\.ts/);
  assert.match(undeterminedOf(report), /app\/dyn\.ts/);
});

test('混合夹具的人类可读日志：✗ 违规明细与 ? 未判定明细同屏，结论行点名未判定计数', () => {
  const { status, log } = runGuardLog({ root: fixture('mixed') });

  assert.equal(status, 1);
  assert.match(log, /✗ .*beta\/view\.ts/);
  assert.match(log, /\? .*app\/dyn\.ts/);
  assert.match(log, /结论：违规（exit 1）/);
  assert.match(log, /另有 1 项未判定/);
});
