#!/usr/bin/env node
/**
 * verify-text-inline-edit —— 票 13（spec P2 画布项）浏览器门禁挂点：
 * 双击文本进入内联编辑，覆盖层世界坐标对齐；失焦提交同步文档与图层面板；Esc 取消不落盘；超长输入钳制。
 *
 * 为什么必须是浏览器门禁：巡检（ux-audit C10）的「双击文本点位没进编辑（点到画板）」与
 * 「失焦提交未落盘」都是**真实链路故障**——真实双击事件序列（两击 + dblclick）、指针命中、
 * DOM 覆盖层挂载与聚焦、失焦时序、React 受控回灌，每一环都只有真浏览器才能证实；
 * jsdom 组件测试只能守住会话与组件的中间表示（text-edit-entry.test.tsx 已覆盖）。
 *
 * 断言（全部走真实 Chromium + 生产构建 + 夹具 daemon，**禁用 next dev**）：
 *   ① T 工具路径可用（巡检已知良好路径，作为基线）：点工具 → 点画布 → 覆盖层出现，
 *      输入后失焦提交，`__dforgeCanvas.textContent(id)` 落盘；
 *   ② 双击路径进入编辑：`[data-df-text-overlay="<id>"]` 出现，且 left/top 与
 *      几何 × zoom + pan 的世界坐标换算一致（±1px）；
 *   ③ 编辑回灌：输入即 `editingText().characters` 跟随（输入即所见）；
 *   ④ 失焦提交落盘 + 图层面板同步：覆盖层关闭、`textContent(id)` 更新、
 *      图层面板存在该节点行（`data-node-id`，与文档同一命令栈真值）；
 *   ⑤ Esc 取消不落盘：再次双击进入、改动内容、按 Esc → 文档内容保持不变；
 *   ⑥ Enter 路径行为一致：选中文本节点按 Enter → 同一覆盖层挂点出现
 *      （两路径行为一致的自动化部分；手感级一致性由主会话浏览器复核）；
 *   ⑦ 超长输入钳制：覆盖层内整段替换 5000+50 字 → 编辑会话内容钳到
 *      TEXT_CHARACTERS_MAX_LENGTH（5000）。
 *
 * **挂点（随票接入）**：本门禁未接 CI；断言脚本与证据落盘已就绪，浏览器级复核由
 * 主会话在集成分支统一执行（`humanReview.verdict` 恒为 pending，直到复核登记）。
 *
 * 退出码（三态，禁止假绿）：0 全过 / 1 断言违规 / 2 阻塞（构建失败 / daemon 起不来 /
 * 站点不可达 / Chromium 缺失 / 用例异常）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-text-inline-edit.mjs
 *   DF_WEB_URL=http://127.0.0.1:<port> node scripts/verify-text-inline-edit.mjs   # 复用已起站点
 *
 * 环境变量：DF_WEB_URL / DF_EVIDENCE_DIR / BENCH_CHROME_EXECUTABLE。
 * 端口纪律：空闲端口（4460 起），不碰 3000/4318；daemon 用临时数据根（不碰 ~/.dforge）。
 * 本机事实（brief）：node 22.16 直跑 daemon main.ts 会 ERR_UNKNOWN_FILE_EXTENSION——
 * 显式带 `--experimental-strip-types`（与 verify-layers-reorder-persist.mjs 同口径）。
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveChromeExecutable } from './lib/browser-toolchain.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_APP_DIR = join(REPO_ROOT, 'apps', 'web');
const EVIDENCE_DIR = resolve(
  process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence', '13-text-edit'),
);

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
let webUrl = args.includes('--web-url')
  ? args[args.indexOf('--web-url') + 1]
  : (process.env.DF_WEB_URL ?? null);

const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const evidencePath = join(EVIDENCE_DIR, `verify-text-inline-edit-${stamp}.json`);

/** 证据对象（验收标准 §4 字段族；humanReview 恒待主会话登记）。 */
const evidence = {
  ticket: '13-text-inline-edit',
  gate: 'verify-text-inline-edit',
  level: 'A（真实双击事件序列 + DOM 覆盖层几何 + 命令栈提交——jsdom 不可达的全链事实）',
  viewport: { width: 1440, height: 900 },
  startedAt: startedAt.toISOString(),
  webUrl: null,
  daemonUrl: null,
  assertions: [],
  notes: [],
  humanReview: {
    verdict: 'pending',
    reviewer: null,
    reason:
      '挂点（随票接入）：断言脚本已就绪；浏览器级复核（双击手感、覆盖层对齐观感、Enter 与双击路径行为一致性）由主会话在集成分支统一执行。',
  },
  exitCode: 2,
};

