/**
 * `scripts/lib/figma-evidence.mjs` 的行为回归测试（arch-04 · figma 取证 module 收口）。
 *
 * 为什么需要它：7 份 `verify-figma-*` 门禁此前各存一份 `baseEvidence`/`finish`/
 * `fingerprint`/`inspectReferenceDir`/`resolveChrome`/`probeSite`，且 `finish` 签名已分叉
 * （`inspect` 为 `(code, message)`）、Chromium 解析语义已分叉（7 份不校验
 * `BENCH_CHROME_EXECUTABLE` 存在性）。本测试锁定收口后的**外部契约**：
 *   - 三态退出码 0/1/2（阻塞 ≠ 通过）；
 *   - 证据 JSON 的键集与落盘文件名（逐门禁证据形状不变）；
 *   - `finish` 统一签名 `(evidence, code, message)`；
 *   - Chromium 解析统一以 `lib/browser-toolchain.mjs` 为准（非法 env 直接阻塞）。
 *
 * 夹具全部在临时目录里造（假页面 / 假参照集 / 假截图器），不依赖开发机状态，
 * 也不读 `~/df-evidence/**`（CI 无仓外证据）。
 *
 * 用法：`pnpm test:scripts`。退出码：0 全过 / 1 有失败。
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { after, test } from 'node:test';

import { PNG } from 'pngjs';

import { resolveChromeExecutable } from '../lib/browser-toolchain.mjs';
import { finish, gateExitCode, inspectReferenceDir, runFigmaGate } from '../lib/figma-evidence.mjs';

/** 每个用例一个独立临时根（假参照集 / 假证据 / 假截图都落这里）。 */
const roots = [];
function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'df-figma-evidence-test-'));
  roots.push(root);
  return root;
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** 写一张纯色 PNG（默认 2×2；r 通道区分参照图与实际图）。 */
function paintPng(filePath, red, width = 2, height = 2) {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = red;
    png.data[index + 1] = 0;
    png.data[index + 2] = 0;
    png.data[index + 3] = 255;
  }
  writeFileSync(filePath, PNG.sync.write(png));
}

/** 假页面：截图器把「实际图」写成指定颜色；其余 API 只记录调用。 */
function fakePage({ actualRed = 255, missingUnit = false, prepareThrows = false } = {}) {
  const calls = [];
  const write = (filePath) => paintPng(filePath, actualRed);
  const locator = (selector) => {
    const handle = {
      async count() {
        return missingUnit ? 0 : 1;
      },
      first() {
        return handle;
      },
      async waitFor() {},
      async boundingBox() {
        return { x: 10, y: 20, width: 30, height: 40 };
      },
      async screenshot({ path }) {
        calls.push(['element-screenshot', selector]);
        write(path);
      },
    };
    return handle;
  };
  return {
    calls,
    async goto(url) {
      calls.push(['goto', url]);
    },
    async evaluate() {
      return undefined;
    },
    async waitForSelector() {},
    async waitForTimeout() {},
    locator,
    async screenshot({ path }) {
      calls.push(['page-screenshot']);
      write(path);
    },
    async $$eval() {
      return [];
    },
    async getAttribute() {
      return null;
    },
    prepareThrows,
  };
}

/** 假浏览器：一个 context 一个 page；`close` 可断言。 */
function fakeBrowser(page) {
  const state = { contexts: 0, closed: false };
  return {
    state,
    async newContext() {
      state.contexts += 1;
      return {
        async newPage() {
          return page;
        },
        async close() {},
      };
    },
    async close() {
      state.closed = true;
    },
  };
}

