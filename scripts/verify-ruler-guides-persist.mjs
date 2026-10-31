#!/usr/bin/env node
/**
 * verify-ruler-guides-persist —— 票 12（spec P2 标尺参考线）浏览器门禁挂点：
 * 从标尺拖出参考线真实可见、参与吸附、可删除，并随保存持久（刷新后保持）。
 *
 * 为什么必须是浏览器门禁：巡检（ux-audit C8）的「从标尺拖拽无任何反应」是**真实链路故障**——
 * 标尺条命中（屏幕几何）、pointer 事件流、拖拽预览渲染（Skia 像素）、命令栈事务、
 * daemon 落盘、刷新回读，每一环都只有真浏览器 + 真 daemon 才能证实；jsdom 没有 Skia/布局。
 *
 * 断言（全部走真实 Chromium + 生产构建 + 夹具 daemon，**禁用 next dev**）：
 *   ① 拖出参考线：从顶标尺按下 → 拖到画布（拖拽中断言 HUD 位置与预览计数 stats().guides ≥ 1）
 *      → 松手入页面数据（`__dforgeCanvas.guides()` 一条水平线 y=200）；undo 清空、redo 复现；
 *   ② 参考线渲染：`stats().guides === 1`（常驻线真实落像素）；
 *   ③ 吸附生效：拖矩形使底缘落到参考线 6px 阈值内 → 松手后底缘**精确贴线**（阈值吸附）；
 *   ④ 删除——拖回标尺：把参考线拖回顶标尺松手 → guides() 清空（undo 可恢复）；
 *   ⑤ 删除——右键菜单：在另一位置再拖出一条 → 右键线上 → 菜单「删除参考线」→ 该线清空
 *     （undo 恢复的那条原样保留）；
 *   ⑥ 保存（file.save）→ `[data-df-save-state="saved"]`；刷新后 guides() 与保存前一致
 *     （daemon 落盘 → 载入回读的全链持久）。
 *
 * **挂点（随票接入）**：本门禁未接 CI；断言脚本与证据落盘已就绪，浏览器级复核由
 * 主会话在集成分支统一执行（`humanReview.verdict` 恒为 pending，直到复核登记）。
 *
 * 退出码（三态，禁止假绿）：0 全过 / 1 断言违规 / 2 阻塞（构建失败 / daemon 起不来 /
 * 站点不可达 / Chromium 缺失 / 用例异常）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-ruler-guides-persist.mjs
 *   DF_WEB_URL=http://127.0.0.1:<port> node scripts/verify-ruler-guides-persist.mjs   # 复用已起站点
 *
 * 环境变量：DF_WEB_URL / DF_EVIDENCE_DIR / BENCH_CHROME_EXECUTABLE。
 * 端口纪律：空闲端口（4470 起），不碰 3000/4318；daemon 用临时数据根（不碰 ~/.dforge）。
 * 本机事实（brief）：node 22.16 直跑 daemon main.ts 会 ERR_UNKNOWN_FILE_EXTENSION——
 * 显式带 `--experimental-strip-types`（同 verify-layers-reorder-persist，不动共享件）。
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
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveChromeExecutable } from './lib/browser-toolchain.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_APP_DIR = join(REPO_ROOT, 'apps', 'web');
const EVIDENCE_DIR = resolve(
  process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence', '12-ruler-guides'),
);

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
let webUrl = args.includes('--web-url')
  ? args[args.indexOf('--web-url') + 1]
  : (process.env.DF_WEB_URL ?? null);
/** 复用外部已起站点（DF_WEB_URL / --web-url）→ 跳过本脚本的 build + start。 */
const reuseSite = webUrl !== null;

const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const evidencePath = join(EVIDENCE_DIR, `verify-ruler-guides-persist-${stamp}.json`);