function record(id, ok, detail) {
  evidence.assertions.push({ id, ok, detail });
  const mark = ok === true ? 'ok' : 'FAIL';
  console.log(
    `  [${mark}] ${id} —— ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`,
  );
}

function note(message) {
  evidence.notes.push(message);
  console.log(`  [note] ${message}`);
}

/** 子进程登记：任何退出路径都整组回收（独立进程组），不留 next 残留。 */
const children = new Set();
const groupLeaderPids = new Set();
function track(child, detached = false) {
  children.add(child);
  if (detached && child.pid !== undefined) groupLeaderPids.add(child.pid);
  child.on('exit', () => children.delete(child));
  return child;
}
function signalChildren(signal) {
  for (const child of children) {
    try {
      if (child.pid !== undefined && groupLeaderPids.has(child.pid)) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      // 已退出
    }
  }
}
process.on('exit', () => signalChildren('SIGTERM'));
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  process.on(signal, () => {
    signalChildren(signal);
    setTimeout(() => {
      signalChildren('SIGKILL');
      process.exit(code);
    }, 300);
  });
}

let daemon = null;
let dataRoot = null;

async function finish(code, message) {
  evidence.finishedAt = new Date().toISOString();
  evidence.exitCode = code;
  evidence.webUrl = webUrl;
  evidence.daemonUrl = daemon?.url ?? null;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`证据：${evidencePath}`);
  if (message) console.error(message);
  // 两段回收：SIGTERM 优雅收尾，SIGKILL 兜底（next start 的宽限窗口实测可越过直接退出）
  signalChildren('SIGTERM');
  await sleep(800);
  signalChildren('SIGKILL');
  if (daemon !== null) await daemon.close().catch(() => undefined);
  // 第三段（Next 16 实测，同 verify-layers-reorder-persist）：`next start` 会把 next-server
  // fork 进另一个进程组，组杀够不到——按端口找监听者的精确 PID 再 SIGKILL。
  if (webUrl !== null) {
    const port = Number(new URL(webUrl).port);
    if (Number.isFinite(port) && (await portBusy(port))) {
      const killed = killPortListener(port);
      console.log(
        killed
          ? `回收残留监听进程（端口 ${port}）`
          : `警告：端口 ${port} 仍有监听者，未能按 PID 回收`,
      );
    }
  }
  process.exit(code);
}

/** 按「监听端口 → socket inode → 持有 fd 的进程」找监听者并 SIGKILL（精确 PID）。 */
function killPortListener(port) {
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    if (!existsSync(table)) continue;
    for (const line of readFileSync(table, 'utf8').split('\n').slice(1)) {
      const columns = line.trim().split(/\s+/);
      const local = columns[1] ?? '';
      if (!local.endsWith(`:${hex}`) || columns[3] !== '0A') continue; // 0A = LISTEN
      const inode = columns[9];
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          for (const fd of readdirSync(`/proc/${entry}/fd`)) {
            if (readlinkSync(`/proc/${entry}/fd/${fd}`) === `socket:[${inode}]`) {
              process.kill(Number(entry), 'SIGKILL');
              return true;
            }
          }
        } catch {
          // 进程已退出 / fd 已关闭：继续
        }
      }
    }
  }
  return false;
}

const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms));

/** 端口是否可连。 */
function portBusy(port) {
  return new Promise((settle) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `const s=require('net').connect({port:${port}});s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),800)`,
      ],
      { stdio: 'ignore' },
    );
    child.on('exit', (code) => settle(code === 0));
  });
}

/** 找空闲端口（4460 起，远离 3000/4318）。 */
async function freePort() {
  for (let port = 4460; port < 4540; port += 1) {
    if (!(await portBusy(port))) return port;
  }
  throw new Error('找不到空闲端口');
}

/** HTTP 探测（轮询到站点就绪）。 */
async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (response.status < 500) return true;
    } catch {
      // 未就绪，继续等
    }
    if (Date.now() > deadline) return false;
    await sleep(200);
  }
}

/** 等待页面谓词成立（取返回值；超时抛错）。 */
async function waitFor(page, predicateBody, { timeout = 20000, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await page
      .evaluate(new Function(`return (${predicateBody})()`))
      .catch(() => null);
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`等待超时（${timeout}ms）：${label}`);
    await sleep(120);
  }
}

