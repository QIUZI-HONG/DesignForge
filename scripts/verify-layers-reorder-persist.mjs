#!/usr/bin/env node
/**
 * verify-layers-reorder-persist —— 票 11（spec P2 图层项）浏览器门禁挂点：
 * 图层拖拽重排真实生效，并随保存持久（刷新后保持）。
 *
 * 为什么必须是浏览器门禁：巡检（ux-audit C3）的「拖拽排序未生效」是**真实链路故障**——
 * HTML5 拖放事件、落位几何（指针 Y + 行矩形）、命令栈事务、daemon 落盘、刷新回读，
 * 每一环都只有真浏览器 + 真 daemon 才能证实；jsdom 组件测试只能守住命令构造的中间表示。
 *
 * 断言（全部走真实 Chromium + 生产构建 + 夹具 daemon，**禁用 next dev**）：
 *   ① 图层面板三行就绪（`data-df-panel="layers"` + `data-node-id`）；
 *   ② 拖拽重排：面板最底行拖到最顶行上半 → 面板行序变化且等于落位约定的预期序
 *      （显示序 = 绘制序逆序；上半 = 面板上方）；undo 恢复原序、redo 复现新序；
 *   ③ 保存（`file.save`，顶栏按钮与 ⌘S 同一条命令）→ `[data-df-save-state="saved"]`
 *      且 `__dforgeCanvas.documentId()` 非空；
 *   ④ 刷新后行序与保存态一致（daemon 落盘 → 载入回读的全链持久）；
 *   ⑤ 行内显隐控件：点眼睛 → `data-df-layer-visible` 翻转（行级控件真渲染、真生效）。
 *
 * **挂点（随票接入）**：本门禁未接 CI；断言脚本与证据落盘已就绪，浏览器级复核由
 * 主会话在集成分支统一执行（`humanReview.verdict` 恒为 pending，直到复核登记）。
 *
 * 退出码（三态，禁止假绿）：0 全过 / 1 断言违规 / 2 阻塞（构建失败 / daemon 起不来 /
 * 站点不可达 / Chromium 缺失 / 用例异常）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-layers-reorder-persist.mjs
 *   DF_WEB_URL=http://127.0.0.1:<port> node scripts/verify-layers-reorder-persist.mjs   # 复用已起站点
 *
 * 环境变量：DF_WEB_URL / DF_EVIDENCE_DIR / BENCH_CHROME_EXECUTABLE。
 * 端口纪律：空闲端口（4460 起），不碰 3000/4318；daemon 用临时数据根（不碰 ~/.dforge）。
 * 本机事实（brief）：node 22.16 直跑 daemon main.ts 会 ERR_UNKNOWN_FILE_EXTENSION——
 * 这里显式带 `--experimental-strip-types`（`scripts/lib/gates.mjs` 的 startFixtureDaemon
 * 尚未带旗标，票 10 收口前本脚本自起，不动共享件）。
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
  process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence', '11-layers-panel'),
);

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
let webUrl = args.includes('--web-url')
  ? args[args.indexOf('--web-url') + 1]
  : (process.env.DF_WEB_URL ?? null);

const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const evidencePath = join(EVIDENCE_DIR, `verify-layers-reorder-persist-${stamp}.json`);

/** 证据对象（验收标准 §4 字段族；humanReview 恒待主会话登记）。 */
const evidence = {
  ticket: '11-layers-panel',
  gate: 'verify-layers-reorder-persist',
  level: 'A（真实拖放事件 + 命令栈事务 + daemon 落盘回读——jsdom 不可达的全链事实）',
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
      '挂点（随票接入）：断言脚本已就绪；浏览器级复核（拖拽手感/行控件的 hover 显现观感/重命名全链）由主会话在集成分支统一执行。',
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
  // 第三段（Next 16 实测，同 verify-command-palette）：`next start` 会把 next-server fork
  // 进另一个进程组，组杀够不到——按端口找监听者的精确 PID 再 SIGKILL。
  // 端口是本脚本自选的空闲端口（4460+），谁在上面监听谁就是本脚本起的（不波及其它端口）。
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

/**
 * 按「监听端口 → socket inode → 持有 fd 的进程」找监听者并 SIGKILL（精确 PID）。
 * 只应作用于本脚本自选的空闲端口；其它端口一律不碰。
 */
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

/**
 * 起夹具 daemon（自带 --experimental-strip-types，本机 node 22.16 事实；临时数据根）。
 * 与 lib/gates.mjs 的 startFixtureDaemon 同形，但不在共享件上动刀（票 10 收口前）。
 */
async function startFixtureDaemonStripTypes() {
  const port = await freePort();
  // 数据根落证据目录（铁律：禁用 /tmp 当工作树/缓存；e2e-smoke 的 runDir 同口径）
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

/** 编辑器行序读点：面板内全部行的 data-node-id（面板显示序 = 逆绘制序）。 */
const ORDER_EXPR = `Array.from(
  document.querySelectorAll('[data-df-panel="layers"] [data-node-id]'),
).map((element) => element.getAttribute('data-node-id'))`;
const ORDER_SNIPPET = `() => ${ORDER_EXPR}`;

try {
  // --- 夹具 daemon（临时数据根；拖拽重排要落盘回读，必须有真 daemon） ---
  daemon = await startFixtureDaemonStripTypes();
  console.log(`夹具 daemon 就绪：${daemon.url}`);
  if (!(await waitForHttp(`${daemon.url}/health`, 15_000))) {
    await finish(2, '阻塞：夹具 daemon /health 不可达。');
  }

  // --- 站点：复用 DF_WEB_URL，或生产构建 + 起服务（禁 next dev，见 implementation-workflow） ---
  if (webUrl === null) {
    const webPort = await freePort();
    webUrl = `http://127.0.0.1:${webPort}`;
    // CanvasKit 运行时资产（/editor 依赖；生成物不入库，fresh worktree 需要）
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

  // --- ① 打开编辑器（直连夹具 daemon），等画布就绪 + 图层面板有行 ---
  const editorUrl = `${webUrl}/editor?daemon=${encodeURIComponent(daemon.url)}`;
  await page.goto(editorUrl, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForSelector('[data-df-panel="layers"]', { timeout: 30_000 });
  await waitFor(page, `() => globalThis.__dforgeCanvas?.runtime().canvasKit === 'ready'`, {
    timeout: 90_000,
    label: 'Skia 就绪',
  });

  // 三个矩形（拖画路径的等价入口，写路径仍是命令栈）——绘制序 a, b, c（c 最上层）
  const rectIds = [];
  for (const [index, bounds] of [
    { x: 40, y: 40, width: 80, height: 60 },
    { x: 200, y: 60, width: 80, height: 60 },
    { x: 360, y: 80, width: 80, height: 60 },
  ].entries()) {
    const id = await page.evaluate((box) => globalThis.__dforgeCanvas.createRect(box), bounds);
    if (typeof id !== 'string' || id === '') {
      await finish(2, `阻塞：createRect 第 ${String(index + 1)} 个未返回 id。`);
    }
    rectIds.push(id);
  }
  const [bottomId, , topId] = rectIds; // 绘制序首个 = 面板最底行；末个 = 面板最顶行
  await waitFor(page, `() => ${ORDER_EXPR}.length === 3`, {
    label: '面板出现三行',
  });
  const initialOrder = await page.evaluate(ORDER_SNIPPET);
  record(
    'layers.panel-rows-ready',
    initialOrder.length === 3,
    `面板行序（显示序=逆绘制序）：[${initialOrder.join(', ')}]`,
  );

  // --- ② 拖拽：最底行拖到最顶行「上半」→ 面板最顶（落位约定：上半 = 面板上方） ---
  const expectedOrder = [bottomId, topId, rectIds[1]];
  await page.dragAndDrop(
    `[data-df-panel="layers"] [data-node-id="${bottomId}"]`,
    `[data-df-panel="layers"] [data-node-id="${topId}"]`,
    { targetPosition: { x: 20, y: 3 } },
  );
  await waitFor(
    page,
    `() => JSON.stringify(${ORDER_EXPR}) === JSON.stringify(${JSON.stringify(expectedOrder)})`,
    { timeout: 10_000, label: '拖拽后行序变化' },
  ).catch(() => undefined);
  const draggedOrder = await page.evaluate(ORDER_SNIPPET);
  record(
    'layers.drag-reorder-applies',
    JSON.stringify(draggedOrder) === JSON.stringify(expectedOrder),
    `拖拽后行序：[${draggedOrder.join(', ')}]，预期 [${expectedOrder.join(', ')}]` +
      `（巡检基线：拖拽排序未生效——面板纹丝不动）`,
  );

  // undo / redo（同一条命令栈历史：撤销还原顺序）
  await page.keyboard.press('Control+z');
  await waitFor(
    page,
    `() => JSON.stringify(${ORDER_EXPR}) === JSON.stringify(${JSON.stringify(initialOrder)})`,
    { timeout: 10_000, label: '撤销还原行序' },
  ).catch(() => undefined);
  const undoneOrder = await page.evaluate(ORDER_SNIPPET);
  record(
    'layers.drag-reorder-undo',
    JSON.stringify(undoneOrder) === JSON.stringify(initialOrder),
    `撤销后行序：[${undoneOrder.join(', ')}]，应回到 [${initialOrder.join(', ')}]`,
  );
  await page.keyboard.press('Control+Shift+z');
  await waitFor(
    page,
    `() => JSON.stringify(${ORDER_EXPR}) === JSON.stringify(${JSON.stringify(expectedOrder)})`,
    { timeout: 10_000, label: '重做复现行序' },
  ).catch(() => undefined);

  // --- ③ 保存（顶栏保存键 = file.save 命令，与 ⌘S 同一 id）→ saved + documentId ---
  await page.click('[data-df-save-action="save"]');
  await waitFor(page, `() => document.querySelector('[data-df-save-state="saved"]') !== null`, {
    timeout: 30_000,
    label: '保存态落定为 saved',
  }).catch(() => undefined);
  const savedState = await page
    .locator('[data-df-save-state]')
    .getAttribute('data-df-save-state')
    .catch(() => null);
  const documentId = await page.evaluate(() => globalThis.__dforgeCanvas.documentId());
  record(
    'layers.save-persisted',
    savedState === 'saved' && typeof documentId === 'string' && documentId.length > 0,
    `保存态=${savedState ?? '（无读点）'}，documentId=${typeof documentId === 'string' ? documentId : 'null'}`,
  );

  // --- ④ 刷新 → 行序与保存态一致（daemon 落盘 → 载入回读） ---
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-df-panel="layers"]', { timeout: 30_000 });
  await waitFor(page, `() => ${ORDER_EXPR}.length === 3`, {
    timeout: 30_000,
    label: '刷新后面板三行',
  });
  await waitFor(
    page,
    `() => JSON.stringify(${ORDER_EXPR}) === JSON.stringify(${JSON.stringify(expectedOrder)})`,
    { timeout: 20_000, label: '刷新后行序保持' },
  ).catch(() => undefined);
  const reloadedOrder = await page.evaluate(ORDER_SNIPPET);
  record(
    'layers.order-survives-reload',
    JSON.stringify(reloadedOrder) === JSON.stringify(expectedOrder),
    `刷新后行序：[${reloadedOrder.join(', ')}]，应保持 [${expectedOrder.join(', ')}]`,
  );

  // --- ⑤ 行内显隐控件（票 11 缺口④的浏览器实证；主会话复核锁定态观感） ---
  const eyeSlot = `[data-df-panel="layers"] [data-node-id="${bottomId}"] [data-df-layer-action="visibility"]`;
  await page.hover(`[data-df-panel="layers"] [data-node-id="${bottomId}"]`);
  await page.click(`${eyeSlot} button`);
  await waitFor(
    page,
    `() => document.querySelector(${JSON.stringify(eyeSlot)})?.getAttribute('data-df-layer-visible') === 'false'`,
    { timeout: 10_000, label: '显隐控件翻转' },
  ).catch(() => undefined);
  const visibleAfter = await page
    .locator(eyeSlot)
    .getAttribute('data-df-layer-visible')
    .catch(() => null);
  record(
    'layers.row-visibility-toggle',
    visibleAfter === 'false',
    `点眼睛后 data-df-layer-visible=${visibleAfter ?? '（控件不存在）'}（应为 false）`,
  );

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