/** 标准测试门禁 spec：一个单元、元素截图、参照集目录可注入。 */
function gateSpec({ referenceDir, evidenceRoot, page = fakePage(), deps = {} }) {
  return {
    gateName: 'verify-figma-test',
    ticket: 'T-01',
    page: '/_design',
    level: 'A（布局/几何/颜色；字形与阴影按 B 级人工复核）',
    params: {
      threshold: 0.1,
      maxRatio: 0.001,
      engine: 'pixelmatch@8.0.0',
      aaIgnore: true,
      engineVersionNote: '测试口径',
    },
    viewport: { width: 1440, height: 900, dpr: 1.5 },
    extras: { webUrl: 'http://127.0.0.1:3210' },
    stateCoverage: [{ state: 'default', status: 'pending' }],
    recordKey: 'units',
    evidenceShape: 'unit',
    referenceDir,
    evidenceRoot,
    url: 'http://127.0.0.1:3210/_design',
    units: [{ id: 'unit/a' }],
    capture: { kind: 'element' },
    thresholds: { threshold: 0.1, maxRatio: 0.001 },
    reference: { when: 'early' },
    probe: { url: 'http://127.0.0.1:3210/_design', mode: 'follow' },
    chrome: {},
    deps: {
      now: () => new Date('2026-11-04T00:00:00.000Z'),
      log: () => {},
      exit: () => {},
      launchBrowser: async () => fakeBrowser(page),
      probe: async () => ({ reachable: true, status: 200 }),
      resolveChrome: () => '/fake/chrome',
      ...deps,
    },
  };
}

test('三态退出码：0 通过 / 1 违规 / 2 阻塞（阻塞优先，pending 也是阻塞）', () => {
  assert.equal(gateExitCode({ blockedReasons: [], failures: 0, pending: 0 }), 0);
  assert.equal(gateExitCode({ blockedReasons: [], failures: 1, pending: 0 }), 1);
  assert.equal(gateExitCode({ blockedReasons: [], failures: 0, pending: 1 }), 2);
  assert.equal(
    gateExitCode({ blockedReasons: ['阻塞：参照集未冻结'], failures: 0, pending: 0 }),
    2,
  );
  // 阻塞优先于违规：exit 2 绝不能被「有失败」改写成 1（更不得当 0）
  assert.equal(gateExitCode({ blockedReasons: ['阻塞：x'], failures: 3, pending: 0 }), 2);
});

test('finish 统一签名 (evidence, code, message)：落盘 + 退出码 + 返回证据', () => {
  const evidenceRoot = tempRoot();
  const evidenceDir = join(evidenceRoot, 'T-01');
  const evidencePath = join(evidenceDir, 'verify-figma-test-2026-11-04T00-00-00.json');
  const evidence = { ticket: 'T-01', gate: 'verify-figma-test', units: [], exitCode: 2 };
  const exited = [];
  const logs = [];
  assert.equal(finish.length, 3);
  const result = finish(evidence, 2, '阻塞：测试', {
    evidenceDir,
    evidencePath,
    now: () => new Date('2026-11-04T00:00:01.000Z'),
    log: (line) => logs.push(line),
    exit: (code) => exited.push(code),
  });
  assert.equal(result.code, 2);
  assert.equal(result.evidence, evidence);
  assert.equal(evidence.exitCode, 2);
  assert.equal(evidence.finishedAt, '2026-11-04T00:00:01.000Z');
  assert.deepEqual(exited, [2]);
  assert.ok(logs.some((line) => line.includes('阻塞：测试')));
  assert.ok(logs.some((line) => line.includes(`证据：${evidencePath}`)));
  assert.deepEqual(JSON.parse(readFileSync(evidencePath, 'utf8')), evidence);
});

test('参照集探测：目录缺失 / 无 PNG = 未冻结；有 PNG = 已冻结', () => {
  const root = tempRoot();
  assert.equal(inspectReferenceDir(join(root, 'missing')).ready, false);
  const empty = join(root, 'empty');
  mkdirSync(empty);
  assert.equal(inspectReferenceDir(empty).ready, false);
  const ready = join(root, 'ready');
  mkdirSync(ready);
  paintPng(join(ready, 'unit_a.png'), 255);
  const result = inspectReferenceDir(ready);
  assert.equal(result.ready, true);
  assert.deepEqual(result.files, ['unit_a.png']);
});