/** 起夹具 daemon（自带 --experimental-strip-types；临时数据根）。 */
async function startFixtureDaemonStripTypes() {
  const port = await freePort();
  dataRoot = join(EVIDENCE_DIR, 'runs', stamp);
  const workspaceDir = join(dataRoot, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  const child = track(
    spawn(
      process.execPath,
      ['--experimental-strip-types', join(REPO_ROOT, 'apps', 'daemon', 'src', 'main.ts')],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          DF_DATA_ROOT: dataRoot,
          DF_WORKSPACE_DIR: workspaceDir,
          DF_PORT: String(port),
          DF_HOST: '127.0.0.1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ),
    true,
  );
  let output = '';
  child.stdout?.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });
  const url = await new Promise((resolveUrl) => {
    const timer = setTimeout(() => resolveUrl(null), 25_000);
    const poll = setInterval(() => {
      const match = /listening on (http:\/\/\S+)/.exec(output);
      if (match !== null) {
        clearInterval(poll);
        clearTimeout(timer);
        resolveUrl(match[1]);
      }
    }, 100);
  });
  if (url === null) {
    throw new Error(`夹具 daemon 起不来（末 600 字符输出）：${output.slice(-600)}`);
  }
  return {
    url,
    close: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await sleep(300);
      try {
        child.kill('SIGKILL');
      } catch {
        // 已退出
      }
    },
  };
}

/** 覆盖层挂点选择器（文本节点 id → 覆盖层 textarea）。 */
const overlaySelector = (id) => `[data-df-text-overlay="${id}"]`;

/** 读节点屏幕几何：世界矩形 × zoom + pan（与 nodeOverlayBox 共享口径一致）。 */
const SCREEN_BOX_EXPR = `(id) => {
  const handle = globalThis.__dforgeCanvas;
  const geometry = handle.geometry(id);
  if (geometry === null) return null;
  const viewport = handle.viewport();
  return {
    left: geometry.x * viewport.zoom + viewport.panX,
    top: geometry.y * viewport.zoom + viewport.panY,
    width: geometry.width * viewport.zoom,
    height: geometry.height * viewport.zoom,
  };
}`;

