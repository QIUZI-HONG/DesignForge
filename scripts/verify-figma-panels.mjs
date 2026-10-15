#!/usr/bin/env node
/**
 * verify-figma-panels —— 面板级对照门禁（FE-04 交付；本票范围内自管，**不接 CI**）。
 *
 * 对照面（C3/C4）：`/editor` 路由里挂载的图层面板与资产面板（`data-df-panel` 边界），
 * 以及验收标准 §5 的六态挂点（hover / active(focus-visible) / disabled / loading / empty / error）
 * 与 C3/C4 要点派生出的交互态（选中行、右键菜单、Token 分段、搜索无果）。
 *
 * 取样口径：**面板完整边界 + 8px 边距**（briefs/fe-04.md §4）——按元素包围盒外扩固定边距裁图，
 * 两侧（参照集与实际）同一 DPR（1.5，与《前端验收标准 v1》§3 一致）。
 *
 * 判定：pixelmatch 8.0.0（threshold 0.1，忽略抗锯齿像素）逐单元比对，
 * 差异像素率 ≤ `--max-ratio`（默认 0.001 = A 级 0.1%）为通过。
 *
 * 退出码（三态，**禁止假绿**）：
 *   0 = 全部通过；
 *   1 = 有单元超差或参照图缺失（参照集已冻结的前提下）；
 *   2 = **阻塞**——参照集未冻结（REF-01 未完成）/ 站点不可达 / 未找到 Chromium /
 *       或某些状态挂点在宿主页上还取不到（记录为 pending，绝不计为通过）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-figma-panels.mjs                      # 默认 http://127.0.0.1:3210/editor
 *   DF_PANELS_URL=http://127.0.0.1:3000/editor node scripts/verify-figma-panels.mjs
 *   node scripts/verify-figma-panels.mjs --only layers/panel --verbose
 *
 * 环境变量：DF_WEB_URL（站点根，默认 http://127.0.0.1:3210）、DF_PANELS_URL（面板页，优先）、
 *           DF_REF_DIR（参照集根，默认 ~/df-evidence/reference-v1，面板参照放在其 panels/ 子目录）、
 *           DF_EVIDENCE_DIR（证据根，默认 ~/df-evidence）、
 *           BENCH_CHROME_EXECUTABLE（Chromium 可执行文件；否则自动探测缓存）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const WEB_URL = process.env.DF_WEB_URL ?? 'http://127.0.0.1:3210';
const PANELS_URL = process.env.DF_PANELS_URL ?? `${WEB_URL}/editor`;
const REF_ROOT = resolve(process.env.DF_REF_DIR ?? join(homedir(), 'df-evidence', 'reference-v1'));
/** 面板参照集子目录：与组件级（FE-01）取样名空间隔离。 */
const REF_DIR = join(REF_ROOT, 'panels');
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const TICKET = 'fe-04';
const THRESHOLD = 0.1;
/** 面板取样边距（spec：面板完整边界 + 8px）。 */
const MARGIN = 8;
const STATES = ['hover', 'active', 'disabled', 'loading', 'empty', 'error'];

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = flagValue('--only');
const maxRatio = Number(flagValue('--max-ratio') ?? '0.001');

const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const evidenceDir = join(EVIDENCE_ROOT, TICKET);
const evidencePath = join(evidenceDir, `verify-figma-panels-${stamp}.json`);

/** 行选择器（面板行带 `data-df-layer-row`）。 */
const ROW = '[data-df-layer-row]';

/**
 * 取样单元：`root` 是面板/状态容器的选择器；`prepare` 把宿主页推进到该状态。
 * prepare 拿不到目标（宿主还没提供该状态）即抛错 → 记 pending + exit 2，绝不算通过。
 */
