/**
 * `scripts/guard-electron-baseline.mjs` 的**检出强度**回归测试（工作包 C · C7）。
 *
 * 为什么需要它：守卫是「禁用不安全窗口选项」的唯一机器可读声明，若它能被写法绕过，
 * 门禁就成了假绿——实测三类绕过（对象展开覆盖 / 计算属性名 / 分支内提前 return）曾全部 exit 0。
 * 本测试把每一类绕过都钉成夹具 + 断言（先红后绿），并保证**正例不误报**（真实源必须仍 exit 0）。
 *
 * 用法：`pnpm test:scripts`（node --test + Node 自带 glob，覆盖 scripts/tests 下全部 `*.test.mjs`；
 * 本机 Node 24 下目录形态 `node --test scripts/tests/` 被当成模块路径报 MODULE_NOT_FOUND，
 * 故不用目录形态）；
 * 退出码：0 全过 / 1 有失败。
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const guard = join(repoRoot, 'scripts', 'guard-electron-baseline.mjs');
const fixtureDir = join(here, 'fixtures', 'electron-baseline');
const fixture = (name) => join(fixtureDir, name);

/** 跑守卫（fixture 运行自动禁用运行时探针）。 */
function runGuard(source) {
  const result = spawnSync(process.execPath, [guard, '--json', `--source=${source}`], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  const stdout = (result.stdout ?? '').trim();
  assert.notEqual(stdout, '', `守卫未输出 JSON（stderr: ${result.stderr}）`);
  const report = JSON.parse(stdout);
  return { status: result.status, report };
}

/** 违规文本（用于「点名」断言）。 */
const violationsOf = (report) => (report.violations ?? []).join('\n');
const undeterminedOf = (report) => (report.undetermined ?? []).join('\n');

test('真实源（apps/desktop/src/main/window-options.ts）仍 exit 0——修好守卫不得把正例判红', () => {
  const { status, report } = runGuard(
    join(repoRoot, 'apps', 'desktop', 'src', 'main', 'window-options.ts'),
  );

  assert.equal(violationsOf(report), '');
  assert.equal(undeterminedOf(report), '');
  assert.equal(status, 0);
});

test('正例夹具（唯一声明点 + 直接展开 + 非基线键带表达式值）→ exit 0', () => {
  const { status, report } = runGuard(fixture('window-options.ok.ts'));

  assert.equal(violationsOf(report), '');
  assert.equal(status, 0);
});

// --- C7 三类必抓（coordinator 追加项）---

test('C7① 展开覆盖 `...{ sandbox: false }` → exit 1 且点名 sandbox', () => {
  const { status, report } = runGuard(fixture('window-options.bypass-spread-override.ts'));

  assert.equal(status, 1, `未抓到展开覆盖：${violationsOf(report) || undeterminedOf(report)}`);
  assert.match(violationsOf(report), /sandbox/);
});

test("C7② 计算属性名 `['sandbox']: false` → exit 1 且点名 sandbox", () => {
  const { status, report } = runGuard(fixture('window-options.bypass-computed-key.ts'));

  assert.equal(
    status,
    1,
    `未抓到计算属性名覆盖：${violationsOf(report) || undeterminedOf(report)}`,
  );
  assert.match(violationsOf(report), /sandbox/);
});

test('C7③ if 分支内提前 return 宽松配置 → exit 1（声明点不唯一）', () => {
  const { status, report } = runGuard(fixture('window-options.bypass-early-return.ts'));

  assert.equal(
    status,
    1,
    `未抓到分支内提前 return：${violationsOf(report) || undeterminedOf(report)}`,
  );
  assert.match(violationsOf(report), /webPreferences/);
});

// --- 自补反例（同类不同写法）---

test("C7④ 字符串字面量属性名 `'nodeIntegration': true` → exit 1 且点名", () => {
  const { status, report } = runGuard(fixture('window-options.bypass-string-key.ts'));

  assert.equal(status, 1, `未抓到字符串键覆盖：${violationsOf(report) || undeterminedOf(report)}`);
  assert.match(violationsOf(report), /nodeIntegration/);
});

test('C7⑤ 展开局部常量（`...LAX_OVERRIDES`）→ exit 1 且点名 sandbox/webSecurity', () => {
  const { status, report } = runGuard(fixture('window-options.bypass-spread-const.ts'));

  assert.equal(status, 1, `未解析局部常量：${violationsOf(report) || undeterminedOf(report)}`);
  assert.match(violationsOf(report), /sandbox/);
});

test('C7⑥ 放宽项经变量返回（`{ webPreferences: lax }`）→ exit 1', () => {
  const { status, report } = runGuard(fixture('window-options.bypass-var-return.ts'));

  assert.equal(status, 1, `未抓到变量返回：${violationsOf(report) || undeterminedOf(report)}`);
  assert.match(violationsOf(report), /webPreferences/);
});

test('C7⑦ 展开链（`...OUTER` → `...INNER` 含放宽项）→ exit 1 且点名 sandbox', () => {
  const { status, report } = runGuard(fixture('window-options.bypass-spread-chain.ts'));

  assert.equal(status, 1, `未跟进多跳展开：${violationsOf(report) || undeterminedOf(report)}`);
  assert.match(violationsOf(report), /sandbox/);
});

test('C7⑧ 展开无法判定的外部对象 → exit 2（阻塞，禁当通过也禁误报违规）', () => {
  const { status, report } = runGuard(fixture('window-options.blocked-spread-import.ts'));

  assert.equal(status, 2, `应记无法判定：违规=${violationsOf(report)}`);
  assert.match(undeterminedOf(report), /IMPORTED_PREFS|无法/);
});

// --- 原有基本盘（既有 fixture 语义不退化）---

test('原版反例：展开后直接覆盖 webSecurity → exit 1 且点名', () => {
  const { status, report } = runGuard(
    join(repoRoot, 'apps', 'desktop', 'test', 'fixtures', 'window-options.broken-override.ts'),
  );

  assert.equal(status, 1);
  assert.match(violationsOf(report), /webSecurity/);
});

test('原版反例：基线自身放宽 sandbox → exit 1 且点名 SECURITY_BASELINE.sandbox', () => {
  const { status, report } = runGuard(
    join(repoRoot, 'apps', 'desktop', 'test', 'fixtures', 'window-options.broken-sandbox.ts'),
  );

  assert.equal(status, 1);
  assert.match(violationsOf(report), /SECURITY_BASELINE\.sandbox/);
});

test('基线缺项 fixture → exit 2（静态判不出即阻塞）', () => {
  const { status, report } = runGuard(
    join(repoRoot, 'apps', 'desktop', 'test', 'fixtures', 'window-options.missing-key.ts'),
  );

  assert.equal(status, 2);
  assert.match(undeterminedOf(report), /webSecurity/);
});
