#!/usr/bin/env node
/**
 * 审计 04 · 编辑器与评审深挖（#54）——**一次性审计脚本，不是门禁**。
 *
 * 为什么不接 CI / 不写成必红测试：本脚本的产出是「当前事实 + 缺陷证据」，允许产品处于
 * partial/broken 状态；把它当门禁会让集成分支长期红。审计结论落
 * `docs/quality/audit-v1/04-editor-review.md`，是否固化为回归由后续票决定。
 *
 * 覆盖（全部在生产构建 `next build` + `next start` 上跑，不用 `next dev`）：
 *   1. 画布 13 类交互（选择/移动/缩放/旋转/画布缩放/平移/复制粘贴/层级/编组/撤销重做/
 *      对齐/吸附/文本编辑）——在 `/editor` 上以真实指针与键盘事件驱动；
 *   2. 保存 → 重载 → 逐字段恢复（daemon `.dfg` 目录态）；
 *   3. 评审：评论（发布/解决/刷新后仍在）、版本（快照/对比/两步确认/刷新后仍在）、
 *      演示（画板序列/键盘翻页/边界/Esc）；
 *   4. 文本与自动布局：文本节点内联编辑 + Inspector 自动布局入口（读点存在性）；
 *   5. 500 节点交互基线（measure-only，不设硬预算）；
 *   6. axe（axe-core 注入真实页面）覆盖首页/编辑器/市场/设置：critical/serious 结果、
 *      焦点顺序、空可访问名的可交互元素；
 *   7. 调用既有 `verify-figma-review` 门禁（预期 exit 2：REF-01 参照集未冻结）。
 *
 * 纪律：
 * - 自起临时 daemon（临时数据根）+ 空闲端口 + 同源网关；不碰 4318、3000 与 `~/.dforge`；
 * - 不写产品代码；证据落 `~/df-evidence/audit-50/aud-04/`；
 * - 三态退出码：0 = 审计完成（findings 已如实记录）；2 = 阻塞（构建/服务/浏览器起不来）；
 *   1 = 脚本自身异常（不是产品判定）。
 *
 * 用法（仓库根执行）：
 *   TMPDIR=~/df-evidence/audit-50/aud-04/tmp node scripts/audit/editor-review-audit.mjs
 *   … --skip-build（复用现有 .next） --skip-figma-review --verbose
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveChromeExecutable } from '../lib/browser-toolchain.mjs';
import { freePort, startFixtureDaemon, startSameOriginGateway } from '../lib/gates.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB_DIR = join(REPO_ROOT, 'apps', 'web');
const EVIDENCE_ROOT = resolve(
  process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence', 'audit-50', 'aud-04'),
);
const RUN_ID = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const RUN_DIR = join(EVIDENCE_ROOT, 'runtime', RUN_ID);
const AXE_DIR = join(EVIDENCE_ROOT, 'axe');
const SHOT_DIR = join(EVIDENCE_ROOT, 'shots');
const LOG_DIR = join(EVIDENCE_ROOT, 'logs');
const DATA_ROOT = join(RUN_DIR, 'data');
const WORKSPACE_DIR = join(DATA_ROOT, 'workspace');

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const skipBuild = args.includes('--skip-build');
const skipFigmaReview = args.includes('--skip-figma-review');

const DOCUMENT_NAME = '审计04-编辑器深挖';
const PERF_DOCUMENT_NAME = '审计04-性能基线';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** 审计证据骨架。 */
const evidence = {
  ticket: '#54',
  audit: 'audit-v1 · 04 编辑器与评审深挖',
  kind: 'one-off-audit（measure-only，不是门禁）',
  startedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    build: skipBuild ? 'reuse-existing .next' : 'next build（生产构建）',
    viewport: { width: 1440, height: 900 },
  },
  urls: {},
  interactions: [],
  persistence: [],
  review: { comments: [], versions: [], present: [], isolation: [] },
  textAndLayout: [],
  perf: null,
  axe: [],
  figmaReview: null,
  notes: [],
  exitCode: 2,
};

const children = new Set();
let webServer = null;
let daemon = null;
let gateway = null;
let browser = null;

function log(message) {
  console.log(`[audit-04] ${message}`);
}

function track(child) {
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = '未发起请求';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
      last = `HTTP ${String(response.status)}`;
    } catch (error) {
      last = String(error);
    }
    await sleep(300);
  }
  log(`${label} 等待超时（${last}）`);
  return false;
}