try {
  // --- 夹具 daemon（临时数据根） ---
  daemon = await startFixtureDaemonStripTypes();
  console.log(`夹具 daemon 就绪：${daemon.url}`);
  if (!(await waitForHttp(`${daemon.url}/health`, 15_000))) {
    await finish(2, '阻塞：夹具 daemon /health 不可达。');
  }

  // --- 站点：复用 DF_WEB_URL，或生产构建 + 起服务（禁 next dev） ---
  if (webUrl === null) {
    const webPort = await freePort();
    webUrl = `http://127.0.0.1:${webPort}`;
    const canvasKitScript = join(
      REPO_ROOT,
      'apps/web/src/features/canvas/tools/copy-canvaskit-assets.mjs',
    );
    if (existsSync(canvasKitScript)) {
      const prepared = spawnSync(process.execPath, [canvasKitScript], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      note(
        `CanvasKit 资产：${prepared.status === 0 ? '就位' : '准备失败（编辑器可能阻塞在 Skia）'}`,
      );
    }
    const nextBin = join(WEB_APP_DIR, 'node_modules', '.bin', 'next');
    if (!existsSync(nextBin)) {
      await finish(2, '阻塞：未找到 next 可执行文件（先 pnpm install）。');
    }
    console.log('生产构建（next build）…');
    const build = track(spawn(nextBin, ['build'], { cwd: WEB_APP_DIR, stdio: 'inherit' }));
    const buildCode = await new Promise((settle) => build.on('exit', settle));
    if (buildCode !== 0) {
      await finish(2, '阻塞：web 构建失败（见上方 next build 输出）。');
    }
    track(
      spawn(nextBin, ['start', '-p', String(webPort)], {
        cwd: WEB_APP_DIR,
        stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      }),
      true,
    );
  }
  if (!(await waitForHttp(webUrl, 90_000))) {
    await finish(2, `阻塞：站点不可达（${webUrl}）。`);
  }
  console.log(`站点就绪：${webUrl}`);

  const chrome = resolveChromeExecutable();
  if (chrome === undefined) {
    await finish(2, '阻塞：未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）。');
  }
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // --- 打开编辑器（直连夹具 daemon），等画布就绪 ---
  const editorUrl = `${webUrl}/editor?daemon=${encodeURIComponent(daemon.url)}`;
  await page.goto(editorUrl, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForSelector('[data-df-canvas-shell]', { timeout: 30_000 });
  await waitFor(page, `() => globalThis.__dforgeCanvas?.runtime().canvasKit === 'ready'`, {
    timeout: 90_000,
    label: 'Skia 就绪',
  });
  const canvasBox = await page.locator('[data-df-canvas-shell]').boundingBox();
  if (canvasBox === null) {
    await finish(2, '阻塞：画布壳不可定位（布局未就绪）。');
  }
  /** 画布内局部坐标 → 页面坐标。 */
  const pagePoint = (local) => ({
    x: canvasBox.x + local.x,
    y: canvasBox.y + local.y,
  });

  const rootsBefore = await page.evaluate(() => globalThis.__dforgeCanvas.nodeIds().length);

  // --- ① T 工具路径（巡检已知良好路径，作基线）：点工具 → 点画布 → 覆盖层出现 ---
  await page.click('[data-df-tool="text"]');
  const tClickLocal = { x: 380, y: 260 };
  await page.mouse.click(pagePoint(tClickLocal).x, pagePoint(tClickLocal).y);
  await page.waitForSelector('[data-df-text-overlay]', { timeout: 10_000 });
  const textId = await page.evaluate(() => {
    const element = document.querySelector('[data-df-text-overlay]');
    return element === null ? null : element.getAttribute('data-df-text-overlay');
  });
  record(
    'text.t-tool-enters-editing',
    typeof textId === 'string' && textId.length > 0,
    `T 工具点击画布后覆盖层挂点出现（nodeId=${textId ?? '无'}）`,
  );

  // 输入内容 → 失焦提交（点画布空白处）
  await page.keyboard.type('标题');
  await page.mouse.click(pagePoint({ x: 620, y: 520 }).x, pagePoint({ x: 620, y: 520 }).y);
  await waitFor(
    page,
    `() => globalThis.__dforgeCanvas.editingText() === null && globalThis.__dforgeCanvas.textContent(${JSON.stringify(textId)}) === '标题'`,
    { timeout: 10_000, label: 'T 路径失焦提交落盘' },
  ).catch(() => undefined);
  const tCommitted = await page.evaluate((id) => globalThis.__dforgeCanvas.textContent(id), textId);
  record(
    'text.t-tool-blur-commit',
    tCommitted === '标题',
    `T 路径失焦提交后 textContent=${tCommitted === null ? 'null' : JSON.stringify(tCommitted)}（巡检基线：该路径可用）`,
  );
  if (tCommitted !== '标题') {
    await finish(1, 'T 工具路径失焦提交未落盘——后续双击断言失去基线。');
  }

  // --- ② 双击路径进入编辑 + 覆盖层世界坐标对齐 ---
  const worldCenter = await page.evaluate(
    `(id) => {
      const geometry = globalThis.__dforgeCanvas.geometry(id);
      return { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
    }`,
    textId,
  );
  const viewport = await page.evaluate(() => globalThis.__dforgeCanvas.viewport());
  const textScreenLocal = {
    x: worldCenter.x * viewport.zoom + viewport.panX,
    y: worldCenter.y * viewport.zoom + viewport.panY,
  };
  const textPagePoint = pagePoint(textScreenLocal);
  await page.mouse.dblclick(textPagePoint.x, textPagePoint.y);
  let overlayAppeared = true;
  await page.waitForSelector(overlaySelector(textId), { timeout: 10_000 }).catch(() => {
    overlayAppeared = false;
  });
  const screenBox = await page.evaluate(
    new Function(`return (${SCREEN_BOX_EXPR})(${JSON.stringify(textId)})`),
  );
  record(
    'text.double-click-enters-editing',
    overlayAppeared,
    `双击文本后覆盖层挂点出现（巡检缺口：双击文本点位没进编辑，点到画板）`,
  );

  // 覆盖层 left/top 与世界坐标换算一致（±1px；与 nodeOverlayBox 共享口径）
  let overlayLeft = null;
  let overlayTop = null;
  if (overlayAppeared) {
    overlayLeft = await page
      .locator(overlaySelector(textId))
      .evaluate((element) => Number.parseFloat(element.style.left));
    overlayTop = await page
      .locator(overlaySelector(textId))
      .evaluate((element) => Number.parseFloat(element.style.top));
  }
  const positionOk =
    overlayLeft !== null &&
    Math.abs(overlayLeft - screenBox.left) <= 1 &&
    Math.abs(overlayTop - screenBox.top) <= 1;
  record(
    'text.overlay-world-coords',
    positionOk,
    `覆盖层 left/top=(${overlayLeft ?? '无'}, ${overlayTop ?? '无'})，期望 (${screenBox.left.toFixed(1)}, ${screenBox.top.toFixed(1)})（世界 × zoom + pan）`,
  );

  // --- ③ 编辑回灌（输入即所见） ---
  await page.keyboard.type('改');
  const typed = await page.evaluate(() => globalThis.__dforgeCanvas.editingText()?.characters ?? null);
  record(
    'text.editing-mirrors-input',
    typed === '改标题',
    `输入后 editingText.characters=${typed === null ? 'null' : JSON.stringify(typed)}（应为 '改标题'）`,
  );

  // --- ④ 失焦提交落盘 + 图层面板同步 ---
  await page.mouse.click(pagePoint({ x: 620, y: 520 }).x, pagePoint({ x: 620, y: 520 }).y);
  await waitFor(
    page,
    `() => globalThis.__dforgeCanvas.editingText() === null && globalThis.__dforgeCanvas.textContent(${JSON.stringify(textId)}) === '改标题'`,
    { timeout: 10_000, label: '双击路径失焦提交落盘' },
  ).catch(() => undefined);
  const committed = await page.evaluate((id) => globalThis.__dforgeCanvas.textContent(id), textId);
  record(
    'text.blur-commit-persists',
    committed === '改标题',
    `失焦提交后 textContent=${committed === null ? 'null' : JSON.stringify(committed)}（巡检缺口：失焦提交本轮未落盘）`,
  );
  const panelRowCount = await page.evaluate(
    `(id) => document.querySelectorAll('[data-df-panel="layers"] [data-node-id]').length &&
      document.querySelector('[data-df-panel="layers"] [data-node-id="' + id + '"]') !== null`,
    textId,
  );
  const rootsAfter = await page.evaluate(() => globalThis.__dforgeCanvas.nodeIds().length);
  record(
    'text.layer-panel-synced',
    panelRowCount === true && rootsAfter === rootsBefore + 1,
    `图层面板存在该文本行且文档根节点数 ${rootsBefore} → ${rootsAfter}（同一命令栈真值）`,
  );

  // --- ⑤ Esc 取消不落盘（双击重入路径，覆盖巡检「失焦提交未落盘」的同链路） ---
  await page.mouse.dblclick(textPagePoint.x, textPagePoint.y);
  await page.waitForSelector(overlaySelector(textId), { timeout: 10_000 });
  await page.keyboard.type('丢弃稿');
  await page.keyboard.press('Escape');
  await waitFor(page, `() => globalThis.__dforgeCanvas.editingText() === null`, {
    timeout: 10_000,
    label: 'Esc 关闭编辑会话',
  }).catch(() => undefined);
  const afterEscape = await page.evaluate((id) => globalThis.__dforgeCanvas.textContent(id), textId);
  record(
    'text.esc-cancel-no-write',
    afterEscape === '改标题',
    `Esc 取消后 textContent=${afterEscape === null ? 'null' : JSON.stringify(afterEscape)}（应保持 '改标题'）`,
  );

  // --- ⑥ Enter 路径行为一致：单选文本节点按 Enter → 同一覆盖层挂点 ---
  await page.mouse.click(textPagePoint.x, textPagePoint.y);
  await page.keyboard.press('Enter');
  let enterOverlay = true;
  await page.waitForSelector(overlaySelector(textId), { timeout: 10_000 }).catch(() => {
    enterOverlay = false;
  });
  record(
    'text.enter-path-same-overlay',
    enterOverlay,
    `Enter 路径进入同一覆盖层挂点（data-df-text-overlay=${textId}）`,
  );
  // 收摊：Esc 退出编辑，不落盘
  await page.keyboard.press('Escape');

  // --- ⑦ 超长输入钳制（覆盖层 onChange = 整段替换通道） ---
  await page.mouse.dblclick(textPagePoint.x, textPagePoint.y);
  await page.waitForSelector(overlaySelector(textId), { timeout: 10_000 });
  await page.fill(overlaySelector(textId), '长'.repeat(5050));
  const clampedLength = await page.evaluate(
    () => globalThis.__dforgeCanvas.editingText()?.characters.length ?? -1,
  );
  record(
    'text.overlong-input-clamped',
    clampedLength === 5000,
    `整段替换 5050 字后编辑会话字符数=${clampedLength}（应钳到 5000）`,
  );
  await page.keyboard.press('Escape');

  await context.close();
  await browser.close();
  const failed = evidence.assertions.filter((entry) => entry.ok !== true);
  await finish(
    failed.length === 0 ? 0 : 1,
    failed.length === 0 ? undefined : '有断言未过（见证据）。',
  );
} catch (error) {
  await finish(2, `阻塞：${String(error)}`);
}
