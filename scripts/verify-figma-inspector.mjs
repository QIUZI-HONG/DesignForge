#!/usr/bin/env node
/**
 * verify-figma-inspector —— 页面级对照门禁（FE-05 交付；本票范围内自管，**不接 CI**）。
 *
 * 对照面：编辑器页的 Inspector 面板三态（清单 C5/C6/C7 · 深色 UI3）——
 *   ① 默认态（单选文本：六分区齐备）② 混选态（C6：混选「—」）③ 空选态（C7：画布设置）。
 * 参照集：`~/df-evidence/reference-v1/`（REF-01 冻结）中的三张对照图：
 *   `figma-editor-C5-inspector-dark-default.png` / `figma-editor-C6-inspector-dark-mixed.png`
 *   / `figma-editor-C7-canvas-settings-dark-empty.png`（命名口径见研究 #2 §2.3）。
 * 判定：pixelmatch 8.0.0（threshold 0.1，忽略抗锯齿）逐态比对，差异像素率 ≤ `--max-ratio`
 *   （默认 0.001，A 级 0.1%）；另有两类**功能性**断言（不依赖参照集）：
 *   - 结构不变量（DOM 级）：默认态六分区齐备（RW-10 分区口径：尺寸/填充/描边/圆角/效果/文字）/
 *     混选态字段显示「—」/ 空选态画布设置在场 / 控件高 = 28（深色族 `--dfg-control-height-md`）；
 *   - **提交时序**（300ms 语义）：连续输入后静默 300ms 只落**一条**命令，Esc 回滚零历史。
 *
 * 宿主协议（编辑器路由，FE-06 接线；`apps/web/src/features/inspector/preview.ts` 是预设来源）：
 *   1. `?df-state=default|mixed|empty` → 用 `previewSelection(state)` 作为选中集，
 *      `createPreviewDocument()` 作为文档，并把 `<html data-theme="dark">`；
 *   2. 暴露 `window.__dfInspectorProbe`：**对象挂点**（RW-04 起，见 canvas/register.tsx）——
 *      `{ undo: () => string[], redo: () => string[], node: (id) => Record<string, unknown> | undefined }`
 *      （读 CommandStack 历史与节点属性；门禁在页面内调用后取回普通数据）。
 *   缺任一项 → exit 2（阻塞：前置条件不成立，禁止假绿）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-figma-inspector.mjs                      # 默认 http://127.0.0.1:3210/editor
 *   DF_INSPECTOR_URL=http://127.0.0.1:3000/editor node scripts/verify-figma-inspector.mjs
 *   node scripts/verify-figma-inspector.mjs --state mixed --verbose
 *
 * 环境变量：DF_INSPECTOR_URL（宿主页）、DF_WEB_URL（站点前缀，默认 http://127.0.0.1:3210）、
 *           DF_REF_DIR（参照集）、DF_EVIDENCE_DIR（证据根）、BENCH_CHROME_EXECUTABLE（Chromium）、
 *           DF_INSPECTOR_NODE_ID（提交时序断言的目标节点 id，默认 pv_text）。
 *
 * 退出码（门禁三态，禁止假绿）：0 全部通过 / 1 有单元超差或不变量失败 / 2 **阻塞**
 * （参照集未冻结 / 站点不可达 / 宿主未按协议暴露 / Chromium 或依赖缺失）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { bboxOfDiff } from './lib/pixels.mjs';

const WEB_URL = process.env.DF_WEB_URL ?? 'http://127.0.0.1:3210';
const HOST_URL = process.env.DF_INSPECTOR_URL ?? `${WEB_URL}/editor`;
const REF_DIR = resolve(process.env.DF_REF_DIR ?? join(homedir(), 'df-evidence', 'reference-v1'));
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const TICKET = 'fe-05';
const THRESHOLD = 0.1;
const CONTROL_HEIGHT = 28; // 深色族「控件 28」（清单 C5）；来源 = --dfg-control-height-md
const COMMIT_WAIT_MS = 600; // > 300ms 提交窗口，留出渲染余量

/** 三态对照单元：状态名 → 参照图名 + 结构不变量。
 *  分区/字段 id 口径 = RW-10 重写后的实现（features/inspector/components/sections.tsx
 *  的 `data-df-inspector-section` / `data-df-inspector-field`），与
 *  InspectorPanel.test.tsx「折叠分区齐备」断言同源：默认态单选文本 → 六分区全开；
 *  混选态两个矩形 → 无文字分区；空选态画布设置无字段级挂点（只断根挂点）。 */