const SAMPLES = [
  {
    id: 'layers/panel',
    root: '[data-df-panel="layers"]',
    note: '图层面板整体（默认态：展开树 + 行）',
  },
  {
    id: 'layers/row-hover',
    root: '[data-df-panel="layers"]',
    note: '行悬停（验收 §5 hover 挂点：data-df-state="hover"）',
    prepare: async (page) => {
      await page.locator(ROW).first().hover();
      await page.waitForSelector(`${ROW}[data-df-state="hover"]`, { timeout: 2000 });
    },
  },
  {
    id: 'layers/row-selected',
    root: '[data-df-panel="layers"]',
    note: '行选中（引擎选择 → 面板高亮，data-df-state="selected"）',
    prepare: async (page) => {
      await page.locator(ROW).first().click();
      await page.waitForSelector(`${ROW}[data-df-state="selected"]`, { timeout: 2000 });
    },
  },
  {
    id: 'layers/row-focus',
    root: '[data-df-panel="layers"]',
    note: '行键盘焦点（验收 §5 active/focus-visible：data-df-focus="true"）',
    prepare: async (page) => {
      await page.locator(ROW).first().focus();
      await page.keyboard.press('ArrowDown');
      await page.waitForSelector(`${ROW}[data-df-focus="true"]`, { timeout: 2000 });
    },
  },
  {
    id: 'layers/row-disabled',
    root: '[data-df-panel="layers"]',
    note: '禁用态（祖先锁定的行按钮；验收 §5 disabled）',
    prepare: async (page) => {
      await page
        .locator(`${ROW} button:disabled`)
        .first()
        .waitFor({ state: 'attached', timeout: 2000 });
    },
  },
  {
    id: 'layers/menu-open',
    root: '[data-df-sample="layers/menu-open"]',
    note: '右键菜单（重命名/删除/编组/解组/上移到顶/下移到底）',
    prepare: async (page) => {
      await page.locator(ROW).first().click({ button: 'right' });
      await page.waitForSelector('[data-df-sample="layers/menu-open"]', { timeout: 2000 });
    },
  },
  {
    id: 'layers/empty',
    root: '[data-df-sample="layers/empty"]',
    note: '空态（无图层；验收 §5 empty，需宿主页提供空文档）',
  },
  {
    id: 'layers/loading',
    root: '[data-df-sample="layers/loading"]',
    note: '加载态（骨架行；验收 §5 loading，需宿主页提供 loading 语义）',
  },
  {
    id: 'layers/error',
    root: '[data-df-sample="layers/error"]',
    note: '错误态 + 重试（验收 §5 error，需宿主页提供 error 语义）',
  },
  {
    id: 'assets/components',
    root: '[data-df-sample="assets/components"]',
    note: '资产面板 · 组件分段（组件卡 + 组件紫缩略图）',
    prepare: openAssetsTab,
  },
  {
    id: 'assets/tokens',
    root: '[data-df-sample="assets/tokens"]',
    note: '资产面板 · Token 分段（别名已解析）',
    prepare: async (page) => {
      await openAssetsTab(page);
      await page.getByRole('radio', { name: 'Token' }).click();
      await page.waitForSelector('[data-df-sample="assets/tokens"]', { timeout: 2000 });
    },
  },
  {
    id: 'assets/no-results',
    root: '[data-df-sample="assets/no-results"]',
    note: '搜索无果空态',
    prepare: async (page) => {
      await openAssetsTab(page);
      await page.getByPlaceholder('搜索资产').fill('不存在的资产名');
      await page.waitForSelector('[data-df-sample="assets/no-results"]', { timeout: 2000 });
    },
  },
  {
    id: 'assets/empty',
    root: '[data-df-sample="assets/empty"]',
    note: '空态（无组件；需宿主页提供无组件文档）',
  },
  {
    id: 'assets/loading',
    root: '[data-df-sample="assets/loading"]',
    note: '加载态（骨架卡）',
  },
  {
    id: 'assets/error',
    root: '[data-df-sample="assets/error"]',
    note: '错误态 + 重试',
  },
];

/** 切到资产页签（宿主若是组合左栏；若已直接渲染资产面板则跳过）。 */
async function openAssetsTab(page) {
  if ((await page.locator('[data-df-panel="assets"]').count()) > 0) return;
  await page.getByRole('radio', { name: '资产' }).click({ timeout: 3000 });
  await page.waitForSelector('[data-df-panel="assets"]', { timeout: 3000 });
}