test('Chromium 解析统一：非法 BENCH_CHROME_EXECUTABLE 不得绕过存在性校验', () => {
  const previous = process.env.BENCH_CHROME_EXECUTABLE;
  try {
    process.env.BENCH_CHROME_EXECUTABLE = '/definitely/not/a/chrome';
    assert.equal(resolveChromeExecutable(), undefined);
  } finally {
    if (previous === undefined) delete process.env.BENCH_CHROME_EXECUTABLE;
    else process.env.BENCH_CHROME_EXECUTABLE = previous;
  }
});

test('runFigmaGate：参照图与实际图一致 → exit 0，证据落盘且键集稳定', async () => {
  const root = tempRoot();
  const referenceDir = join(root, 'reference');
  const evidenceRoot = join(root, 'evidence');
  mkdirSync(referenceDir);
  paintPng(join(referenceDir, 'unit_a.png'), 255);
  const page = fakePage({ actualRed: 255 });
  const browser = fakeBrowser(page);
  const result = await runFigmaGate(
    gateSpec({
      referenceDir,
      evidenceRoot,
      page,
      deps: { launchBrowser: async () => browser },
    }),
  );
  assert.equal(result.code, 0);
  assert.equal(result.evidence.exitCode, 0);
  assert.equal(result.evidence.units[0].status, 'pass');
  assert.ok(browser.state.closed);
  const evidencePath = join(evidenceRoot, 'T-01', 'verify-figma-test-2026-11-04T00-00-00.json');
  assert.ok(existsSync(evidencePath));
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.exitCode, 0);
  assert.equal(typeof evidence.finishedAt, 'string');
  assert.deepEqual(Object.keys(evidence).sort(), [
    'artifacts',
    'exitCode',
    'finishedAt',
    'gate',
    'humanReview',
    'level',
    'page',
    'params',
    'referenceDir',
    'startedAt',
    'stateCoverage',
    'ticket',
    'units',
    'viewport',
    'webUrl',
  ]);
  assert.deepEqual(Object.keys(evidence.humanReview).sort(), ['reason', 'reviewer', 'verdict']);
  assert.deepEqual(Object.keys(evidence.viewport).sort(), ['dpr', 'height', 'width']);
  assert.deepEqual(evidence.units[0].diff.totalPixels, 4);
  assert.equal(evidence.units[0].diff.diffPixels, 0);
});

test('runFigmaGate：参照图与实际图不一致 → exit 1（违规），差异率入证据', async () => {
  const root = tempRoot();
  const referenceDir = join(root, 'reference');
  const evidenceRoot = join(root, 'evidence');
  mkdirSync(referenceDir);
  paintPng(join(referenceDir, 'unit_a.png'), 0);
  const page = fakePage({ actualRed: 255 });
  const browser = fakeBrowser(page);
  const result = await runFigmaGate(
    gateSpec({
      referenceDir,
      evidenceRoot,
      page,
      deps: { launchBrowser: async () => browser },
    }),
  );
  assert.equal(result.code, 1);
  assert.equal(result.evidence.exitCode, 1);
  assert.equal(result.evidence.units[0].status, 'fail');
  assert.ok(result.evidence.units[0].diff.ratio > 0.001);
});

test('runFigmaGate：参照集未冻结 → exit 2（阻塞），不启浏览器', async () => {
  const root = tempRoot();
  const referenceDir = join(root, 'reference');
  mkdirSync(referenceDir);
  const browser = fakeBrowser(fakePage());
  let launched = false;
  const result = await runFigmaGate(
    gateSpec({
      referenceDir,
      evidenceRoot: join(root, 'evidence'),
      page: browser,
      deps: {
        launchBrowser: async () => {
          launched = true;
          return browser;
        },
      },
    }),
  );
  assert.equal(result.code, 2);
  assert.equal(result.evidence.exitCode, 2);
  assert.match(result.evidence.blockedReason, /参照集/);
  assert.equal(launched, false);
  assert.equal(browser.state.closed, false);
  assert.equal(result.evidence.units.length, 0);
});