const STATES = [
  {
    state: 'default',
    title: 'C5 Inspector 默认态（单选文本：六分区齐备）',
    ref: 'figma-editor-C5-inspector-dark-default.png',
    expect: {
      sections: ['size', 'fill', 'stroke', 'corner', 'effects', 'text'],
      fields: [
        'x',
        'y',
        'width',
        'height',
        'rotation',
        'blendMode',
        'opacity',
        'fillColor',
        'fillOpacity',
        'strokeColor',
        'strokeWidth',
        'cornerRadius',
        'effects',
        'textAlign',
        'export',
      ],
    },
  },
  {
    state: 'mixed',
    title: 'C6 混选态（混合值显示「—」）',
    ref: 'figma-editor-C6-inspector-dark-mixed.png',
    expect: {
      sections: ['size', 'fill', 'stroke', 'corner', 'effects'],
      mixedFields: ['x'],
      singleFields: [{ field: 'width', value: '100' }],
    },
  },
  {
    state: 'empty',
    title: 'C7 空选态（画布设置）',
    ref: 'figma-editor-C7-canvas-settings-dark-empty.png',
    expect: {
      canvasSettings: true,
    },
  },
];

/** 验收标准 §5 六态在 Inspector 上的挂点（每态都要有证据，不许缺项）。 */
const STATE_COVERAGE = [
  { state: 'hover', hook: '对齐按钮 hover 底（.dfi-alignrow__button:hover）', via: 'screenshot' },
  {
    state: 'active',
    hook: '字段 focus-visible 焦点环（.dfi-numberfield:focus-within）',
    via: 'screenshot',
  },
  {
    state: 'disabled',
    hook: '导出禁用桩 [data-df-inspector-field="export"][data-df-state="disabled"]',
    via: 'dom',
  },
  { state: 'loading', hook: 'N/A：Inspector 无异步加载态（提交为同步命令）', via: 'n/a' },
  {
    state: 'empty',
    hook: '空选态画布设置 [data-df-inspector="canvas-settings"]',
    via: 'screenshot+dom',
  },
  { state: 'error', hook: '非法颜色回滚（jsdom 断言；无独立视觉态）', via: 'vitest' },
];

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = flagValue('--state');
const maxRatio = Number(flagValue('--max-ratio') ?? '0.001');

const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const evidenceDir = join(EVIDENCE_ROOT, TICKET);
const evidencePath = join(evidenceDir, `verify-figma-inspector-${stamp}.json`);

/** 证据骨架（字段按《前端验收标准 v1》§4）。 */
function baseEvidence() {
  return {
    ticket: 'FE-05',
    gate: 'verify-figma-inspector',
    page: '/editor（Inspector 面板 · 深色 UI3）',
    level: 'A（布局/几何/尺寸/颜色；字形与阴影按 B 级人工复核）',
    params: {
      threshold: THRESHOLD,
      maxRatio,
      engine: 'pixelmatch@8.0.0',
      aaIgnore: true,
      controlHeight: CONTROL_HEIGHT,
      commitWindowMs: 300,
      engineVersionNote: '升级比对库 = 重定基线（研究 #5 §3.4）',
    },
    viewport: { width: 1440, height: 900, dpr: 1.5 },
    startedAt: startedAt.toISOString(),
    hostUrl: HOST_URL,
    referenceDir: REF_DIR,
    units: [],
    stateCoverage: STATE_COVERAGE.map((entry) => ({ ...entry, status: 'pending' })),
    functional: { status: 'pending', assertions: [] },
    artifacts: {},
    humanReview: {
      verdict: 'pending',
      reviewer: null,
      reason: '自动判定只给 A 级结论；字形/阴影/动效终态按 B 级需人工复核登记。',
    },
    exitCode: 2,
  };
}

/** 落盘证据并结束进程。 */
function finish(evidence, code, message) {
  evidence.exitCode = code;
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (message) console.error(message);
  console.error(`证据：${evidencePath}`);
  process.exit(code);
}

/** 阻塞（exit 2）：前置条件不成立，绝不当作通过。 */
function blocked(evidence, reason, hints) {
  evidence.blockedReason = reason;
  finish(
    evidence,
    2,
    ['阻塞：前置条件不成立（exit 2 ≠ 通过）。', `原因：${reason}`, ...(hints ?? [])].join('\n'),
  );
}

/** `{sha256, length}` 指纹。 */
function fingerprint(filePath) {
  const buffer = readFileSync(filePath);
  return {
    path: filePath,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    length: buffer.length,
  };
}