/** 证据对象（验收标准 §4 字段族；humanReview 恒待主会话登记）。 */
const evidence = {
  ticket: '12-ruler-guides',
  gate: 'verify-ruler-guides-persist',
  level: 'A（真实标尺拖拽 + 吸附命中 + 右键菜单 + daemon 落盘回读——jsdom 不可达的全链事实）',
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
      '挂点（随票接入）：断言脚本已就绪；浏览器级复核（拖拽手感/红线观感/右键菜单层级）由主会话在集成分支统一执行。',
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
  signalChildren('SIGTERM');
  await sleep(800);
  signalChildren('SIGKILL');
  if (daemon !== null) await daemon.close().catch(() => undefined);
  // 第三段（Next 16 实测，同 verify-layers-reorder）：next start 会 fork next-server 到
  // 另一个进程组，组杀够不到——按端口找监听者的精确 PID 再 SIGKILL（只作用本脚本自选端口）。
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

/** 找空闲端口（4470 起，远离 3000/4318 与 layers 门禁的 4460 段）。 */
async function freePort() {
  for (let port = 4470; port < 4540; port += 1) {
    if (!(await portBusy(port))) return port;
  }
  throw new Error('找不到空闲端口');
}

/**
 * 先选定并**占住**端口，返回释放函数：站点端口在夹具 daemon 之前选定（daemon 的 CORS
 * 白名单要写站点源），但 next start 要等构建后才绑定——不占住的话 daemon 的 freePort
 * 会撞同一个号（实测：daemon 与站点同抢 4470，「站点就绪」探测到的是 daemon）。
 */
async function holdPort(port) {
  const server = createServer();
  await new Promise((settle, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', settle);
  });
  server.unref();
  return () =>
    new Promise((settle) => {
      server.close(() => settle());
    });
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

/** 起夹具 daemon（--experimental-strip-types；临时数据根，不碰 ~/.dforge）。 */
async function startFixtureDaemonStripTypes(corsOrigins) {
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
          // 编辑器以查询参数里的绝对地址跨源直连 daemon；CORS 白名单（INF-01，daemon 侧
          // 职责）不放行站点源时，save/加载请求会被浏览器整批拦掉——save-persisted 假红。
          ...(corsOrigins === undefined ? {} : { DF_CORS_ORIGINS: corsOrigins.join(',') }),
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

/**
 * 参考线读点：`__dforgeCanvas.guides()`（id/axis/position）。
 *
 * 必须是**值表达式**而不是「箭头函数字符串」：Playwright 对 `page.evaluate(字符串)`
 * 只求值不回调——箭头函数串求值结果是一个**不可序列化的函数值**，会被静默丢成
 * `undefined`（实测 chromium-1243 + playwright-core 1.63.0），下游 `.length` 直接
 * TypeError。值表达式直取数组；需要调用处的 `waitFor` 谓词体内也直接拼该表达式
 * （不再 `GUIDES_SNIPPET()` 二次调用——那会把谓词变成「返回函数的函数」同样丢值）。
 */
const GUIDES_SNIPPET = `(globalThis.__dforgeCanvas?.guides?.() ?? [])`;

try {
  // 站点端口先定（复用 DF_WEB_URL 时不重复选）：夹具 daemon 的 CORS 白名单要把站点源
  // 放进去——编辑器跨源直连 daemon，白名单外浏览器会拦掉 save/加载请求。
  let releaseWebPort = null;
  if (webUrl === null) {
    webUrl = `http://127.0.0.1:${await freePort()}`;
    releaseWebPort = await holdPort(Number(new URL(webUrl).port));
  }

  // --- 夹具 daemon（参考线要落盘回读，必须有真 daemon） ---
  daemon = await startFixtureDaemonStripTypes([webUrl]);
  await releaseWebPort?.();
  console.log(`夹具 daemon 就绪：${daemon.url}`);
  if (!(await waitForHttp(`${daemon.url}/health`, 15_000))) {
    await finish(2, '阻塞：夹具 daemon /health 不可达。');
  }

  // --- 站点：生产构建 + 起服务（禁 next dev）；端口已在 daemon 前选定（CORS 白名单用） ---
  if (!reuseSite) {
    const webPort = Number(new URL(webUrl).port);
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

  // 确定性视口：zoom=1、pan=(0,0)，屏幕坐标 == 世界坐标（标尺条在壳内 0..20px）
  await page.evaluate(() => globalThis.__dforgeCanvas.setViewport({ zoom: 1, panX: 0, panY: 0 }));
  const shell = await page.locator('[data-df-canvas-shell]').boundingBox();
  if (shell === null) await finish(2, '阻塞：画布壳无 boundingBox（布局未就绪）。');
  const at = (dx, dy) => ({ x: shell.x + dx, y: shell.y + dy });
  const GUIDE_X = 400;
  const GUIDE_Y = 200;

  // --- ① 拖出参考线（真实鼠标事件：顶标尺 → 画布） ---
  let from = at(GUIDE_X, 8);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  let to = at(GUIDE_X, GUIDE_Y);
  await page.mouse.move(to.x, to.y, { steps: 6 });
  // 拖拽中：HUD 显示世界位置 + 预览线已画（stats().guides ≥ 1）
  const hudDuring = await page.evaluate(() => globalThis.__dforgeCanvas.hud());
  const previewCount = await page.evaluate(() => globalThis.__dforgeCanvas.stats()?.guides ?? -1);
  record(
    'guides.drag-hud-and-preview',
    hudDuring === `Y ${GUIDE_Y}` && previewCount >= 1,
    `拖拽中 HUD=${String(hudDuring)}（应 Y ${GUIDE_Y}），stats.guides=${previewCount}（应 ≥1）`,
  );
  await page.mouse.up();
  await waitFor(
    page,
    `() => ${GUIDES_SNIPPET}.some((g) => g.axis === 'y' && g.position === ${GUIDE_Y})`,
    { timeout: 10_000, label: '松手后参考线入页面数据' },
  ).catch(() => undefined);
  const afterDrag = await page.evaluate(GUIDES_SNIPPET);
  record(
    'guides.drag-out-persists-in-page',
    afterDrag.length === 1 && afterDrag[0]?.axis === 'y' && afterDrag[0]?.position === GUIDE_Y,
    `松手后 guides=${JSON.stringify(afterDrag)}（巡检基线：从标尺拖拽无任何反应）`,
  );

  // --- ② 常驻渲染（松手后 stats().guides 计数） ---
  const rendered = await page.evaluate(() => globalThis.__dforgeCanvas.stats()?.guides ?? -1);
  record('guides.rendered-on-canvas', rendered === 1, `stats().guides=${rendered}（应 =1）`);

  // undo / redo（命令栈历史：撤销清空、重做复现）
  await page.keyboard.press('Control+z');
  await waitFor(page, `() => ${GUIDES_SNIPPET}.length === 0`, {
    timeout: 10_000,
    label: '撤销清空参考线',
  }).catch(() => undefined);
  const undone = await page.evaluate(GUIDES_SNIPPET);
  await page.keyboard.press('Control+Shift+z');
  await waitFor(page, `() => ${GUIDES_SNIPPET}.length === 1`, {
    timeout: 10_000,
    label: '重做复现参考线',
  }).catch(() => undefined);
  const redone = await page.evaluate(GUIDES_SNIPPET);
  record(
    'guides.undo-redo',
    undone.length === 0 && redone.length === 1 && redone[0]?.position === GUIDE_Y,
    `撤销后=${JSON.stringify(undone)}，重做后=${JSON.stringify(redone)}`,
  );

  // --- ③ 吸附生效：拖矩形，让底缘落进参考线 6px 阈值 → 精确贴线 ---
  const rectId = await page.evaluate(() =>
    globalThis.__dforgeCanvas.createRect({ x: 80, y: 60, width: 80, height: 60 }),
  );
  if (typeof rectId !== 'string' || rectId === '') {
    await finish(2, '阻塞：createRect 未返回 id。');
  }
  // 矩形 (80,60,80,60)：底缘 120。在矩形内 (120,100) 按下向下拖 84px（指针到 y=184）：
  // 松手前底缘 204（距参考线 4px，落进 6px 阈值；顶缘 144/中心 174 均在阈值外——
  // 只有底缘命中，断言无歧义）→ 阈值吸附 -4 → 底缘精确 200。
  const grab = at(120, 100);
  const drop = at(120, 184);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 8 });
  await page.mouse.up();
  const geom = await page.evaluate(
    (id) => globalThis.__dforgeCanvas.geometry(id),
    /** @returns {unknown} */ rectId,
  );
  const bottom = geom === null ? null : geom.y + geom.height;
  record(
    'guides.snap-aligns-bottom',
    bottom === GUIDE_Y,
    `拖 84px 后底缘=${String(bottom)}（应 ${GUIDE_Y}：阈值吸附把 204 拉回 200）`,
  );

  // --- ④ 删除：拖回标尺 ---
  from = at(GUIDE_X, GUIDE_Y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  to = at(GUIDE_X, 8);
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await waitFor(page, `() => ${GUIDES_SNIPPET}.length === 0`, {
    timeout: 10_000,
    label: '拖回标尺删除',
  }).catch(() => undefined);
  const afterDragBack = await page.evaluate(GUIDES_SNIPPET);
  await page.keyboard.press('Control+z');
  const afterUndoDelete = await page.evaluate(GUIDES_SNIPPET);
  record(
    'guides.drag-back-to-ruler-deletes',
    afterDragBack.length === 0 && afterUndoDelete.length === 1,
    `拖回标尺后=${JSON.stringify(afterDragBack)}（应空），undo 恢复=${afterUndoDelete.length} 条（应 1）`,
  );

  // --- ⑤ 删除：右键菜单（在无歧义的新位置 y=300 再拖出一条：④ 的 undo 恢复了 y=200
  //     那条，同点再拖会叠出两条线、菜单删的是「后建在上」的新线，断言会假红） ---
  const MENU_GUIDE_Y = 300;
  const rulerFrom = at(GUIDE_X, 8);
  await page.mouse.move(rulerFrom.x, rulerFrom.y);
  await page.mouse.down();
  const menuDrop = at(GUIDE_X, MENU_GUIDE_Y);
  await page.mouse.move(menuDrop.x, menuDrop.y, { steps: 6 });
  await page.mouse.up();
  await waitFor(
    page,
    `() => ${GUIDES_SNIPPET}.some((g) => g.axis === 'y' && g.position === ${MENU_GUIDE_Y})`,
    { timeout: 10_000, label: `再拖出一条参考线（y=${MENU_GUIDE_Y}）` },
  ).catch(() => undefined);
  const menuAt = at(GUIDE_X, MENU_GUIDE_Y);
  await page.mouse.click(menuAt.x, menuAt.y, { button: 'right' });
  const deleteItem = page.getByText('删除参考线');
  await deleteItem.click({ timeout: 10_000 }).catch(() => undefined);
  await waitFor(page, `() => ${GUIDES_SNIPPET}.every((g) => g.position !== ${MENU_GUIDE_Y})`, {
    timeout: 10_000,
    label: '右键删除参考线',
  }).catch(() => undefined);
  const afterContextMenu = await page.evaluate(GUIDES_SNIPPET);
  record(
    'guides.context-menu-deletes',
    afterContextMenu.length === 1 && afterContextMenu[0]?.position === GUIDE_Y,
    `右键菜单删除后=${JSON.stringify(afterContextMenu)}（应只剩 undo 恢复的 y=${GUIDE_Y} 那条）`,
  );
  await page.keyboard.press('Escape');

  // --- ⑥ 保存 → 刷新 → 参考线仍在（再从左标尺拖出一条垂直线一起验持久） ---
  // 从**左**标尺（x=8 < 20）起手才是垂直线（axis 'x'，位置 = 指针世界 x）；从顶条起手
  // 拖出的是第二条水平线，axis==='x' 的等待会被吞成超时假绿（实测踩过）。
  const rulerXFrom = at(8, 400);
  await page.mouse.move(rulerXFrom.x, rulerXFrom.y);
  await page.mouse.down();
  const verticalDrop = at(120, 400);
  await page.mouse.move(verticalDrop.x, verticalDrop.y, { steps: 6 });
  await page.mouse.up();
  await waitFor(page, `() => ${GUIDES_SNIPPET}.some((g) => g.axis === 'x' && g.position === 120)`, {
    timeout: 10_000,
    label: '拖出垂直参考线',
  }).catch(() => undefined);
  const beforeSave = await page.evaluate(GUIDES_SNIPPET);

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
    'guides.save-persisted',
    savedState === 'saved' && typeof documentId === 'string' && documentId.length > 0,
    `保存态=${savedState ?? '（无读点）'}，documentId=${typeof documentId === 'string' ? documentId : 'null'}`,
  );

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-df-canvas-shell]', { timeout: 30_000 });
  await waitFor(page, `() => globalThis.__dforgeCanvas?.runtime().canvasKit === 'ready'`, {
    timeout: 90_000,
    label: '刷新后 Skia 就绪',
  });
  await waitFor(
    page,
    `() => JSON.stringify(${GUIDES_SNIPPET}) === JSON.stringify(${JSON.stringify(beforeSave)})`,
    { timeout: 20_000, label: '刷新后参考线保持' },
  ).catch(() => undefined);
  const afterReload = await page.evaluate(GUIDES_SNIPPET);
  record(
    'guides.survive-reload',
    JSON.stringify(afterReload) === JSON.stringify(beforeSave),
    `刷新后 guides=${JSON.stringify(afterReload)}，应保持 ${JSON.stringify(beforeSave)}`,
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