test('runFigmaGate：站点不可达 → exit 2（阻塞），不启浏览器', async () => {
  const root = tempRoot();
  const referenceDir = join(root, 'reference');
  mkdirSync(referenceDir);
  paintPng(join(referenceDir, 'unit_a.png'), 255);
  const browser = fakeBrowser(fakePage());
  let launched = false;
  const result = await runFigmaGate(
    gateSpec({
      referenceDir,
      evidenceRoot: join(root, 'evidence'),
      page: browser,
      deps: {
        probe: async () => ({ reachable: false, status: 0, error: 'ECONNREFUSED' }),
        launchBrowser: async () => {
          launched = true;
          return browser;
        },
      },
    }),
  );
  assert.equal(result.code, 2);
  assert.match(result.evidence.blockedReason, /站点不可达/);
  assert.equal(launched, false);
});

test('runFigmaGate：Chromium 缺失 → exit 2（阻塞；合法前置不成立）', async () => {
  const root = tempRoot();
  const referenceDir = join(root, 'reference');
  mkdirSync(referenceDir);
  paintPng(join(referenceDir, 'unit_a.png'), 255);
  const result = await runFigmaGate(
    gateSpec({
      referenceDir,
      evidenceRoot: join(root, 'evidence'),
      deps: { resolveChrome: () => undefined },
    }),
  );
  assert.equal(result.code, 2);
  assert.match(result.evidence.blockedReason, /Chromium/);
});

test('证据记录：unit/editor 的 missing-reference 与 size-mismatch 均带 status（arch-fix 发现 2）', async () => {
  const cases = [
    { shape: 'unit', status: 'missing-reference', reference: null },
    { shape: 'unit', status: 'size-mismatch', reference: [3, 1] },
    { shape: 'editor', status: 'missing-reference', reference: null },
    { shape: 'editor', status: 'size-mismatch', reference: [3, 1] },
  ];
  for (const item of cases) {
    const root = tempRoot();
    const referenceDir = join(root, 'reference');
    mkdirSync(referenceDir);
    // 参照集目录必须「已冻结」（有 PNG），但本单元的参照图缺失 / 尺寸不符
    if (item.reference === null) paintPng(join(referenceDir, 'other.png'), 255);
    else paintPng(join(referenceDir, 'unit_a.png'), 255, item.reference[0], item.reference[1]);
    const result = await runFigmaGate({
      ...gateSpec({ referenceDir, evidenceRoot: join(root, 'evidence'), page: fakePage() }),
      evidenceShape: item.shape,
    });
    const label = `${item.shape}/${item.status}`;
    assert.equal(result.code, 1, label);
    const record = result.evidence.units[0];
    assert.equal(record.status, item.status, label);
    if (item.status === 'missing-reference') {
      assert.ok(record.reference.endsWith('unit_a.png'), label);
    } else {
      assert.deepEqual(record.reference, { width: 3, height: 1 }, label);
      assert.deepEqual(record.actual, { width: 2, height: 2 }, label);
    }
  }
});

test('inspect 证据 ref 恢复为绝对路径（arch-fix 发现 3）', async () => {
  const root = tempRoot();
  const referenceDir = join(root, 'reference');
  mkdirSync(referenceDir);
  paintPng(join(referenceDir, 'unit_a.png'), 255);
  const result = await runFigmaGate({
    ...gateSpec({ referenceDir, evidenceRoot: join(root, 'evidence'), page: fakePage() }),
    evidenceShape: 'inspect',
    units: [{ id: 'unit/a', title: '单元 A', ref: 'unit_a.png' }],
  });
  assert.equal(result.code, 0);
  const ref = result.evidence.units[0].ref;
  assert.equal(ref, join(referenceDir, 'unit_a.png'));
  assert.ok(isAbsolute(ref));
});