/** 参照集探测：目录存在且有 PNG 才算「已冻结」。 */
function inspectReferenceDir() {
  if (!existsSync(REF_DIR)) return { ready: false, reason: `参照集目录不存在：${REF_DIR}` };
  const files = readdirSync(REF_DIR).filter((name) => name.endsWith('.png'));
  if (files.length === 0) return { ready: false, reason: `参照集为空（无 PNG）：${REF_DIR}` };
  return { ready: true, files };
}

/** 缓存的 Chromium 可执行文件（playwright-core 需显式 executablePath）。 */
function resolveChrome() {
  if (process.env.BENCH_CHROME_EXECUTABLE !== undefined) return process.env.BENCH_CHROME_EXECUTABLE;
  const cacheRoot = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cacheRoot)) return undefined;
  const candidates = readdirSync(cacheRoot)
    .filter((name) => name.startsWith('chromium-'))
    .sort()
    .map((name) => join(cacheRoot, name, 'chrome-linux64', 'chrome'));
  return candidates.find((file) => existsSync(file));
}

/** 站点探测（不可达即阻塞，不猜）。 */
async function probeHost() {
  try {
    const response = await fetch(`${HOST_URL}?df-state=default`, { redirect: 'follow' });
    return { reachable: response.ok, status: response.status };
  } catch (error) {
    return { reachable: false, status: 0, error: String(error) };
  }
}

const evidence = baseEvidence();
const reference = inspectReferenceDir();

if (!reference.ready) {
  evidence.stateCoverage = evidence.stateCoverage.map((entry) => ({
    ...entry,
    status: 'pending',
    note: 'REF-01（Figma 参照集冻结）未完成；本门禁按三态退出码记阻塞，禁止以近似图判绿。',
  }));
  blocked(evidence, `参照集未冻结：${reference.reason}`, [
    '阻塞：参照集未冻结。',
    '待办：REF-01 冻结后，按 figma-editor-C5-inspector-dark-default.png /',
    '      figma-editor-C6-inspector-dark-mixed.png / figma-editor-C7-canvas-settings-dark-empty.png',
    '      放入参照集目录再运行本门禁；在此之前任何「通过」都是假绿。',
  ]);
}

const host = await probeHost();
if (!host.reachable) {
  blocked(evidence, `宿主页不可达：${HOST_URL}（HTTP ${String(host.status)}）`, [
    '提示：先起站点（如 pnpm --filter @dforge/web build && pnpm --filter @dforge/web start），',
    '并确保编辑器路由按本脚本头部「宿主协议」暴露 ?df-state= 与 window.__dfInspectorProbe。',
  ]);
}

const chrome = resolveChrome();
if (chrome === undefined) {
  blocked(evidence, '未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）', [
    '阻塞：未找到 Chromium 可执行文件（playwright-core 1.63 需显式 executablePath）。',
  ]);
}

const { chromium } = await import('playwright-core');
const { PNG } = await import('pngjs');
const pixelmatch = (await import('pixelmatch')).default;

const actualDir = join(evidenceDir, 'actual');
const diffDir = join(evidenceDir, 'diff');
mkdirSync(actualDir, { recursive: true });
mkdirSync(diffDir, { recursive: true });

const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
const context = await browser.newContext({
  viewport: { width: evidence.viewport.width, height: evidence.viewport.height },
  deviceScaleFactor: evidence.viewport.dpr,
});
const page = await context.newPage();

const targets = only === undefined ? STATES : STATES.filter((entry) => entry.state === only);
if (targets.length === 0) {
  await browser.close();
  blocked(evidence, `未知的 --state=${String(only)}（可用：default / mixed / empty）`);
}

const panelSelector = '[data-df-inspector="panel"], [data-df-inspector="canvas-settings"]';
/** 提交时序断言的目标节点（默认 = 预览预设的文本节点；宿主换夹具时用环境变量覆盖）。 */
const PROBE_NODE_ID = process.env.DF_INSPECTOR_NODE_ID ?? 'pv_text';
let failures = 0;