/** 证据骨架（字段按《前端验收标准 v1》§4；阻塞时也落盘，记录待办）。 */
function baseEvidence() {
  return {
    ticket: 'FE-04',
    gate: 'verify-figma-panels',
    page: PANELS_URL,
    level: 'A（布局/几何/颜色；字形与阴影按 B 级人工复核）',
    params: {
      threshold: THRESHOLD,
      maxRatio,
      engine: 'pixelmatch@8.0.0',
      aaIgnore: true,
      margin: MARGIN,
      engineVersionNote: '升级比对库 = 重定基线（研究 #5 §3.4）',
    },
    viewport: { width: 1440, height: 900, dpr: 1.5 },
    startedAt: startedAt.toISOString(),
    webUrl: WEB_URL,
    panelsUrl: PANELS_URL,
    referenceDir: REF_DIR,
    samples: [],
    stateCoverage: STATES.map((state) => ({ state, samples: [], status: 'pending' })),
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

/** 缓存的 Chromium 可执行文件（研究 #5：playwright-core 1.63 需显式 executablePath）。 */
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
async function probeSite(url) {
  try {
    const response = await fetch(url, { redirect: 'manual' });
    return { reachable: response.status < 500, status: response.status };
  } catch (error) {
    return { reachable: false, status: 0, error: String(error) };
  }
}

const evidence = baseEvidence();

// —— 第一道：参照集（REF-01）。未冻结 = 阻塞，任何「通过」都是假绿。 ——
const reference = inspectReferenceDir();
if (!reference.ready) {
  evidence.blockedReason = reference.reason;
  finish(
    evidence,
    2,
    [
      '阻塞：参照集未冻结（REF-01 未完成）。',
      `原因：${reference.reason}`,
      `面板参照集路径：${REF_DIR}（文件名 = 取样名把 / 换成 _，如 layers_panel.png）`,
      '待办：冻结参照集后运行本门禁逐单元取证；在此之前不得以自截图/近似图假绿。',
    ].join('\n'),
  );
}

// —— 第二道：站点与面板是否已挂载（FE-03 的编辑器路由）。 ——
const site = await probeSite(PANELS_URL);
if (!site.reachable) {
  evidence.blockedReason = `面板页不可达：${PANELS_URL}（HTTP ${String(site.status)}）`;
  finish(
    evidence,
    2,
    [
      '阻塞：面板页不可达（本门禁需面板可访问）。',
      `提示：先起站点（如 pnpm --filter @dforge/web build && pnpm --filter @dforge/web start），`,
      '或设置 DF_PANELS_URL 指向已挂载面板的页面。',
    ].join('\n'),
  );
}

const chrome = resolveChrome();
if (chrome === undefined) {
  evidence.blockedReason = '未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）';
  finish(
    evidence,
    2,
    '阻塞：未找到 Chromium 可执行文件（研究 #5：playwright-core 需显式 executablePath）。',
  );
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
await page.goto(PANELS_URL, { waitUntil: 'networkidle' });
// 字体就绪后再取样（ADR-0003：禁止静默回退；字体未就绪的截图一律不可作判据）
await page.evaluate(() => document.fonts.ready);

const mounted = await page.locator('[data-df-panel]').count();
if (mounted === 0) {
  await browser.close();
  evidence.blockedReason = `页面未挂载面板（找不到 [data-df-panel]）：${PANELS_URL}`;
  finish(
    evidence,
    2,
    [
      '阻塞：宿主页未挂载图层面板/资产面板。',
      '待办：FE-03 编辑器壳在编辑器路由挂载 `features/editor-panels` 的 EditorPanels（或单独挂 LayersPanel/AssetsPanel）后重跑。',
    ].join('\n'),
  );
}

const targets = only === undefined ? SAMPLES : SAMPLES.filter((sample) => sample.id === only);
let failures = 0;
let pending = 0;

for (const sample of targets) {
  const safeName = sample.id.replaceAll('/', '_');
  const refPath = join(REF_DIR, `${safeName}.png`);
  const actualPath = join(actualDir, `${safeName}.png`);
  const record = { id: sample.id, note: sample.note, root: sample.root };

  try {
    // 每个单元从头开始：回首页再进状态（避免上一个单元的残留状态污染）
    await page.goto(PANELS_URL, { waitUntil: 'networkidle' });
    if (sample.prepare !== undefined) await sample.prepare(page);
    const target = page.locator(sample.root);
    await target.first().waitFor({ state: 'visible', timeout: 3000 });
    const box = await target.first().boundingBox();
    if (box === null) throw new Error('元素没有包围盒');
    // 面板完整边界 + 8px 边距（几何计算；边距是 spec 固定值）
    const clip = {
      x: Math.max(0, box.x - MARGIN),
      y: Math.max(0, box.y - MARGIN),
      width: box.width + MARGIN * 2,
      height: box.height + MARGIN * 2,
    };
    await page.screenshot({ path: actualPath, clip, animations: 'disabled' });
  } catch (error) {
    pending += 1;
    record.status = 'pending';
    record.reason = `状态在宿主页上取不到：${error instanceof Error ? error.message : String(error)}`;
    evidence.samples.push(record);
    if (verbose) console.error(`  … ${sample.id}：${record.reason}`);
    continue;
  }

  if (!existsSync(refPath)) {
    failures += 1;
    record.status = 'missing-reference';
    record.reference = refPath;
    evidence.samples.push(record);
    if (verbose) console.error(`  ✗ ${sample.id}：参照图缺失（${safeName}.png）`);
    continue;
  }

  const refPng = PNG.sync.read(readFileSync(refPath));
  const actualPng = PNG.sync.read(readFileSync(actualPath));
  if (refPng.width !== actualPng.width || refPng.height !== actualPng.height) {
    failures += 1;
    record.status = 'size-mismatch';
    record.reference = { width: refPng.width, height: refPng.height };
    record.actual = { width: actualPng.width, height: actualPng.height };
    evidence.samples.push(record);
    continue;
  }

  const diffPng = new PNG({ width: refPng.width, height: refPng.height });
  const diffPixels = pixelmatch(
    refPng.data,
    actualPng.data,
    diffPng.data,
    refPng.width,
    refPng.height,
    {
      threshold: THRESHOLD,
      includeAA: false,
    },
  );
  const total = refPng.width * refPng.height;
  const ratio = total === 0 ? 0 : diffPixels / total;
  const diffPath = join(diffDir, `${safeName}.png`);
  writeFileSync(diffPath, PNG.sync.write(diffPng));

  const status = ratio <= maxRatio ? 'pass' : 'fail';
  if (status === 'fail') failures += 1;
  record.status = status;
  record.diff = {
    diffPixels,
    totalPixels: total,
    ratio: Number(ratio.toFixed(6)),
    bbox: bboxOfDiff(diffPng, refPng.width, refPng.height),
  };
  record.artifacts = {
    ref: fingerprint(refPath),
    actual: fingerprint(actualPath),
    diff: fingerprint(diffPath),
  };
  evidence.samples.push(record);
  if (verbose) {
    console.error(
      `  ${status === 'pass' ? '✓' : '✗'} ${sample.id}：差异率 ${(ratio * 100).toFixed(4)}%`,
    );
  }
}

for (const state of STATES) {
  const hits = targets.filter((sample) => sample.id.endsWith(`/${state}`));
  evidence.stateCoverage = evidence.stateCoverage.map((item) =>
    item.state === state
      ? {
          ...item,
          samples: hits.map((sample) => sample.id),
          status: hits.length === 0 ? 'missing' : 'covered',
          note:
            hits.length === 0
              ? '本票未列出该态的独立取样单元（按需补挂点）。'
              : '有取样单元；待参照集冻结后逐单元出 A 级结论（缺项即缺陷）。',
        }
      : item,
  );
}

await browser.close();

/** 差异像素包围盒（A 级几何断言的落点信息）。 */
function bboxOfDiff(diffPng, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      // pixelmatch 把差异像素涂成红色（255,0,0）
      if (
        diffPng.data[index] === 255 &&
        diffPng.data[index + 1] === 0 &&
        diffPng.data[index + 2] === 0
      ) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// 判定：pending（状态取不到）= 阻塞；超差/缺参照 = 违规；否则通过。
if (pending > 0) {
  finish(
    evidence,
    2,
    [
      `阻塞：${String(pending)} 个取样单元的状态在宿主页上取不到（记录为 pending，不计通过）。`,
      '提示：宿主页需要提供对应状态（空文档 / loading / error / 锁定祖先等），见各单元 note。',
    ].join('\n'),
  );
}

const code = failures === 0 ? 0 : 1;
finish(
  evidence,
  code,
  failures === 0
    ? `通过：${String(targets.length)} 个取样单元全部在容差内（≤ ${(maxRatio * 100).toFixed(2)}%）。`
    : `违规：${String(failures)} 个单元超差或参照图缺失（逐单元明细见证据 JSON）。`,
);