function record(section, id, ok, detail) {
  section.push({ id, ok, detail });
  log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${id} —— ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`,
  );
}

/** 同步杀自己起的子进程（只按精确子进程句柄，不用 pkill）。 */
function killChildren() {
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // 已退出
    }
  }
}

async function shutdown() {
  await browser?.close().catch(() => undefined);
  browser = null;
  await gateway?.close().catch(() => undefined);
  gateway = null;
  await daemon?.close().catch(() => undefined);
  daemon = null;
  if (webServer !== null) {
    const child = webServer;
    webServer = null;
    if (child.exitCode === null) {
      await new Promise((done) => {
        const timer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // 已退出
          }
          done();
        }, 5000);
        child.on('exit', () => {
          clearTimeout(timer);
          done();
        });
        child.kill('SIGTERM');
      });
    }
  }
  killChildren();
}

function writeEvidence(name, value) {
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  const path = join(EVIDENCE_ROOT, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  log(`证据：${path}`);
  return path;
}

async function finish(code, message) {
  evidence.finishedAt = new Date().toISOString();
  evidence.exitCode = code;
  await shutdown();
  writeEvidence(`editor-review-${RUN_ID}.json`, evidence);
  if (message !== undefined) console.error(message);
  process.exit(code);
}

process.on('exit', killChildren);
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  process.on(signal, () => {
    killChildren();
    process.exit(code);
  });
}

/** CanvasKit 运行时资产就位（`public/canvaskit/` 是生成物）。 */
function ensureCanvasKitAssets() {
  const script = join(WEB_DIR, 'src', 'features', 'canvas', 'tools', 'copy-canvaskit-assets.mjs');
  const result = spawnSync(process.execPath, [script], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status === 0) {
    if (verbose) log(result.stdout.trim());
    return true;
  }
  console.error(`CanvasKit 资产准备失败：${result.stderr ?? String(result.error)}`);
  return false;
}

/** 市场索引夹具（单条 view-only 资产；与 e2e nav 场景同形）。 */
function seedMarketIndex(dataRoot) {
  const marketDir = join(dataRoot, 'market');
  mkdirSync(marketDir, { recursive: true });
  const fixture = {
    schema: 'df.marketplace.index/v1',
    generatedAt: '2026-10-16T00:00:00.000Z',
    collector: { name: 'audit-04-fixture', version: '0.0.0', runId: 'aud-04', odsWatermark: '' },
    counts: {
      total: 1,
      byKind: { skill: 1, plugin: 0, 'design-system': 0, template: 0 },
      loadable: 0,
    },
    assets: [
      {
        id: 'gh:audit-fixture/skills#skills/slide-deck',
        kind: 'skill',
        name: 'slide-deck',
        displayName: { 'zh-CN': '幻灯片演示技能', en: 'Slide deck skill' },
        summary: { 'zh-CN': '审计用市场夹具（不代表真实采集数据）', en: 'Audit fixture' },
        description: '审计 04 夹具：仅用于市场页 axe 与焦点检查。',
        source: {
          repo: 'audit-fixture/skills',
          repoId: 1,
          path: 'skills/slide-deck',
          ref: 'abcdef1234567890',
          fetchedAt: '2026-10-16T00:00:00.000Z',
          license: { spdx: 'MIT', gate: 'view-only', evidence: { path: 'LICENSE', sha256: '' } },
          stars: 1,
          pushedAt: '2026-10-16T00:00:00.000Z',
          archived: false,
        },
        capabilities: [],
        facets: { category: '其他', lane: 'create', mode: null, tags: [], scenes: [] },
        quality: { score: 70, dims: {} },
        installGate: {
          mode: 'view-only',
          licenseGate: 'view-only',
          security: 'pass',
          reasons: [],
          ackRequired: [],
        },
        digest: 'audit-04-fixture',
      },
    ],
  };
  writeFileSync(
    join(marketDir, 'df.marketplace.index.v1.json'),
    `${JSON.stringify(fixture, null, 2)}\n`,
    'utf8',
  );
}

/** 起生产站点（构建 + next start）。 */
async function startWebSite() {
  const nextBin = join(WEB_DIR, 'node_modules', '.bin', 'next');
  if (!existsSync(nextBin)) throw new Error(`未找到 next 可执行文件：${nextBin}`);
  if (!ensureCanvasKitAssets()) throw new Error('CanvasKit 资产准备失败');

  if (!skipBuild) {
    log('生产构建：next build');
    const build = track(spawn(nextBin, ['build'], { cwd: WEB_DIR, stdio: 'inherit' }));
    const code = await new Promise((done) => build.on('exit', done));
    if (code !== 0) throw new Error(`web 构建失败（exit ${String(code)}）`);
  }

  const port = await freePort();
  const url = `http://127.0.0.1:${String(port)}`;
  log(`生产站点：next start -p ${String(port)}`);
  webServer = track(
    spawn(nextBin, ['start', '-p', String(port)], {
      cwd: WEB_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  webServer.stdout.on('data', (chunk) => {
    if (verbose) process.stdout.write(`[web] ${String(chunk)}`);
  });
  webServer.stderr.on('data', (chunk) => {
    if (verbose) process.stderr.write(`[web] ${String(chunk)}`);
  });
  if (!(await waitForHttp(url, 90_000, '生产站点'))) {
    throw new Error('生产站点不可达');
  }
  return url;
}

// ---------------------------------------------------------------------------
// 浏览器侧工具
// ---------------------------------------------------------------------------

function daemonQuery(gatewayUrl) {
  return `daemon=${encodeURIComponent(`${gatewayUrl}/df`)}`;
}

async function waitCanvasReady(page) {
  await page.waitForSelector('canvas[data-df-canvas]', { timeout: 60_000 });
  await page.waitForFunction(
    () => globalThis.__dforgeCanvas?.runtime().canvasKit === 'ready',
    null,
    { timeout: 90_000 },
  );
  await page.waitForFunction(
    () => (globalThis.__dforgeCanvas?.runtime().frameCount ?? 0) >= 1,
    null,
    { timeout: 60_000 },
  );
}

/** 画布世界坐标 → 页面坐标。 */
async function toPage(page, world) {
  const box = await page.locator('canvas[data-df-canvas]').boundingBox();
  const viewport = await page.evaluate(() => globalThis.__dforgeCanvas.viewport());
  return {
    x: box.x + world.x * viewport.zoom + viewport.panX,
    y: box.y + world.y * viewport.zoom + viewport.panY,
  };
}

function debugEval(page, fn, arg) {
  return page.evaluate(fn, arg);
}

async function geometry(page, id) {
  return debugEval(page, (nodeId) => globalThis.__dforgeCanvas.geometry(nodeId), id);
}

async function nodeIds(page) {
  return debugEval(page, () => globalThis.__dforgeCanvas.nodeIds());
}

async function selection(page) {
  return debugEval(page, () => globalThis.__dforgeCanvas.selection());
}

async function resetViewport(page) {
  await debugEval(page, () => globalThis.__dforgeCanvas.setViewport({ zoom: 1, panX: 0, panY: 0 }));
}

/** 通过首页 UI 新建文档并进入 /editor。 */
async function createDocumentAndOpen(page, homeUrl, documentName) {
  await page.goto(homeUrl, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForSelector('.dfg-home__sidebar');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('menuitem', { name: '设计文件' }).click();
  const nameInput = page.getByRole('textbox', { name: '文件名称' });
  await nameInput.waitFor();
  await nameInput.fill(documentName);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  const card = page.getByRole('link', { name: `打开「${documentName}」` });
  await card.waitFor({ timeout: 15_000 });
  const href = await card.getAttribute('href');
  if (href === null) throw new Error('首页卡片缺少 href');
  const editorUrl = new URL(href, homeUrl).toString();
  await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitCanvasReady(page);
  return { editorUrl, href };
}

/** 读 daemon 侧页面正文（独立证据源）。 */
async function daemonPage(daemonUrl, name, pageId = 'page-1') {
  const response = await fetch(
    `${daemonUrl}/documents/${encodeURIComponent(name)}/pages/${encodeURIComponent(pageId)}`,
  ).catch(() => null);
  if (response === null || !response.ok) return null;
  const payload = await response.json().catch(() => null);
  return payload?.result ?? null;
}

// ---------------------------------------------------------------------------
// 13 类交互（/editor，生产构建）
// ---------------------------------------------------------------------------

async function runInteractions(page, section) {
  const idsAtStart = await nodeIds(page);
  const rectIds = [];
  for (const id of idsAtStart) {
    const node = await geometry(page, id);
    if (node?.type === 'rect') rectIds.push(id);
  }
  const rectId = rectIds[0];
  const secondId = rectIds[1];
  const frameIds = [];
  for (const id of idsAtStart) {
    const node = await geometry(page, id);
    if (node?.type === 'frame') frameIds.push(id);
  }
  if (rectId === undefined || secondId === undefined || frameIds.length === 0) {
    throw new Error(
      `夹具不完整：rects=${String(rectIds.length)} frames=${String(frameIds.length)}`,
    );
  }

  await debugEval(page, () => globalThis.__dforgeCanvas.setSnap(false));
  await resetViewport(page);

  // 1) 选择：点选 / Shift 加选 / 框选
  const rectCenter = await toPage(page, {
    x: (await geometry(page, rectId)).x + 80,
    y: (await geometry(page, rectId)).y + 60,
  });
  await page.mouse.click(rectCenter.x, rectCenter.y);
  const clickSelected = await selection(page);
  const secondCenter = await toPage(page, {
    x: (await geometry(page, secondId)).x + 80,
    y: (await geometry(page, secondId)).y + 60,
  });
  await page.keyboard.down('Shift');
  await page.mouse.click(secondCenter.x, secondCenter.y);
  await page.keyboard.up('Shift');
  const shiftSelected = await selection(page);
  const blank = await toPage(page, { x: 1200, y: 700 });
  await page.mouse.click(blank.x, blank.y);
  const marqueeFrom = await toPage(page, { x: 40, y: 40 });
  const marqueeTo = await toPage(page, { x: 840, y: 660 });
  await page.mouse.move(marqueeFrom.x, marqueeFrom.y);
  await page.mouse.down();
  await page.mouse.move(marqueeTo.x, marqueeTo.y, { steps: 8 });
  const marqueeDrawn = await debugEval(
    page,
    () => globalThis.__dforgeCanvas.stats()?.marquee === true,
  );
  await page.mouse.up();
  await page.waitForTimeout(150);
  const marqueeSelected = await selection(page);
  record(
    section,
    'W1-选择（点选/Shift 加选/框选）',
    clickSelected.length === 1 &&
      shiftSelected.length === 2 &&
      marqueeDrawn &&
      marqueeSelected.length >= 2,
    {
      clickSelected,
      shiftSelected,
      marqueeDrawn,
      marqueeSelected,
    },
  );

  // 2) 移动
  await debugEval(page, (id) => globalThis.__dforgeCanvas.select([id]), rectId);
  const moveBefore = await geometry(page, rectId);
  const moveFrom = await toPage(page, {
    x: moveBefore.x + moveBefore.width / 2,
    y: moveBefore.y + moveBefore.height / 2,
  });
  await page.mouse.move(moveFrom.x, moveFrom.y);
  await page.mouse.down();
  await page.mouse.move(moveFrom.x + 40, moveFrom.y + 30, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const moveAfter = await geometry(page, rectId);
  record(
    section,
    'W2-移动（吸附关闭，精确 40/30）',
    moveAfter.x - moveBefore.x === 40 && moveAfter.y - moveBefore.y === 30,
    {
      dx: moveAfter.x - moveBefore.x,
      dy: moveAfter.y - moveBefore.y,
    },
  );

  // 3) 缩放（se 手柄）
  await debugEval(page, (id) => globalThis.__dforgeCanvas.select([id]), rectId);
  const scaleBefore = await geometry(page, rectId);
  const seHandle = await toPage(page, {
    x: scaleBefore.x + scaleBefore.width,
    y: scaleBefore.y + scaleBefore.height,
  });
  await page.mouse.move(seHandle.x, seHandle.y);
  await page.mouse.down();
  await page.mouse.move(seHandle.x + 60, seHandle.y + 40, { steps: 4 });
  const handlesDuring = await debugEval(
    page,
    () => globalThis.__dforgeCanvas.stats()?.handles ?? 0,
  );
  await page.mouse.up();
  await page.waitForTimeout(150);
  const scaleAfter = await geometry(page, rectId);
  record(
    section,
    'W3-缩放（8 手柄，se 对侧不动）',
    handlesDuring === 8 &&
      scaleAfter.width === scaleBefore.width + 60 &&
      scaleAfter.height === scaleBefore.height + 40 &&
      scaleAfter.x === scaleBefore.x &&
      scaleAfter.y === scaleBefore.y,
    {
      size: [
        `${String(scaleBefore.width)}x${String(scaleBefore.height)}`,
        `${String(scaleAfter.width)}x${String(scaleAfter.height)}`,
      ],
      handlesDuring,
    },
  );

  // 4) 旋转（角外侧 + Shift 15° 吸附）
  const rotateBefore = await geometry(page, rectId);
  const cornerOutside = await toPage(page, { x: rotateBefore.x - 12, y: rotateBefore.y - 12 });
  await page.mouse.move(cornerOutside.x, cornerOutside.y);
  await page.mouse.down();
  await page.mouse.move(cornerOutside.x + 150, cornerOutside.y + 60, { steps: 8 });
  await page.keyboard.down('Shift');
  await page.mouse.move(cornerOutside.x + 160, cornerOutside.y + 70, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(150);
  const rotateAfter = await geometry(page, rectId);
  record(
    section,
    'W4-旋转（角外侧区，Shift 吸附 15°）',
    rotateAfter.rotation !== rotateBefore.rotation && Math.abs(rotateAfter.rotation % 15) < 1e-6,
    { rotation: [rotateBefore.rotation, rotateAfter.rotation] },
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);

  // 5) 画布缩放（⌘+ / ⇧0；⇧0 是壳层注册的 100% 快捷键，Figma 同款）
  const zoomBefore = await debugEval(page, () => globalThis.__dforgeCanvas.viewport());
  await page.keyboard.press('Control+=');
  await page.waitForTimeout(150);
  const zoomAfterKey = await debugEval(page, () => globalThis.__dforgeCanvas.viewport());
  await page.keyboard.press('Shift+0');
  await page.waitForTimeout(150);
  const zoomReset = await debugEval(page, () => globalThis.__dforgeCanvas.viewport());
  record(
    section,
    'W5-画布缩放（⌘+ / ⇧0）',
    zoomAfterKey.zoom > zoomBefore.zoom && Math.abs(zoomReset.zoom - 1) < 1e-6,
    { before: zoomBefore.zoom, afterKey: zoomAfterKey.zoom, reset: zoomReset.zoom },
  );

  // 6) 画布平移（中键 / 空格拖拽）
  await resetViewport(page);
  const panBefore = await debugEval(page, () => globalThis.__dforgeCanvas.viewport());
  const panPoint = await toPage(page, { x: 400, y: 400 });
  await page.mouse.move(panPoint.x, panPoint.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(panPoint.x + 70, panPoint.y + 50, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(150);
  const panAfter = await debugEval(page, () => globalThis.__dforgeCanvas.viewport());
  await page.keyboard.down(' ');
  await page.mouse.move(panPoint.x, panPoint.y);
  await page.mouse.down();
  await page.mouse.move(panPoint.x - 30, panPoint.y - 20, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  await page.waitForTimeout(150);
  const panAfterSpace = await debugEval(page, () => globalThis.__dforgeCanvas.viewport());
  record(
    section,
    'W6-画布平移（中键 / 空格拖拽）',
    panAfter.panX - panBefore.panX === 70 && panAfterSpace.panX - panAfter.panX === -30,
    { panX: [panBefore.panX, panAfter.panX, panAfterSpace.panX] },
  );
  await resetViewport(page);

  // 7) 复制粘贴（⌘C / ⌘V）
  await debugEval(page, (id) => globalThis.__dforgeCanvas.select([id]), rectId);
  const countBeforeClipboard = await debugEval(page, () => globalThis.__dforgeCanvas.nodeCount());
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(300);
  const countAfterPaste = await debugEval(page, () => globalThis.__dforgeCanvas.nodeCount());
  record(section, 'W7-复制粘贴（⌘C / ⌘V）', countAfterPaste === countBeforeClipboard + 1, {
    before: countBeforeClipboard,
    after: countAfterPaste,
  });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);

  // 8) 层级（⌘] / ⇧⌘] / ⇧⌘[）
  const orderBefore = await nodeIds(page);
  await debugEval(page, (id) => globalThis.__dforgeCanvas.select([id]), orderBefore[0]);
  await page.keyboard.press('Control+]');
  await page.waitForTimeout(120);
  const orderForward = await nodeIds(page);
  await page.keyboard.press('Control+Shift+]');
  await page.waitForTimeout(120);
  const orderFront = await nodeIds(page);
  await page.keyboard.press('Control+Shift+[');
  await page.waitForTimeout(120);
  const orderBack = await nodeIds(page);
  record(
    section,
    'W8-层级（⌘] / ⇧⌘] / ⇧⌘[）',
    orderForward[1] === orderBefore[0] &&
      orderFront[orderFront.length - 1] === orderBefore[0] &&
      orderBack[0] === orderBefore[0],
    { before: orderBefore[0], forward: orderForward, front: orderFront, back: orderBack },
  );
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);

  // 9) 编组 / 解组（⌘G / ⇧⌘G）
  const idsForGroup = await nodeIds(page);
  await debugEval(page, ([a, b]) => globalThis.__dforgeCanvas.select([a, b]), [
    idsForGroup[0],
    idsForGroup[1],
  ]);
  const countForGroup = idsForGroup.length;
  await page.keyboard.press('Control+g');
  await page.waitForTimeout(200);
  const groupSelection = await selection(page);
  const groupNode = groupSelection.length === 1 ? await geometry(page, groupSelection[0]) : null;
  await page.keyboard.press('Control+Shift+g');
  await page.waitForTimeout(200);
  const afterUngroup = await nodeIds(page);
  record(
    section,
    'W9-编组/解组（⌘G / ⇧⌘G）',
    groupNode?.type === 'group' && afterUngroup.length === countForGroup,
    {
      groupType: groupNode?.type ?? null,
      groupId: groupSelection[0] ?? null,
      afterUngroupCount: afterUngroup.length,
    },
  );
  // 不撤销：解组后已回到原状；再撤销会把「解组」撤销掉，画板重新被包进编组
  // （演示序列只认顶层画板，会对后续 R7 造成假失败）。

  // 10) 撤销 / 重做（⌘Z / ⇧⌘Z）
  await debugEval(page, (id) => globalThis.__dforgeCanvas.select([id]), rectId);
  const undoBase = await geometry(page, rectId);
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(150);
  const nudged = await geometry(page, rectId);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  const undone = await geometry(page, rectId);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(150);
  const redone = await geometry(page, rectId);
  record(
    section,
    'W10-撤销/重做（⌘Z / ⇧⌘Z，Shift+方向键 10px）',
    nudged.x === undoBase.x + 10 && undone.x === undoBase.x && redone.x === nudged.x,
    { base: undoBase.x, nudged: nudged.x, undone: undone.x, redone: redone.x },
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);

  // 11) 对齐 / 分布（C9 工具条真实按钮）
  const idsForAlign = await ensureTwoRectangles(page, rectId);
  await debugEval(page, (ids) => globalThis.__dforgeCanvas.select(ids), idsForAlign);
  await page.waitForSelector('[data-df-canvas-toolbar]', { timeout: 5000 });
  await page.click('[data-df-canvas-action="alignLeft"]');
  await page.waitForTimeout(200);
  const lefts = [await geometry(page, idsForAlign[0]), await geometry(page, idsForAlign[1])];
  await page.waitForTimeout(100);
  const thirdId = await debugEval(page, () =>
    globalThis.__dforgeCanvas.createRect({ x: 300, y: 640, width: 80, height: 60 }),
  );
  await debugEval(page, ([a, b, c]) => globalThis.__dforgeCanvas.select([a, b, c]), [
    idsForAlign[0],
    idsForAlign[1],
    thirdId,
  ]);
  await page.waitForSelector('[data-df-canvas-toolbar]', { timeout: 5000 });
  await page.click('[data-df-canvas-action="distributeHorizontal"]');
  await page.waitForTimeout(200);
  const distributed = await Promise.all(
    [idsForAlign[0], idsForAlign[1], thirdId].map((id) => geometry(page, id)),
  );
  const sorted = [...distributed].sort((a, b) => a.x - b.x);
  const gap1 = sorted[1].x - (sorted[0].x + sorted[0].width);
  const gap2 = sorted[2].x - (sorted[1].x + sorted[1].width);
  record(
    section,
    'W11-对齐与分布（工具条按钮）',
    lefts[0].x === lefts[1].x && Math.abs(gap1 - gap2) < 1e-6,
    { lefts: lefts.map((item) => item.x), gaps: [gap1, gap2] },
  );
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);

  // 12) 吸附（6px 阈值：参考线出现 + 落点吸到对齐位置）
  const snapIds = await ensureTwoRectangles(page, rectId);
  await debugEval(page, (id) => globalThis.__dforgeCanvas.select([id]), snapIds[0]);
  const snapTarget = await geometry(page, snapIds[1]);
  const snapSelf = await geometry(page, snapIds[0]);
  await debugEval(page, () => globalThis.__dforgeCanvas.setSnap(true));
  const pullFrom = await toPage(page, {
    x: snapSelf.x + snapSelf.width / 2,
    y: snapSelf.y + snapSelf.height / 2,
  });
  const wantX = snapTarget.x + 3;
  const pullTo = await toPage(page, {
    x: wantX + snapSelf.width / 2,
    y: snapSelf.y + snapSelf.height / 2,
  });
  await page.mouse.move(pullFrom.x, pullFrom.y);
  await page.mouse.down();
  await page.mouse.move(pullTo.x, pullTo.y, { steps: 5 });
  await page.waitForTimeout(200);
  const snapStats = await debugEval(page, () => globalThis.__dforgeCanvas.stats());
  const guides = (snapStats?.snapGuides ?? 0) + (snapStats?.measurements ?? 0);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const snapped = await geometry(page, snapIds[0]);
  await debugEval(page, () => globalThis.__dforgeCanvas.setSnap(false));
  record(
    section,
    'W12-吸附（6px 阈值，参考线来自引擎）',
    guides > 0 && Math.abs(snapped.x - snapTarget.x) < 1e-6,
    { guidesAndMeasurements: guides, snappedX: snapped.x, targetX: snapTarget.x },
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);

  // 13) 文本内联编辑（双击进入 / 输入 / 失焦提交 / 撤销）
  const textId = await debugEval(page, () =>
    globalThis.__dforgeCanvas.session().createTextAt({ x: 760, y: 520 }),
  );
  await page.waitForTimeout(200);
  const textPoint = await toPage(page, { x: 820, y: 530 });
  await page.mouse.dblclick(textPoint.x, textPoint.y);
  await page.waitForSelector('[data-df-text-overlay]', { timeout: 5000 }).catch(() => null);
  const overlayVisible = await page.locator('[data-df-text-overlay]').count();
  await page.keyboard.type('设界画布');
  await page.waitForTimeout(150);
  const dismiss = await toPage(page, { x: 1200, y: 720 });
  await page.mouse.click(dismiss.x, dismiss.y);
  await page.waitForTimeout(300);
  const committed = await debugEval(
    page,
    (id) => globalThis.__dforgeCanvas.textContent(id),
    textId,
  );
  await debugEval(page, (id) => globalThis.__dforgeCanvas.select([id]), textId);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  const restored = await debugEval(page, (id) => globalThis.__dforgeCanvas.textContent(id), textId);
  record(
    section,
    'W13-文本内联编辑（双击 / 失焦提交 / 撤销）',
    overlayVisible === 1 && committed === '设界画布' && restored === '',
    { overlayVisible, committed, restored },
  );

  return { rectId, secondId, frameIds, textId };
}

/** 确保页面上至少有两个顶层矩形，返回它们的 id。 */
async function ensureTwoRectangles(page, preferredId) {
  const ids = await nodeIds(page);
  const usable = [];
  for (const id of ids.slice(0, 12)) {
    const node = await geometry(page, id);
    if (node?.type === 'rect') usable.push(id);
  }
  if (usable.length >= 2) return [usable[0], usable[1]];
  if (usable.length === 1) {
    const created = await debugEval(page, () =>
      globalThis.__dforgeCanvas.createRect({ x: 620, y: 300, width: 110, height: 80 }),
    );
    return [usable[0], created];
  }
  const first = await debugEval(page, () =>
    globalThis.__dforgeCanvas.createRect({ x: 200, y: 220, width: 140, height: 90 }),
  );
  const second = await debugEval(page, () =>
    globalThis.__dforgeCanvas.createRect({ x: 620, y: 300, width: 110, height: 80 }),
  );
  void preferredId;
  return [first, second];
}

// ---------------------------------------------------------------------------
// 保存 / 重开
// ---------------------------------------------------------------------------

async function runPersistence(page, section, context) {
  const before = await geometry(page, context.rectId);
  await page.locator('[data-df-save-action="save"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-df-save-state]')?.getAttribute('data-df-save-state') ===
      'saved',
    null,
    { timeout: 30_000 },
  );
  record(section, 'P1-保存态转「已保存」', true, before);

  const stored = await daemonPage(context.daemonUrl, context.documentName);
  const storedNodes = stored?.body?.page?.nodes ?? null;
  record(
    section,
    'P2-daemon 页面正文含画布节点',
    storedNodes !== null && storedNodes[context.rectId] !== undefined,
    storedNodes === null ? '读取失败' : `${Object.keys(storedNodes).length} 个节点`,
  );

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitCanvasReady(page);
  await page.waitForFunction(
    ([id, x, y, width, height]) => {
      const node = globalThis.__dforgeCanvas?.geometry(id);
      return (
        node !== null &&
        node !== undefined &&
        node.x === x &&
        node.y === y &&
        node.width === width &&
        node.height === height
      );
    },
    [context.rectId, before.x, before.y, before.width, before.height],
    { timeout: 45_000 },
  );
  const restored = await geometry(page, context.rectId);
  record(
    section,
    'P3-重载逐字段恢复',
    restored.x === before.x &&
      restored.y === before.y &&
      restored.width === before.width &&
      restored.height === before.height,
    { before, restored },
  );
}

// ---------------------------------------------------------------------------
// 评审：评论 / 版本 / 演示
// ---------------------------------------------------------------------------

async function openCommentMode(page) {
  const toggle = page.getByRole('button', { name: '评论', exact: true }).first();
  const pressed = await toggle.getAttribute('aria-pressed');
  if (pressed !== 'true') {
    await toggle.click();
  }
  await page.waitForSelector('[data-df-comment-surface]', { timeout: 5000 });
}

async function runComments(page, section) {
  await openCommentMode(page);
  const surface = page.locator('[data-df-comment-surface]').first();
  await surface.click({ position: { x: 140, y: 110 }, timeout: 5000 });
  const draft = page.locator('[data-df-comment-draft] textarea').first();
  await draft.waitFor({ timeout: 5000 });
  await draft.fill('审计评论：这里的间距需要复核');
  await page.locator('[data-df-comment-draft] button', { hasText: '发布' }).first().click();
  await page.waitForSelector('[data-df-comment-pin]', { timeout: 5000 });
  const pins = await page.locator('[data-df-comment-pin]').count();
  record(section, 'R1-评论发布产生钉点', pins >= 1, { pins });

  const panel = page.locator('[data-df-panel="comments"]');
  const thread = panel.locator('[data-df-comment-thread]').first();
  await thread.waitFor({ timeout: 5000 });
  // 发布后线程通常已处于展开态；仅在未展开时点一次（再点会收起，解决按钮随之消失）
  if ((await panel.locator('[data-df-comment-thread-detail]').count()) === 0) {
    await thread.locator('button').first().click();
  }
  await panel.getByRole('button', { name: '解决', exact: true }).first().click();
  await page.waitForTimeout(200);
  const resolvedSection = await panel.locator('[data-df-sample="comments/resolved"]').count();
  const resolvedToggle = panel.locator('[data-df-comment-resolved-toggle]').first();
  if ((await resolvedToggle.count()) > 0) {
    await resolvedToggle.click();
    await page.waitForTimeout(150);
  }
  const resolved = await panel
    .locator('[data-df-comment-thread][data-df-state="resolved"]')
    .count();
  record(section, 'R2-评论解决进入折叠段', resolved >= 1 && resolvedSection >= 1, {
    resolved,
    resolvedSection,
  });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitCanvasReady(page);
  await openCommentMode(page);
  const pinsAfterReload = await page.locator('[data-df-comment-pin]').count();
  record(section, 'R3-评论刷新后仍在（localStorage）', pinsAfterReload === pins, {
    before: pins,
    after: pinsAfterReload,
  });
  await page.getByRole('button', { name: '退出评论模式', exact: true }).first().click();
  await page.waitForTimeout(150);
}

async function runVersions(page, section) {
  // 重载后文档经 daemon 异步载入；先等正文节点齐（否则「保存当前版本」会快照到空文档）
  await page.waitForFunction(() => (globalThis.__dforgeCanvas?.nodeCount() ?? 0) >= 5, null, {
    timeout: 30_000,
  });
  const nodesBeforeCapture = await debugEval(page, () => globalThis.__dforgeCanvas.nodeCount());
  const toggle = page.getByRole('button', { name: '版本历史', exact: true }).first();
  await toggle.click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  // 版本抽屉经 Drawer portal 到 body：`[data-df-versions-root]` 是空包裹层。
  // verify-figma-review 的 versions/drawer 取样根正是它——冻结参照后只会截到留白。
  const rootBox = await page.locator('[data-df-versions-root]').first().boundingBox();
  const dialogBox = await page.locator('[role="dialog"]').first().boundingBox();
  record(section, 'R4b-版本抽屉 DOM（Drawer portal 到 body）', dialogBox !== null, {
    versionsRootBox: rootBox,
    dialogBox,
    note: '取样根 [data-df-versions-root] 内没有抽屉内容；画廊/门禁应改取 [role="dialog"] 或 portal 容器。',
  });
  await page.locator('[data-df-version-capture]').first().click();
  const row = page.locator('[data-df-version-row]').first();
  await row.waitFor({ timeout: 5000 });
  const rows = await page.locator('[data-df-version-row]').count();
  record(section, 'R4-版本快照进入列表', rows >= 1, { rows, nodesBeforeCapture });

  await page.locator('[data-df-version-row] button', { hasText: '对比' }).first().click();
  await page.waitForSelector('[data-df-version-compare]', { timeout: 5000 });
  await page.locator('[data-df-version-confirm]').first().click();
  await page.waitForTimeout(400);
  const compareGone = (await page.locator('[data-df-version-compare]').count()) === 0;
  const nodesAfterRestore = await debugEval(page, () => globalThis.__dforgeCanvas.nodeCount());
  const toast = await page
    .getByText('已恢复该版本')
    .count()
    .catch(() => 0);
  record(section, 'R5-版本对比两步确认（确认后关闭）', compareGone, {
    compareGone,
    toast,
    nodesAfterRestore,
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitCanvasReady(page);
  await page.getByRole('button', { name: '版本历史', exact: true }).first().click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  const rowsAfterReload = await page.locator('[data-df-version-row]').count();
  record(section, 'R6-版本刷新后仍在（localStorage）', rowsAfterReload >= rows, {
    before: rows,
    after: rowsAfterReload,
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

async function runPresent(page, section) {
  const entry = page.getByRole('button', { name: '演示', exact: true }).first();
  if (await entry.isDisabled()) {
    const nodeCount = await debugEval(page, () => globalThis.__dforgeCanvas.nodeCount());
    record(section, 'R7-演示入口可用（有画板才点亮）', false, { disabled: true, nodeCount });
    return;
  }
  await entry.click({ timeout: 5000 });
  await page.waitForSelector('[data-df-presenter]', { timeout: 5000 });
  const indexOf = async () =>
    Number(await page.locator('[data-df-presenter]').getAttribute('data-df-slide-index'));
  const first = await indexOf();
  await page.keyboard.press('ArrowLeft');
  const atStart = await indexOf();
  await page.keyboard.press('ArrowRight');
  const second = await indexOf();
  await page.keyboard.press('ArrowRight');
  const atEnd = await indexOf();
  await page.keyboard.press('ArrowRight');
  const beyondEnd = await indexOf();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const closed = (await page.locator('[data-df-presenter]').count()) === 0;
  record(
    section,
    'R7-演示键盘翻页与边界、Esc 退出',
    first === 0 && atStart === 0 && second === 1 && atEnd === 1 && beyondEnd === 1 && closed,
    { first, atStart, second, atEnd, beyondEnd, closed },
  );
}

// ---------------------------------------------------------------------------
// 评审数据隔离（localStorage 口径的证据）
// ---------------------------------------------------------------------------

/**
 * 新浏览器上下文（等价换浏览器/换用户配置）能否看到主上下文的评论与版本。
 * 当前实现把评论/版本存 `localStorage`（`dfg:comments:<docId>` / `dfg:versions:<docId>`），
 * 预期看不到——这是口径证据，不是脚本失败；结论按 partial/缺口登记。
 */
async function runReviewIsolation(section, editorUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await waitCanvasReady(page);
    await page.waitForFunction(() => (globalThis.__dforgeCanvas?.nodeCount() ?? 0) >= 5, null, {
      timeout: 30_000,
    });
    await page.getByRole('button', { name: '评论', exact: true }).first().click();
    await page.waitForSelector('[data-df-comment-surface]', { timeout: 5000 });
    const pins = await page.locator('[data-df-comment-pin]').count();
    await page.getByRole('button', { name: '退出评论模式', exact: true }).first().click();
    await page.getByRole('button', { name: '版本历史', exact: true }).first().click();
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    const rows = await page.locator('[data-df-version-row]').count();
    await page.keyboard.press('Escape');
    const storageKeys = await page.evaluate(() => Object.keys(localStorage));
    record(
      section,
      'R8-新浏览器上下文看不到评论/版本（localStorage 口径）',
      pins === 0 && rows === 0,
      {
        pins,
        rows,
        storageKeys,
        note: '评论/版本只存浏览器 localStorage，不在 daemon/.dfg 中；换浏览器或清存储即丢。',
      },
    );
  } finally {
    await context.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// 文本 / 自动布局
// ---------------------------------------------------------------------------

async function runTextAndLayout(page, section, context) {
  const text = await debugEval(
    page,
    (id) => globalThis.__dforgeCanvas.textContent(id),
    context.textId,
  );
  record(section, 'T1-文本节点存在且撤销后回到空内容', text === '', {
    text,
    note: 'W13 已在提交后撤销，当前文本应为空（提交内容见 W13 的 committed）',
  });

  // 自动布局入口：选中画板后 Inspector「布局」段出现方向选择（horizontal/vertical）
  await debugEval(page, (id) => globalThis.__dforgeCanvas.select([id]), context.frameIds[0]);
  await page.waitForSelector('[data-df-inspector-field="autoLayoutEnabled"]', {
    timeout: 5000,
  });
  const layoutSection = page.locator('#layout, [data-df-inspector-section="layout"]').first();
  const enabledSwitch = page.getByRole('switch', { name: '自动布局', exact: true }).first();
  await enabledSwitch.click();
  await page.waitForSelector('[data-df-inspector-field="autoLayoutDirection"]', {
    timeout: 5000,
  });
  const horizontal = await page.getByText('横向', { exact: true }).count();
  const vertical = await page.getByText('纵向', { exact: true }).count();
  record(
    section,
    'T2-自动布局 Inspector 入口（开关 → 方向）',
    (await layoutSection.count().catch(() => 0)) > 0 &&
      (await page.locator('[data-df-inspector-field="autoLayoutDirection"]').count()) === 1 &&
      horizontal >= 1 &&
      vertical >= 1,
    {
      layoutSection: await layoutSection.count().catch(() => 0),
      horizontal,
      vertical,
    },
  );
  // 复原：关掉自动布局，避免改变后续证据里的文档形态
  await enabledSwitch.click().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// 500 节点基线（measure-only）
// ---------------------------------------------------------------------------

async function runPerf500(page) {
  const seeded = await page.evaluate(() => {
    const handle = globalThis.__dforgeCanvas;
    const session = handle.session();
    const started = performance.now();
    for (let index = 0; index < 500; index += 1) {
      session.createRect({
        x: (index % 25) * 40,
        y: Math.floor(index / 25) * 40,
        width: 30,
        height: 30,
      });
    }
    const seedMs = performance.now() - started;
    handle.setViewport({ zoom: 0.6, panX: 20, panY: 20 });
    handle.select([]);
    return { seedMs, nodeCount: handle.nodeCount() };
  });
  await page.waitForTimeout(800);

  // 真实指针框选：覆盖整个网格
  const from = await toPage(page, { x: -10, y: -10 });
  const to = await toPage(page, { x: 1010, y: 810 });
  const marqueeStart = Date.now();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const marqueeMs = Date.now() - marqueeStart;
  const selected = (await selection(page)).length;

  // 真实键盘微移 + 撤销（选中全部 500+ 后单条命令 O(n)）
  const nudgeStart = Date.now();
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(300);
  const nudgeMs = Date.now() - nudgeStart;
  const undoStart = Date.now();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const undoMs = Date.now() - undoStart;

  // 引擎/会话级操作计时（排除 Playwright 往返）
  const inPage = await page.evaluate(async () => {
    const handle = globalThis.__dforgeCanvas;
    const session = handle.session();
    const sample = (fn, iterations = 5) => {
      const values = [];
      for (let index = 0; index < iterations; index += 1) {
        const started = performance.now();
        fn();
        values.push(performance.now() - started);
      }
      values.sort((a, b) => a - b);
      return { median: values[Math.floor(values.length / 2)], max: values[values.length - 1] };
    };
    const selectAll = (() => {
      const values = [];
      for (let index = 0; index < 5; index += 1) {
        const started = performance.now();
        session.selectAll();
        values.push(performance.now() - started);
      }
      values.sort((a, b) => a - b);
      return { median: values[2], max: values[4] };
    })();
    const nudge = sample(() => {
      session.nudge(1, 0);
      session.undo();
    });
    const zoom = sample(() => {
      session.zoomIn({ x: 500, y: 400 });
      session.zoomOut({ x: 500, y: 400 });
    });

    // 帧间隔：连续 30 次微移（每次间隔 ~16ms），统计 rAF 间隔
    const frames = [];
    let running = true;
    const tick = (time) => {
      frames.push(time);
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    for (let index = 0; index < 30; index += 1) {
      session.nudge(1, 0);
      await new Promise((done) => setTimeout(done, 16));
    }
    running = false;
    const deltas = [];
    for (let index = 1; index < frames.length; index += 1) {
      deltas.push(frames[index] - frames[index - 1]);
    }
    deltas.sort((a, b) => a - b);
    const pct = (ratio) =>
      deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * ratio))] ?? null;
    session.selectAll();
    session.undo();
    return {
      selectAll,
      nudgeAndUndo: nudge,
      zoomInOut: zoom,
      frameCount: deltas.length + 1,
      frameIntervalMs: {
        median: pct(0.5),
        p95: pct(0.95),
        max: deltas[deltas.length - 1] ?? null,
      },
    };
  });

  const stats = await debugEval(page, () => globalThis.__dforgeCanvas.stats());
  const runtime = await debugEval(page, () => globalThis.__dforgeCanvas.runtime());
  return {
    kind: 'measure-only（不设硬预算）',
    nodeCount: seeded.nodeCount,
    added: 500,
    seedMs: seeded.seedMs,
    pointerMarquee: { selected, wallMs: marqueeMs },
    keyboardNudge: { wallMs: nudgeMs },
    keyboardUndo: { wallMs: undoMs },
    sessionOps: inPage,
    render: { stats, runtime },
    note:
      'wallMs 含 Playwright 指针/键盘往返开销；sessionOps 为页面内 performance.now 采样（5 次中位/max）。' +
      '帧间隔来自连续 30 次微移期间的 requestAnimationFrame 时间戳（16ms 步进）。',
  };
}

// ---------------------------------------------------------------------------
// axe / 焦点 / 可访问名
// ---------------------------------------------------------------------------

function axeSource() {
  const path = join(REPO_ROOT, 'node_modules', 'axe-core', 'axe.min.js');
  if (!existsSync(path)) throw new Error(`未找到 axe-core：${path}（先 pnpm install）`);
  return readFileSync(path, 'utf8');
}

/** 焦点元素的可访问信息（近似名 + 标签来源；精确名由 CDP AX 树另采）。 */
async function focusedInfo(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (element === null || element === document.body) {
      return { tag: element?.tagName ?? null, role: null, name: '(body)', nameSource: 'none' };
    }
    const ariaLabel = element.getAttribute('aria-label');
    const labelledBy = element.getAttribute('aria-labelledby');
    let labelledText = null;
    if (labelledBy !== null) {
      labelledText = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .filter((text) => text.length > 0)
        .join(' ');
    }
    const labels = 'labels' in element ? [...(element.labels ?? [])] : [];
    const labelText = labels.map((label) => label.textContent?.trim() ?? '').join(' ');
    const text = (element.textContent ?? '').trim().slice(0, 80);
    const name =
      ariaLabel ??
      labelledText ??
      (labelText.length > 0 ? labelText : null) ??
      (text.length > 0 ? text : null) ??
      element.getAttribute('placeholder') ??
      element.getAttribute('title') ??
      element.getAttribute('alt') ??
      '';
    const source =
      ariaLabel !== null
        ? 'aria-label'
        : labelledText !== null
          ? 'aria-labelledby'
          : labelText.length > 0
            ? 'label'
            : text.length > 0
              ? 'text'
              : 'other';
    return {
      tag: element.tagName,
      role: element.getAttribute('role'),
      name,
      nameSource: source,
      id: element.id || null,
      type: element.getAttribute('type'),
    };
  });
}

/** 精确可访问名：CDP Accessibility 全树里「可交互角色 + 空名」。 */
async function accessibilityGaps(context, page) {
  const client = await context.newCDPSession(page);
  await client.send('Accessibility.enable');
  const tree = await client.send('Accessibility.getFullAXTree');
  await client.detach().catch(() => undefined);
  const interactiveRoles = new Set([
    'button',
    'link',
    'textbox',
    'searchbox',
    'combobox',
    'listbox',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'checkbox',
    'radio',
    'switch',
    'slider',
    'spinbutton',
    'tab',
    'option',
    'treeitem',
  ]);
  const gaps = [];
  for (const node of tree.nodes ?? []) {
    if (node.ignored === true) continue;
    const role = node.role?.value;
    if (typeof role !== 'string' || !interactiveRoles.has(role)) continue;
    const name = node.name?.value;
    if (typeof name === 'string' && name.trim().length > 0) continue;
    gaps.push({
      role,
      backendDOMNodeId: node.backendDOMNodeId ?? null,
      description: node.description?.value ?? null,
    });
  }
  return gaps;
}

async function auditPageWithAxe(context, name, url, options = {}) {
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const failedResponses = [];
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${String(response.status())} ${response.url()}`);
    }
  });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) {
      consoleErrors.push(message.text().slice(0, 300));
    }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  if (options.waitFor !== undefined) {
    await page.waitForSelector(options.waitFor, { timeout: 30_000 }).catch(() => null);
  }
  if (options.waitCanvas === true) {
    await waitCanvasReady(page).catch(() => null);
  }
  await page.waitForTimeout(1200);

  await page.addScriptTag({ content: axeSource() });
  const result = await page.evaluate(async (tags) => {
    return await globalThis.axe.run(document, {
      runOnly: { type: 'tag', values: tags },
      resultTypes: ['violations', 'incomplete'],
    });
  }, WCAG_TAGS);

  const impactCounts = { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
  for (const violation of result.violations) {
    const impact = violation.impact ?? 'unknown';
    impactCounts[impact] = (impactCounts[impact] ?? 0) + 1;
  }
  const summary = {
    page: name,
    url,
    tags: WCAG_TAGS,
    counts: {
      critical: impactCounts.critical,
      serious: impactCounts.serious,
      moderate: impactCounts.moderate,
      minor: impactCounts.minor,
      unknown: impactCounts.unknown,
      violations: result.violations.length,
      incomplete: result.incomplete.length,
    },
    violations: result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary,
      })),
    })),
    incomplete: result.incomplete.map((item) => ({
      id: item.id,
      impact: item.impact,
      help: item.help,
      nodes: item.nodes.length,
    })),
    pageErrors,
    consoleErrors,
    failedResponses,
  };
  writeEvidence(join('axe', `${name}.json`), result);
  writeEvidence(join('axe', `${name}-summary.json`), summary);

  // 焦点顺序：Tab 25 次（记录每一步的 tag/role/name/nameSource）
  const focusOrder = [];
  await page.evaluate(() => document.body.focus());
  for (let index = 0; index < 25; index += 1) {
    await page.keyboard.press('Tab');
    focusOrder.push(await focusedInfo(page));
  }
  writeEvidence(join('axe', `${name}-focus.json`), { page: name, url, focusOrder });

  const gaps = await accessibilityGaps(context, page).catch((error) => [{ error: String(error) }]);
  writeEvidence(join('axe', `${name}-ax-gaps.json`), { page: name, url, gaps });

  await page
    .screenshot({ path: join(SHOT_DIR, `axe-${name}.png`), fullPage: true })
    .catch(() => null);
  await page.close();
  return { summary, focusOrder, gaps };
}

// ---------------------------------------------------------------------------
// 既有评审门禁（预期 exit 2：参照集未冻结）
// ---------------------------------------------------------------------------

async function runFigmaReviewGate(editorUrl) {
  const script = join(REPO_ROOT, 'scripts', 'verify-figma-review.mjs');
  const started = Date.now();
  const child = track(
    spawn(process.execPath, [script], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DF_WEB_URL: gateway.url,
        DF_REVIEW_URL: editorUrl,
        DF_EVIDENCE_DIR: join(EVIDENCE_ROOT, 'gate-evidence'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
    if (verbose) process.stdout.write(`[figma-review] ${String(chunk)}`);
  });
  child.stderr.on('data', (chunk) => {
    output += String(chunk);
    if (verbose) process.stderr.write(`[figma-review] ${String(chunk)}`);
  });
  const code = await new Promise((done) => child.on('exit', done));
  return { exitCode: code, durationMs: Date.now() - started, tail: output.slice(-4000) };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

try {
  mkdirSync(WORKSPACE_DIR, { recursive: true });
  mkdirSync(AXE_DIR, { recursive: true });
  mkdirSync(SHOT_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });

  log('起临时 daemon（临时数据根，不碰 ~/.dforge / 4318）');
  daemon = await startFixtureDaemon({ dataRoot: DATA_ROOT, workspaceDir: WORKSPACE_DIR });
  seedMarketIndex(DATA_ROOT);
  evidence.urls.daemon = daemon.url;

  const webUrl = await startWebSite();
  evidence.urls.web = webUrl;

  gateway = await startSameOriginGateway({ webUrl, daemonUrl: daemon.url });
  evidence.urls.gateway = gateway.url;

  const chrome = resolveChromeExecutable();
  if (chrome === undefined) throw new Error('未找到 Chromium（playwright-core 缓存缺失）');
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });

  const homeUrl = `${gateway.url}/?${daemonQuery(gateway.url)}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  log('首页 UI 新建文档 → 进入 /editor');
  const { editorUrl } = await createDocumentAndOpen(page, homeUrl, DOCUMENT_NAME);
  evidence.urls.editor = editorUrl;

  // 夹具：两个画板 + 两个矩形（画板用于演示；矩形用于 13 类交互）
  const seeded = await page.evaluate(() => {
    const handle = globalThis.__dforgeCanvas;
    const session = handle.session();
    handle.setSnap(false);
    const frameA = session.createFrameAt({ x: 60, y: 60, width: 480, height: 320 });
    const frameB = session.createFrameAt({ x: 60, y: 420, width: 480, height: 260 });
    const rectA = session.createRect({ x: 620, y: 100, width: 160, height: 120 });
    const rectB = session.createRect({ x: 620, y: 280, width: 160, height: 120 });
    session.setSelection([rectA]);
    return { frameA, frameB, rectA, rectB };
  });
  evidence.notes.push(
    `画布夹具：frames=${seeded.frameA},${seeded.frameB} rects=${seeded.rectA},${seeded.rectB}`,
  );
  await page.waitForTimeout(300);

  log('13 类交互（生产构建 /editor）');
  const interactionContext = await runInteractions(page, evidence.interactions);
  interactionContext.daemonUrl = daemon.url;
  interactionContext.documentName = DOCUMENT_NAME;
  evidence.interactions.push({
    id: 'W0-交互前置',
    ok: true,
    detail: { documentName: DOCUMENT_NAME, pageErrorsBeforeAudit: [...pageErrors] },
  });

  log('保存 / 重开');
  await runPersistence(page, evidence.persistence, interactionContext);

  log('评审：评论 / 版本 / 演示');
  await runComments(page, evidence.review.comments);
  await runVersions(page, evidence.review.versions);
  await runPresent(page, evidence.review.present);
  await runReviewIsolation(evidence.review.isolation, editorUrl);

  log('文本 / 自动布局');
  await runTextAndLayout(page, evidence.textAndLayout, {
    ...interactionContext,
    frameIds: [seeded.frameA, seeded.frameB],
  });

  await page
    .screenshot({ path: join(SHOT_DIR, 'editor-after-interactions.png'), fullPage: true })
    .catch(() => null);
  await context.close();

  if (!skipFigmaReview) {
    log('既有评审门禁 verify-figma-review（预期 exit 2：REF-01 未冻结）');
    evidence.figmaReview = await runFigmaReviewGate(editorUrl);
    log(`verify-figma-review exit=${String(evidence.figmaReview.exitCode)}`);
  }

  // axe：首页 / 编辑器 / 市场 / 设置（各自独立 context，避免残留焦点/状态）
  const axeTargets = [
    { name: 'home', url: homeUrl, waitFor: '.dfg-home__sidebar' },
    { name: 'editor', url: editorUrl, waitCanvas: true },
    {
      name: 'market',
      url: `${gateway.url}/market?${daemonQuery(gateway.url)}`,
      waitFor: '[data-df-market="card"]',
    },
    {
      name: 'settings',
      url: `${gateway.url}/settings?${daemonQuery(gateway.url)}`,
      waitFor: 'body',
    },
  ];
  for (const target of axeTargets) {
    log(`axe + 焦点：${target.name}`);
    const axeContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const result = await auditPageWithAxe(axeContext, target.name, target.url, target);
      evidence.axe.push({
        page: target.name,
        url: target.url,
        counts: result.summary.counts,
        topRules: result.summary.violations.slice(0, 8).map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.length,
        })),
        focusGaps: result.gaps.length,
        focusOrder: result.focusOrder,
        failedResponses: result.summary.failedResponses,
      });
    } finally {
      await axeContext.close().catch(() => undefined);
    }
  }

  // 500 节点基线（独立 context + 新文档流程，避免评审浮层残留）
  log('500 节点交互基线');
  const perfContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const perfPage = await perfContext.newPage();
    await createDocumentAndOpen(perfPage, homeUrl, PERF_DOCUMENT_NAME);
    evidence.perf = await runPerf500(perfPage);
    await perfPage
      .screenshot({ path: join(SHOT_DIR, 'perf-500.png'), fullPage: true })
      .catch(() => null);
  } finally {
    await perfContext.close().catch(() => undefined);
  }

  evidence.pageErrors = pageErrors;
  const failed = [
    ...evidence.interactions,
    ...evidence.persistence,
    ...evidence.review.comments,
    ...evidence.review.versions,
    ...evidence.review.present,
    ...evidence.review.isolation,
    ...evidence.textAndLayout,
  ].filter((item) => item.ok !== true);
  evidence.summary = {
    interactions: evidence.interactions.length,
    interactionsFailed: failed.filter((item) => item.id.startsWith('W')).length,
    persistenceFailed: failed.filter((item) => item.id.startsWith('P')).length,
    reviewFailed: failed.filter((item) => item.id.startsWith('R')).length,
    textLayoutFailed: failed.filter((item) => item.id.startsWith('T')).length,
    axeCritical: evidence.axe.reduce((sum, page) => sum + page.counts.critical, 0),
    axeSerious: evidence.axe.reduce((sum, page) => sum + page.counts.serious, 0),
    figmaReviewExit: evidence.figmaReview?.exitCode ?? null,
    note: '审计脚本以「完成即 0」收口；findings 见 editor-review-*.json 与 04-editor-review.md。',
  };
  await finish(0);
} catch (error) {
  console.error(`审计脚本异常：${String(error)}`);
  await finish(1, String(error));
}