for (const target of targets) {
  const unit = { state: target.state, title: target.title, status: 'pending', invariants: [] };
  evidence.units.push(unit);

  await page.goto(`${HOST_URL}?df-state=${target.state}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(panelSelector);
  // 字体就绪后再取样（禁静默回退；字体未就绪的截图不可作判据）
  await page.evaluate(() => document.fonts.ready);

  const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
  const probeFindings = await page.evaluate(
    ({ selector, expect, controlHeight }) => {
      const findings = [];
      const root = document.querySelector(selector);
      if (root === null) return [{ ok: false, note: `面板根未找到：${selector}` }];

      for (const id of expect.sections ?? []) {
        const found = document.querySelector(`[data-df-inspector-section="${id}"]`);
        findings.push({ ok: found !== null, note: `分区 ${id}` });
      }
      for (const name of expect.fields ?? []) {
        const found = document.querySelector(`[data-df-inspector-field="${name}"]`);
        findings.push({ ok: found !== null, note: `字段 ${name}` });
      }
      for (const name of expect.mixedFields ?? []) {
        const wrap = document.querySelector(`[data-df-inspector-field="${name}"]`);
        const input = wrap?.querySelector('input');
        findings.push({
          ok: wrap?.getAttribute('data-df-state') === 'mixed' && input?.value === '—',
          note: `混选字段 ${name} 显示「—」`,
        });
      }
      for (const single of expect.singleFields ?? []) {
        const input = document
          .querySelector(`[data-df-inspector-field="${single.field}"]`)
          ?.querySelector('input');
        findings.push({
          ok: input?.value === single.value,
          note: `一致字段 ${single.field} 显示实值 ${single.value}`,
        });
      }
      if (expect.canvasSettings === true) {
        const found = document.querySelector('[data-df-inspector="canvas-settings"]');
        findings.push({ ok: found !== null, note: '画布设置在场' });
      }
      // 「控件 28」（深色族）：任取一个在场控件量高度（空选态画布设置无字段级挂点，跳过）
      const control = document.querySelector('[data-df-inspector-field="x"]');
      if (control !== null) {
        const height = Number.parseFloat(getComputedStyle(control).height);
        findings.push({
          ok: Number.isFinite(height) && Math.abs(height - controlHeight) < 0.5,
          note: `控件高 ${height}（对标 ${controlHeight}）`,
        });
      }
      return findings;
    },
    { selector: panelSelector, expect: target.expect, controlHeight: CONTROL_HEIGHT },
  );

  unit.invariants = probeFindings;
  if (theme !== 'dark') {
    unit.theme = theme;
    unit.invariants.push({ ok: false, note: `页面主题应为 dark（当前 ${String(theme)}）` });
  }
  const badInvariants = unit.invariants.filter((item) => item.ok !== true);
  if (badInvariants.length > 0) {
    unit.status = 'invariant-failed';
    failures += 1;
    if (verbose) {
      for (const item of badInvariants) console.error(`  ✗ ${target.state}：${item.note}`);
    }
    continue;
  }

  const actualPath = join(actualDir, `${target.state}.png`);
  await page
    .locator(panelSelector)
    .first()
    .screenshot({ path: actualPath, animations: 'disabled' });
  evidence.artifacts[`${target.state}Actual`] = fingerprint(actualPath);

  const refPath = join(REF_DIR, target.ref);
  if (!existsSync(refPath)) {
    unit.status = 'missing-reference';
    unit.reference = refPath;
    failures += 1;
    if (verbose) console.error(`  ✗ ${target.state}：参照图缺失（${basename(refPath)}）`);
    continue;
  }
  evidence.artifacts[`${target.state}Ref`] = fingerprint(refPath);

  const refPng = PNG.sync.read(readFileSync(refPath));
  const actualPng = PNG.sync.read(readFileSync(actualPath));
  if (refPng.width !== actualPng.width || refPng.height !== actualPng.height) {
    unit.status = 'size-mismatch';
    unit.diff = {
      bbox: null,
      refSize: { width: refPng.width, height: refPng.height },
      actualSize: { width: actualPng.width, height: actualPng.height },
    };
    failures += 1;
    continue;
  }

  const diffPng = new PNG({ width: refPng.width, height: refPng.height });
  const diffPixels = pixelmatch(
    refPng.data,
    actualPng.data,
    diffPng.data,
    refPng.width,
    refPng.height,
    { threshold: THRESHOLD, includeAA: false },
  );
  const total = refPng.width * refPng.height;
  const ratio = total === 0 ? 0 : diffPixels / total;
  const diffPath = join(diffDir, `${target.state}.png`);
  writeFileSync(diffPath, PNG.sync.write(diffPng));

  unit.status = ratio <= maxRatio ? 'pass' : 'fail';
  if (unit.status === 'fail') failures += 1;
  unit.diff = {
    bbox: bboxOfDiff(diffPng),
    diffPixels,
    totalPixels: total,
    ratio: Number(ratio.toFixed(6)),
  };
  unit.artifacts = {
    ref: fingerprint(refPath),
    actual: fingerprint(actualPath),
    diff: fingerprint(diffPath),
  };
  if (verbose) {
    console.error(
      `  ${unit.status === 'pass' ? '✓' : '✗'} ${target.state}：差异率 ${(ratio * 100).toFixed(4)}%`,
    );
  }
}

/* ------------------------------------------------------------------------ *
 * 功能性断言：提交时序（300ms 语义；不依赖参照集）
 * ------------------------------------------------------------------------ */

if (only === undefined || only === 'default') {
  await page.goto(`${HOST_URL}?df-state=default`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-df-inspector-field="x"]');

  // 探针协议（RW-04 起）：__dfInspectorProbe 是**对象挂点**（{undo(), redo(), node(id)}），
  // 在页面内调用后取回普通数据（page.evaluate 只序列化返回值）。
  const hasProbe = await page.evaluate(
    () =>
      typeof globalThis.__dfInspectorProbe === 'object' &&
      globalThis.__dfInspectorProbe !== null &&
      typeof globalThis.__dfInspectorProbe.undo === 'function' &&
      typeof globalThis.__dfInspectorProbe.node === 'function',
  );
  if (!hasProbe) {
    await browser.close();
    blocked(evidence, '宿主页未暴露 window.__dfInspectorProbe（提交时序断言无法取证）', [
      '契约：window.__dfInspectorProbe = { undo: () => string[], redo: () => string[],',
      '  node: (id) => Record<string, unknown> | undefined }（对象挂点，非函数）；',
      'undo/redo 为 CommandStack.history() 的两个数组，node(id) 返回当前页面节点属性。',
      '见本脚本头部「宿主协议」第 2 条与 apps/web/src/features/canvas/register.tsx。',
    ]);
  }

  const readProbe = () =>
    page.evaluate(() => {
      const probe = globalThis.__dfInspectorProbe;
      return { undo: probe.undo(), redo: probe.redo() };
    });
  const readNode = (id) =>
    page.evaluate((nodeId) => globalThis.__dfInspectorProbe.node(nodeId), id);
  const before = await readProbe();
  const field = page.locator('[data-df-inspector-field="x"] input');

  // ① 连续输入 → 静默 300ms → 只落一条命令，且值为最后一次输入
  await field.click();
  await field.fill('1');
  await field.type('25');
  await page.waitForTimeout(COMMIT_WAIT_MS);
  const afterType = await readProbe();
  evidence.functional.assertions.push({
    name: '连续输入 300ms 后只提交一次',
    ok: afterType.undo.length === before.undo.length + 1,
    detail: { undoBefore: before.undo.length, undoAfter: afterType.undo.length },
  });
  evidence.functional.assertions.push({
    name: '提交值为最后一次输入（125）',
    ok: (await readNode(PROBE_NODE_ID))?.x === 125,
    detail: { x: (await readNode(PROBE_NODE_ID))?.x },
  });

  // ② Esc 回滚：不产生历史
  await field.fill('999');
  await field.press('Escape');
  await page.waitForTimeout(COMMIT_WAIT_MS);
  const afterEsc = await readProbe();
  const escNodeX = (await readNode(PROBE_NODE_ID))?.x;
  evidence.functional.assertions.push({
    name: 'Esc 回滚草稿（零历史、零副作用）',
    ok: afterEsc.undo.length === afterType.undo.length && escNodeX === 125,
    detail: {
      undo: afterEsc.undo.length,
      x: escNodeX,
    },
  });

  // ③ Enter 立即提交
  await field.fill('300');
  await field.press('Enter');
  const afterEnter = await readProbe();
  const enterNodeX = (await readNode(PROBE_NODE_ID))?.x;
  evidence.functional.assertions.push({
    name: 'Enter 立即提交（无需等待 300ms）',
    ok: afterEnter.undo.length === afterEsc.undo.length + 1 && enterNodeX === 300,
    detail: { undo: afterEnter.undo.length, x: enterNodeX },
  });

  const functionalFailed = evidence.functional.assertions.filter((item) => item.ok !== true);
  evidence.functional.status = functionalFailed.length === 0 ? 'pass' : 'fail';
  if (functionalFailed.length > 0) failures += 1;
}

await browser.close();

evidence.stateCoverage = STATE_COVERAGE.map((entry) => ({
  ...entry,
  status: entry.via === 'n/a' ? 'n/a' : failures === 0 ? 'covered' : 'pending',
}));

const code = failures === 0 ? 0 : 1;
finish(
  evidence,
  code,
  failures === 0
    ? `通过：${String(evidence.units.length)} 个对照态在容差内，且提交时序断言全过。`
    : `违规：${String(failures)} 项超差/不变量失败（逐项明细见证据 JSON）。`,
);
