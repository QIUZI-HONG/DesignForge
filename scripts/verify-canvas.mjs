#!/usr/bin/env node
/**
 * verify-canvas —— FE-06 门禁：画布**挂载 6 断言** + 白名单 13 类接线断言 + C9/C11 外观断言
 * + 截图对照段（C8 深色对标页）。
 *
 * 六条挂载断言（简报 §3，**不依赖参照集**）：
 *   ① canvas 元素挂载且 Skia 初始化成功；
 *   ② 首帧渲染完成（帧计数 ≥1）；
 *   ③ 点选命中并高亮（选择集 + 渲染统计的轮廓与 8 手柄 + 主色像素真实落盘）；
 *   ④ 拖动改变节点 transform（读引擎断言：拖动中文档不变、松手后才写）；
 *   ⑤ 滚轮缩放改变视口；
 *   ⑥ 保存 → 重载 → 恢复（持久化往返，走 daemon `.dfg` 目录态）。
 *
 * 白名单 13 类（选择/移动/缩放/旋转/画布缩放/画布平移/复制粘贴/层级/编组/撤销重做/对齐/吸附/文本编辑）
 * 用**真实指针与键盘事件**驱动，逐条记录证据；另附 C9 浮层工具条（13 胶囊）与
 * C11 右键菜单（条目 32 高 + 快捷键右对齐）的 DOM 断言。
 *
 * 四回归场景（票 16 · 报告 §五③/§E1-E4——Node 级测试看不见、只有真浏览器能逮住的故障）：
 *   R1（E1）CanvasKit 脚本加载失败 → 失败标签即摘即净 → 产品路径重试（会话换代重挂）→ 重试成功；
 *   R2（E4）指针拖出画布松开 → 交互收口（interaction 归 idle、拖动提交、节点不粘光标）；
 *   R3（E2）拖动节点松手 → 浮层工具条位置跟随（文档快照订阅驱动，不停在拖动前坐标）；
 *   R4（E3）焦点在按钮上按空格/Enter → 按钮原生激活、画布不劫持（不进平移预备、不误触 editText）。
 *
 * 截图对照段：与 REF-01 冻结的参照集逐像素比对（主基准视口 **1440×900 @DPR1.5**，
 * 主题 **dark**——C8 属编辑器族；参照图名按清单规范 `figma-C-C8-canvas-dark-default.png`）；
 * **无参照集 → 该段 exit 2** 并打印「阻塞：参照集未冻结」——禁止用自截图假绿。
 *
 * 退出码（三态）：0 全过 / 1 功能断言（挂载/接线/回归）违规 / 2 前置不成立（Chromium 缺失 /
 * 生产构建或站点、daemon 起不来）或功能通过但截图段阻塞（参照集未冻结）。
 *
 * 驱动口径（仓库纪律，票 16 起收口）：**生产构建 + `next start`**（禁 `next dev` 跑浏览器门禁——
 * dev 源不加载客户端引导件，断言会假红）；Chromium 经 `resolveChromeExecutable`（chromium-1243）；
 * daemon/站点端口显式且远离 3000/4318；临时数据根落仓外证据目录（**禁 /tmp**），
 * 严禁连真实 daemon / 读写 `~/.dforge`。
 *
 * **任何退出路径**都先走 `release()`（浏览器 + daemon/next 子进程 + 临时目录），再 `process.exit`——
 * 直接退出会把子进程留在机器上（实测残留 daemon 占端口，另一 worktree 曾积 21 个）。
 * 证据字段按验收标准 §4：`diff{bbox,diffPixels,ratio}` 为顶层摘要（无比对时三项 null + note）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-canvas.mjs                 # 自动起 daemon（临时数据根）+ 生产构建 + next start
 *   DF_WEB_URL=http://127.0.0.1:3226 node scripts/verify-canvas.mjs   # 复用在跑的生产站点
 *   DF_DAEMON_URL=http://127.0.0.1:14318 node scripts/verify-canvas.mjs --verbose
 *
 * 环境变量：DF_WEB_URL / DF_DAEMON_URL / DF_EVIDENCE_DIR / DF_REF_DIR / BENCH_CHROME_EXECUTABLE。
 *
 * 为什么浏览器与 daemon 不同源也能跑：daemon（INF-01）当前**不发 CORS 头**，浏览器直连会被拦；
 * 本脚本用 Playwright 路由把页面里的 `/df-daemon/**` 同源请求转发给真实 daemon（Node 侧 fetch）——
 * 被验证的仍是「客户端真实请求语义 + daemon 真实持久化」，绕开的只有浏览器 CORS 层
 * （跨票待办：daemon 补 CORS 头或前端加同源代理）。
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DAEMON_ROUTE_PREFIX,
  forwardDaemonRequests,
  resolveChromeExecutable,
} from './lib/browser-toolchain.mjs';
import { bboxOfDiff } from './lib/pixels.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_APP_DIR = join(REPO_ROOT, 'apps', 'web');
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const REF_DIR = resolve(process.env.DF_REF_DIR ?? join(homedir(), 'df-evidence', 'reference-v1'));
const EVIDENCE_DIR = join(EVIDENCE_ROOT, 'fe-06');
const ARTIFACTS_DIR = join(EVIDENCE_DIR, 'actual');
/** 验收标准 §3 主基准视口：1440×900 CSS @ DPR 1.5（1280×800 属「不破版」窄窗档，不用于对照）。 */
const VIEWPORT = { width: 1440, height: 900, dpr: 1.5 };
/** 截图段的对标单元（C8 画布；参照图名按清单规范 figma-<区段>-<ID>-<名称>-<主题>-<状态>.png）。 */
const SCREENSHOT_UNIT = 'figma-C-C8-canvas-dark-default';
/** C8 属编辑器族：主题恒深色（验收标准 §3 逐页对齐 Figma 本体，不得按浅色取样）。 */
const SCREENSHOT_THEME = 'dark';
const THRESHOLD = 0.1;
const MAX_RATIO = 0.001;
/** 页面里的 daemon 相对前缀（实现与解析回抽到 `lib/browser-toolchain.mjs`，复核 J8）。 */
const DAEMON_PREFIX = DAEMON_ROUTE_PREFIX;

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
let webUrl = flagValue('--web-url') ?? process.env.DF_WEB_URL;
let daemonUrl = flagValue('--daemon-url') ?? process.env.DF_DAEMON_URL;

const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const evidencePath = join(EVIDENCE_DIR, `verify-canvas-${stamp}.json`);

const assertions = [];
const wiring = [];
const notes = [];
const cleanups = [];
let daemonProcess;
let workspaceDir;
/** daemon 临时数据根（与工作目录同批落仓外证据目录；release 一并清）。 */
let dataRootDir;
/** 交互用浏览器（`finish` 前统一关闭；截图段另起浏览器，自管生命周期）。 */
let browser = null;

/**
 * 子进程登记表：`finish()` 是唯一出口，但异常退出（`process.on('exit')`）也要兜底杀——
 * 实测残留 daemon 会占端口（另一 worktree 曾积 21 个），故双保险：异步收尾 + 同步兜底。
 */
const children = new Set();
function track(child) {
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}
process.on('exit', () => {
  for (const child of children) signalChild(child, 'SIGTERM');
});
// 手动 Ctrl-C / kill 也要带走独立进程组（detached 的子进程不在本进程组内，不受终端信号影响）。
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  process.on(signal, () => {
    for (const child of children) signalChild(child, 'SIGTERM');
    process.exit(code);
  });
}

/** 证据对象（`finish` 落盘；中途可直接改字段）。 */
const evidence = {
  ticket: 'FE-06',
  gate: 'verify-canvas',
  page: '/_canvas（C8 画布宿主页；编辑器路由归 FE-03，落地后搬入）',
  level: 'A（几何/手柄/参考线/令牌色）+ B（拖拽与吸附手感，人工录屏）',
  params: { threshold: THRESHOLD, maxRatio: MAX_RATIO, engine: 'pixelmatch@8.0.0', aaIgnore: true },
  viewport: VIEWPORT,
  startedAt: startedAt.toISOString(),
  webUrl: null,
  daemonUrl: null,
  assertions,
  wiring,
  screenshot: {
    unit: SCREENSHOT_UNIT,
    status: 'pending',
    reference: join(REF_DIR, `${SCREENSHOT_UNIT}.png`),
    diff: null,
    artifacts: {},
  },
  /**
   * 像素比对摘要（验收标准 §4 字段族：`diff.bbox` / `diffPixels` / `ratio`）。
   * 无像素比对结论时（功能断言失败 / 参照集未冻结 / 尺寸不一致）三项均为 `null` + `note` 说明，
   * 不写伪零值——0 差异与「没比对」必须可区分。
   */
  diff: { bbox: null, diffPixels: null, ratio: null, note: '尚未比对（截图段未执行）' },
  notes,
  humanReview: {
    verdict: 'pending',
    reviewer: null,
    reason: '自动判定只给 A 级结论；拖拽/吸附手感与字形观感按 B 级需人工录屏复核登记。',
  },
  exitCode: 2,
};

/** 记录一条结论。 */
function record(list, id, ok, detail) {
  list.push({ id, ok, detail });
  const mark = ok === true ? 'ok' : ok === 'skip' ? '—' : 'FAIL';
  console.log(
    `  [${mark}] ${id} —— ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`,
  );
}

/**
 * 落盘证据 → 释放子进程/浏览器/临时目录 → 结束进程。
 *
 * 为什么必须在这里 release：本函数是门禁的**唯一出口**，而子进程（daemon / next dev）
 * 不会被父进程退出自动带走——旧的 `process.exit()` 直退会让 `release()` 永不执行，
 * 实测残留 daemon 会持续占端口（另一 worktree 曾积 21 个）。
 */
async function finish(code, message) {
  evidence.finishedAt = new Date().toISOString();
  evidence.exitCode = code;
  evidence.webUrl = webUrl ?? null;
  evidence.daemonUrl = daemonUrl ?? null;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`证据：${evidencePath}`);
  if (message) console.error(message);
  await release();
  process.exit(code);
}

/** `{sha256,length}` 指纹。 */
function fingerprint(filePath) {
  const buffer = readFileSync(filePath);
  return {
    path: filePath,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    length: buffer.length,
  };
}

/**
 * 轮询等待（谓词可同步返回，也可返回 Promise；同步抛错按「未就绪」处理）。
 * 注意不能写成 `check().catch(...)`——谓词返回 null 时没有 `.catch`，会立刻 TypeError。
 */
async function waitFor(check, { timeout = 15000, interval = 100, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await Promise.resolve()
      .then(() => check())
      .catch(() => null);
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`等待超时（${timeout}ms）：${label}`);
    await new Promise((settle) => setTimeout(settle, interval));
  }
}

/** HTTP 探测。 */
async function probe(url) {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    return response.status < 500;
  } catch {
    return false;
  }
}

/** 端口是否可连（占用 = true）。 */
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

/** 找空闲端口。 */
async function freePort(start) {
  for (let port = start; port < start + 60; port += 1) {
    if (!(await portBusy(port))) return port;
  }
  throw new Error('找不到空闲端口');
}

/** 缓存的 Chromium（研究 #5：playwright-core 需显式 executablePath）。 */
/** Chromium 解析（实现回抽到 `lib/browser-toolchain.mjs`，复核 J8）。 */
const resolveChrome = resolveChromeExecutable;

/** 起了「独立进程组」的子进程 pid（pnpm → next dev 这类多跳链：整组信号才不漏孙进程）。 */
const groupLeaderPids = new Set();

/** 给子进程发信号：独立进程组整组发（`-pid`），否则只发它自己；已退出则忽略。 */
function signalChild(child, signal) {
  try {
    if (child.pid !== undefined && groupLeaderPids.has(child.pid)) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // 已退出 / 组内已空
  }
}

/** 起子进程（收集输出便于诊断）。 */
function startProcess(command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, {
    cwd: options.cwd ?? REPO_ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    // 多跳链（`pnpm … exec next dev`）必须成「独立进程组」：只 SIGTERM 直接子进程时，
    // 孙进程（真 dev server）可能在父进程退出后仍活着（实测退出瞬间仍可见残留 1–2 个）。
    detached: options.detached === true,
  });
  if (options.detached === true && child.pid !== undefined) groupLeaderPids.add(child.pid);
  let buffer = '';
  const collect = (chunk) => {
    buffer += chunk.toString();
    if (verbose) process.stdout.write(`    | ${chunk.toString().trimEnd()}\n`);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  if (verbose) {
    child.on('error', (error) => process.stderr.write(`    ! spawn error: ${String(error)}\n`));
    child.on('exit', (code, signal) =>
      process.stderr.write(`    ! exit code=${String(code)} signal=${String(signal)}\n`),
    );
  }
  return { child, output: () => buffer };
}

/**
 * 等「独立进程组」彻底空。
 *
 * 为什么需要：多跳链里的孙进程（`pnpm → next dev`）不是本进程的子进程，`wait()` 管不到——
 * 只等到直接子进程退出（pnpm）就返回时，dev server 还在自己收尾（实测退出瞬间仍可见 1–2 个
 * next 进程，数秒后才消失）。此处按进程组存活轮询（`kill(-pgid, 0)`），超时再整组 SIGKILL。
 */
async function awaitGroupGone(pgid, timeoutMs) {
  const isAlive = () => {
    try {
      process.kill(-pgid, 0);
      return true;
    } catch {
      return false; // ESRCH：组内已无活进程
    }
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive()) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    // 组内已空
  }
  await new Promise((done) => setTimeout(done, 200));
  return !isAlive();
}

/** 释放子进程与临时目录（`finish` 的唯一出口必须先走这里，否则进程泄漏）。 */
async function release() {
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch {
      // 忽略清理失败
    }
  }
  await browser?.close().catch(() => undefined);
  browser = null;
  const running = [...children];
  for (const child of running) signalChild(child, 'SIGTERM');
  await Promise.all(
    running.map(
      (child) =>
        new Promise((done) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            done();
            return;
          }
          const timer = setTimeout(() => {
            signalChild(child, 'SIGKILL');
            done();
          }, 5000);
          child.on('exit', () => {
            clearTimeout(timer);
            done();
          });
        }),
    ),
  );
  // 独立进程组的孙进程不受 wait() 管辖：轮询到组空才算清干净（否则退出瞬间仍有残留）。
  for (const pgid of groupLeaderPids) {
    if (!(await awaitGroupGone(pgid, 5000))) {
      notes.push(`清理告警：进程组 ${String(pgid)} 仍有存活进程（已补 SIGKILL）。`);
    }
  }
  if (workspaceDir !== undefined) {
    await rm(workspaceDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(
      () => undefined,
    );
  }
  if (dataRootDir !== undefined) {
    await rm(dataRootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(
      () => undefined,
    );
  }
}

/** 幂等准备 CanvasKit 资产。 */
function ensureAssets() {
  const script = join(WEB_APP_DIR, 'src/features/canvas/tools/copy-canvaskit-assets.mjs');
  const output = execFileSync(process.execPath, [script], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (verbose) console.log(`  · ${output.trim()}`);
}

/** 起 daemon（未外部指定时，用临时工作目录）。 */
async function ensureDaemon(webPort) {
  if (daemonUrl !== undefined) {
    if (!(await probe(`${daemonUrl}/health`))) {
      return finish(2, `阻塞：外部 daemon 不可达（${daemonUrl}/health）`);
    }
    notes.push('外部 daemon：其 CORS 白名单未由本脚本配置，页面请求走路由转发（Node 侧）。');
    return;
  }
  const origins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    ...(webPort === null ? [] : [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`]),
  ].join(',');
  // 临时目录纪律（禁 /tmp）：数据根/工作目录一律落仓外证据目录，release 时随临时目录一起清
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  workspaceDir = await mkdtemp(join(EVIDENCE_DIR, 'ws-'));
  dataRootDir = await mkdtemp(join(EVIDENCE_DIR, 'data-'));
  // 端口纪律：远离 3000（Next 缺省）与 4318（daemon 缺省端口窗起点），扫描段整体上移
  const port = await freePort(14318);
  const started = startProcess(process.execPath, [join(REPO_ROOT, 'apps/daemon/src/main.ts')], {
    env: {
      DF_WORKSPACE_DIR: workspaceDir,
      DF_DATA_ROOT: dataRootDir,
      DF_PORT: String(port),
      DF_HOST: '127.0.0.1',
      // 受控 CORS：只放行本次站点来源（daemon 默认白名单不含随机端口）
      DFORGE_CORS_ORIGINS: origins,
    },
  });
  daemonProcess = track(started.child);
  const url = await waitFor(
    () => {
      const match = started.output().match(/\[daemon\] listening on (http:\/\/[^\s]+)/);
      return match === null ? null : match[1];
    },
    { timeout: 25000, label: 'daemon 启动' },
  ).catch(() => null);
  if (url === null) {
    return finish(2, `阻塞：daemon 未能启动（输出尾部：${started.output().slice(-400)}）`);
  }
  daemonUrl = url;
}

/**
 * 起 Web 站点（未外部指定时：**生产构建 + `next start`**）。
 *
 * 为什么不用 `next dev`（仓库纪律，implementation-workflow.md「门禁清单」）：Next 16 Turbopack
 * dev 源在本机不加载客户端引导件（槽位挂不上，整树停在 SSR 空槽），断言会以「看不见入口」假红。
 * 生产构建前 CanvasKit 资产必须已就位（`main` 里 `ensureAssets` 先行），否则站点起来也是
 * 「Skia 初始化失败」的假红/假绿。
 */
async function ensureWeb(plannedPort) {
  if (webUrl !== undefined) {
    if (!(await probe(`${webUrl}/_canvas`))) {
      return finish(2, `阻塞：站点不可达（${webUrl}/_canvas）`);
    }
    return;
  }
  const port = plannedPort ?? (await freePort(3226));
  const nextBin = join(WEB_APP_DIR, 'node_modules', '.bin', 'next');
  if (!existsSync(nextBin)) {
    return finish(2, '阻塞：未找到 next 可执行文件（先 pnpm install）');
  }
  // ① 生产构建（构建失败属「前置不成立」→ exit 2，不得带病起站点）
  const build = startProcess(nextBin, ['build'], { cwd: WEB_APP_DIR });
  track(build.child);
  const buildCode = await new Promise((settle) => {
    if (build.child.exitCode !== null) {
      settle(build.child.exitCode);
      return;
    }
    const timer = setTimeout(() => settle(-1), 600_000);
    build.child.on('exit', (code) => {
      clearTimeout(timer);
      settle(code ?? -1);
    });
  });
  if (buildCode !== 0) {
    return finish(
      2,
      `阻塞：web 生产构建失败（exit ${String(buildCode)}；输出尾部：${build.output().slice(-600)}）`,
    );
  }
  // ② 起生产服务（显式端口，远离 3000/4318）
  const started = startProcess(nextBin, ['start', '-p', String(port)], { cwd: WEB_APP_DIR });
  track(started.child);
  webUrl = `http://127.0.0.1:${port}`;
  const ready = await waitFor(() => probe(`${webUrl}/_canvas`), {
    timeout: 120000,
    interval: 500,
    label: 'next start 就绪',
  })
    .then(() => true)
    .catch(() => false);
  if (!ready) {
    return finish(2, `阻塞：站点未能启动（输出尾部：${started.output().slice(-400)}）`);
  }
}

/** 页面里的 daemon 请求 → Node 侧转发（绕开浏览器 CORS；实现见 `lib/browser-toolchain.mjs`）。 */
async function routeDaemon(page) {
  await forwardDaemonRequests(page, daemonUrl, DAEMON_PREFIX);
}

/** 主流程。 */
async function main() {
  ensureAssets();
  const chrome = resolveChrome();
  if (chrome === undefined) {
    await finish(2, '阻塞：未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）');
  }
  // 站点端口先定：daemon 的 CORS 白名单要按真实站点来源配置（真实跨源，不靠转发）
  const plannedWebPort = webUrl === undefined ? await freePort(3226) : null;
  await ensureDaemon(plannedWebPort);
  await ensureWeb(plannedWebPort);

  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    deviceScaleFactor: VIEWPORT.dpr,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) {
      consoleErrors.push(message.text());
    }
  });
  const useProxy = daemonProcess === undefined;
  if (useProxy) await routeDaemon(page);

  const daemonBase = useProxy ? DAEMON_PREFIX : daemonUrl;
  const canvasUrl = `${webUrl}/_canvas?daemon=${encodeURIComponent(daemonBase)}`;
  // 首屏放宽到 120s：next dev 首次编译 + 7MB wasm 冷启动在 CI/本机都可能超过默认 30s
  await page.goto(canvasUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('canvas[data-df-canvas]', { timeout: 60_000 });

  const api = makeApi(page);

  // --- 断言 ①：canvas 元素挂载且 Skia 初始化成功 ---
  await waitFor(
    () =>
      page.evaluate(() => {
        const runtime = globalThis.__dforgeCanvas?.runtime();
        return (
          runtime !== undefined && runtime.canvasKit === 'ready' && runtime.fonts !== 'loading'
        );
      }),
    { timeout: 90000, interval: 200, label: 'CanvasKit 与字体就绪' },
  ).catch(() => null);
  const runtimeState = await api.runtime();
  const canvasCount = await page.locator('canvas[data-df-canvas]').count();
  record(
    assertions,
    'A1-canvas-mounted-skia-ready',
    canvasCount === 1 && runtimeState.canvasKit === 'ready' && runtimeState.fonts === 'ready',
    {
      canvasElements: canvasCount,
      canvasKit: runtimeState.canvasKit,
      fonts: runtimeState.fonts,
      dpr: runtimeState.dpr,
      error: runtimeState.error,
    },
  );

  // --- 断言 ②：首帧渲染完成（帧计数 ≥1） ---
  await waitFor(
    () => page.evaluate(() => (globalThis.__dforgeCanvas?.runtime().frameCount ?? 0) >= 1),
    {
      timeout: 30000,
      interval: 100,
      label: '首帧',
    },
  ).catch(() => null);
  const firstFrame = await api.runtime();
  const firstStats = await api.stats();
  record(
    assertions,
    'A2-first-frame',
    firstFrame.firstFrame === true &&
      firstFrame.frameCount >= 1 &&
      (firstStats?.nodesDrawn ?? 0) >= 1,
    {
      frameCount: firstFrame.frameCount,
      nodesDrawn: firstStats?.nodesDrawn ?? 0,
      rulers: firstStats?.rulers ?? false,
      dpr: firstStats?.devicePixelRatio ?? 0,
      canvasCssSize: firstStats?.canvasCssSize ?? null,
    },
  );

  // 夹具：样例文档的第一个顶层节点
  await api.setSnap(false);
  const rectId = (await api.nodeIds())[0];
  if (rectId === undefined) throw new Error('夹具异常：样例文档没有顶层节点');
  const rect0 = await api.geometry(rectId);
  const centerWorld = { x: rect0.x + rect0.width / 2, y: rect0.y + rect0.height / 2 };

  // --- 断言 ③：点选命中并高亮 ---
  const centerPoint = await api.toPage(centerWorld);
  await page.mouse.click(centerPoint.x, centerPoint.y);
  await page.waitForTimeout(150);
  const picked = await api.selection();
  const pickedStats = await api.stats();
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const hitShotPath = join(ARTIFACTS_DIR, `hit-${stamp}.png`);
  const hitShot = await page.locator('canvas[data-df-canvas]').screenshot({
    path: hitShotPath,
    animations: 'disabled',
  });
  const accent = await countAccentPixels(hitShot);
  record(
    assertions,
    'A3-click-select-highlight',
    picked.length === 1 &&
      picked[0] === rectId &&
      (pickedStats?.selectionOutlines ?? 0) >= 1 &&
      (pickedStats?.handles ?? 0) === 8 &&
      accent.pixels > 0,
    {
      selection: picked,
      selectionOutlines: pickedStats?.selectionOutlines ?? 0,
      handles: pickedStats?.handles ?? 0,
      accentPixels: accent.pixels,
      screenshot: fingerprint(hitShotPath),
    },
  );

  // --- 断言 ④：拖动改变节点 transform（拖动中文档不变） ---
  const beforeDrag = await api.geometry(rectId);
  const dragFrom = await api.toPage({
    x: beforeDrag.x + beforeDrag.width / 2,
    y: beforeDrag.y + beforeDrag.height / 2,
  });
  await page.mouse.move(dragFrom.x, dragFrom.y);
  await page.mouse.down();
  await page.mouse.move(dragFrom.x + 30, dragFrom.y + 20, { steps: 4 });
  await page.waitForTimeout(80);
  const duringDrag = await api.geometry(rectId);
  const hudDuringDrag = await api.hud();
  await page.mouse.move(dragFrom.x + 90, dragFrom.y + 60, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const afterDrag = await api.geometry(rectId);
  record(
    assertions,
    'A4-drag-changes-transform',
    afterDrag.x === beforeDrag.x + 90 &&
      afterDrag.y === beforeDrag.y + 60 &&
      duringDrag.x === beforeDrag.x &&
      hudDuringDrag !== null,
    {
      before: { x: beforeDrag.x, y: beforeDrag.y },
      documentDuringDrag: { x: duringDrag.x, y: duringDrag.y },
      after: { x: afterDrag.x, y: afterDrag.y },
      hudDuringDrag,
    },
  );

  // --- 断言 ⑤：滚轮缩放改变视口 ---
  const viewportBefore = await api.viewport();
  const wheelPoint = await api.toPage({
    x: afterDrag.x + afterDrag.width / 2,
    y: afterDrag.y + afterDrag.height / 2,
  });
  await page.mouse.move(wheelPoint.x, wheelPoint.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  await page.waitForTimeout(150);
  const viewportAfterWheel = await api.viewport();
  record(
    assertions,
    'A5-wheel-zoom-viewport',
    viewportAfterWheel.zoom > viewportBefore.zoom * 1.05,
    { before: viewportBefore, after: viewportAfterWheel },
  );
  await page.evaluate(() => globalThis.__dforgeCanvas.setViewport({ zoom: 1, panX: 80, panY: 60 }));
  await page.waitForTimeout(100);

  // --- 断言 ⑥：保存 → 重载 → 恢复（持久化往返） ---
  const beforeSave = await api.geometry(rectId);
  await page.click('[data-df-studio-action="save"]');
  const documentId = await waitFor(
    () => page.evaluate(() => globalThis.__dforgeCanvas.documentId()),
    {
      timeout: 30000,
      interval: 200,
      label: '保存到 daemon',
    },
  ).catch(() => null);
  const saveNotice =
    documentId === null
      ? await page
          .locator('[data-df-studio-notice]')
          .textContent()
          .catch(() => null)
      : null;
  const reloadUrl = `${canvasUrl}&doc=${encodeURIComponent(documentId ?? '')}`;
  await page.goto(reloadUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('canvas[data-df-canvas]', { timeout: 60_000 });
  // 等「持久化后的几何」真的回来（只等 documentId 会被样例文档的初始状态蒙混过关）
  await waitFor(
    () =>
      page.evaluate(
        ([id, x, y]) => {
          const node = globalThis.__dforgeCanvas.geometry(id);
          return node !== null && node.x === x && node.y === y ? node : null;
        },
        [rectId, beforeSave.x, beforeSave.y],
      ),
    { timeout: 45000, interval: 200, label: '重载后节点恢复' },
  ).catch(() => null);
  await api.setSnap(false);
  const afterReload = await api.geometry(rectId);
  record(
    assertions,
    'A6-save-reload-restore',
    documentId !== null &&
      afterReload !== null &&
      afterReload.x === beforeSave.x &&
      afterReload.y === beforeSave.y &&
      afterReload.width === beforeSave.width,
    {
      documentId,
      saveNotice,
      beforeSave: { x: beforeSave.x, y: beforeSave.y, width: beforeSave.width },
      afterReload:
        afterReload === null
          ? null
          : { x: afterReload.x, y: afterReload.y, width: afterReload.width },
    },
  );

  // --- 白名单 13 类 + C9/C11 外观（真实事件驱动） ---
  await runWiring(page, api);

  // --- 四回归场景（票 16 · 报告 §E1-E4） ---
  await runRegressions(page, api, { canvasUrl, proxyDaemon: useProxy, daemonUrl });

  // 控制台无未预期错误（渲染/接线健康度）
  const meaningfulErrors = consoleErrors.filter(
    (text) => !text.includes('favicon') && !text.includes('Download the React DevTools'),
  );
  if (meaningfulErrors.length > 0) {
    notes.push(
      `浏览器控制台错误 ${meaningfulErrors.length} 条：${meaningfulErrors.slice(0, 5).join(' | ')}`,
    );
  }

  // 主题守卫：C8 属深色族，浅色取样 = 错基准（验收标准 §3）——先于一切截图判定记账
  const observedTheme = await page
    .evaluate(() => document.documentElement.dataset.theme ?? null)
    .catch(() => null);
  record(assertions, 'A7-c8-theme-dark', observedTheme === SCREENSHOT_THEME, {
    expected: SCREENSHOT_THEME,
    observed: observedTheme,
  });

  const failures = assertions.filter((item) => item.ok !== true);
  const wiringFailures = wiring.filter((item) => item.ok !== true);

  // --- 截图对照段（无参照集 → exit 2） ---
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const actualPath = join(ARTIFACTS_DIR, `${SCREENSHOT_UNIT}-${stamp}.png`);
  const screenshotUrl = documentId === null ? canvasUrl : reloadUrl;
  const screenshotError = await takeScreenshot(chrome, screenshotUrl, actualPath).catch((error) =>
    String(error),
  );
  if (screenshotError !== undefined) {
    notes.push(`截图段取样失败：${screenshotError}`);
  }
  const actualArtifacts = existsSync(actualPath) ? { actual: fingerprint(actualPath) } : {};

  if (failures.length > 0 || wiringFailures.length > 0) {
    evidence.screenshot = { ...evidence.screenshot, status: 'skipped', artifacts: actualArtifacts };
    notes.push(
      `功能断言失败：挂载/回归 ${failures.map((item) => item.id).join(',') || '无'}；接线 ${wiringFailures.map((item) => item.id).join(',') || '无'}`,
    );
    evidence.diff = {
      bbox: null,
      diffPixels: null,
      ratio: null,
      note: '功能断言未通过：截图对照段未执行（无像素比对结论）',
    };
    await finish(
      1,
      `违规：挂载/回归断言失败 ${failures.length} 条、接线断言失败 ${wiringFailures.length} 条（明细见证据 JSON）。`,
    );
  }

  const refPath = join(REF_DIR, `${SCREENSHOT_UNIT}.png`);
  const referenceReady = existsSync(refPath) && existsSync(actualPath);
  if (!referenceReady) {
    evidence.screenshot = {
      unit: SCREENSHOT_UNIT,
      status: 'blocked',
      reason: !existsSync(actualPath)
        ? `实际截图缺失（取样失败：${screenshotError ?? '未知'}）`
        : existsSync(REF_DIR)
          ? `参照图缺失：${refPath}`
          : `参照集目录不存在：${REF_DIR}`,
      reference: refPath,
      diff: null,
      artifacts: actualArtifacts,
    };
    notes.push(
      '阻塞：REF-01 未完成（C8 画布参照集未冻结）——截图对照段无结论；实际截图仅供人工预览。',
    );
    evidence.diff = {
      bbox: null,
      diffPixels: null,
      ratio: null,
      note: `参照集未冻结（REF-01 未完成）：无像素比对。原因：${evidence.screenshot.reason}`,
    };
    await finish(
      2,
      [
        '阻塞：参照集未冻结（REF-01 未完成）——该段不能出结论。',
        `原因：${evidence.screenshot.reason}`,
        `实际截图已落盘：${actualPath}（仅供人工预览，不得当判据）。`,
        `功能断言结论：挂载 6 断言 + 接线 ${wiring.length} 条 + 四回归场景全部通过（证据见 JSON）。`,
      ].join('\n'),
    );
  }

  const pixelmatch = (await import('pixelmatch')).default;
  const { PNG } = await import('pngjs');
  const refPng = PNG.sync.read(readFileSync(refPath));
  const actualPng = PNG.sync.read(readFileSync(actualPath));
  if (refPng.width !== actualPng.width || refPng.height !== actualPng.height) {
    evidence.diff = {
      bbox: null,
      diffPixels: null,
      ratio: null,
      note: `截图尺寸不一致（参照 ${refPng.width}×${refPng.height} vs 实际 ${actualPng.width}×${actualPng.height}）：无像素比对结论`,
    };
    await finish(
      1,
      `违规：截图尺寸不一致（参照 ${refPng.width}×${refPng.height} vs 实际 ${actualPng.width}×${actualPng.height}）。`,
    );
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
  const diffBbox = bboxOfDiff(diffPng);
  const diffPath = join(ARTIFACTS_DIR, `${SCREENSHOT_UNIT}-diff-${stamp}.png`);
  writeFileSync(diffPath, PNG.sync.write(diffPng));
  evidence.screenshot = {
    unit: SCREENSHOT_UNIT,
    status: ratio <= MAX_RATIO ? 'pass' : 'fail',
    diff: {
      diffPixels,
      totalPixels: total,
      ratio: Number(ratio.toFixed(6)),
      bbox: diffBbox,
    },
    reference: refPath,
    artifacts: {
      ref: fingerprint(refPath),
      actual: fingerprint(actualPath),
      diff: fingerprint(diffPath),
    },
  };
  // 顶层摘要（验收标准 §4 字段族）：与截图段同源，便于消费方按统一路径读取。
  evidence.diff = {
    bbox: diffBbox,
    diffPixels,
    ratio: Number(ratio.toFixed(6)),
    note: `与冻结参照 ${SCREENSHOT_UNIT} 逐像素比对（pixelmatch threshold=${THRESHOLD}，容差 ${MAX_RATIO}）`,
  };
  if (ratio > MAX_RATIO) {
    await finish(
      1,
      `违规：C8 对标页差异率 ${(ratio * 100).toFixed(4)}% 超容差（≤ ${(MAX_RATIO * 100).toFixed(2)}%）。`,
    );
  }
  await finish(
    0,
    '通过：挂载 6 断言 + 白名单 13 类接线 + C9/C11 外观 + 四回归场景 + 截图对照全部通过。',
  );
}

/** 页面 API 包装（调试句柄 + 坐标换算）。 */
function makeApi(page) {
  const handle = (fn, ...args) => page.evaluate(fn, ...args);
  return {
    runtime: () => handle(() => globalThis.__dforgeCanvas.runtime()),
    stats: () => handle(() => globalThis.__dforgeCanvas.stats()),
    geometry: (id) => handle((nodeId) => globalThis.__dforgeCanvas.geometry(nodeId), id),
    nodeIds: () => handle(() => globalThis.__dforgeCanvas.nodeIds()),
    viewport: () => handle(() => globalThis.__dforgeCanvas.viewport()),
    selection: () => handle(() => globalThis.__dforgeCanvas.selection()),
    nodeCount: () => handle(() => globalThis.__dforgeCanvas.nodeCount()),
    hud: () => handle(() => globalThis.__dforgeCanvas.hud()),
    documentId: () => handle(() => globalThis.__dforgeCanvas.documentId()),
    textContent: (id) => handle((nodeId) => globalThis.__dforgeCanvas.textContent(nodeId), id),
    setSnap: (enabled) => handle((value) => globalThis.__dforgeCanvas.setSnap(value), enabled),
    select: (ids) => handle((value) => globalThis.__dforgeCanvas.select(value), ids),
    addToSelection: (id) =>
      handle((value) => globalThis.__dforgeCanvas.session().addNodeToSelection(value), id),
    setSelection: (ids) =>
      handle((value) => globalThis.__dforgeCanvas.session().setSelection(value), ids),
    createRect: (bounds) => handle((value) => globalThis.__dforgeCanvas.createRect(value), bounds),
    createTextAt: (point) =>
      handle((value) => globalThis.__dforgeCanvas.session().createTextAt(value), point),
    centerOf: async (id) => {
      const node = await handle((nodeId) => globalThis.__dforgeCanvas.geometry(nodeId), id);
      if (node === null) throw new Error(`节点不存在：${id}`);
      return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    },
    toPage: async (world) => {
      const box = await page.locator('canvas[data-df-canvas]').boundingBox();
      const viewport = await handle(() => globalThis.__dforgeCanvas.viewport());
      return {
        x: box.x + world.x * viewport.zoom + viewport.panX,
        y: box.y + world.y * viewport.zoom + viewport.panY,
      };
    },
  };
}

/** 白名单 13 类 + C9/C11 外观断言。 */
async function runWiring(page, api) {
  const report = (id, ok, detail) => record(wiring, id, ok, detail);

  await api.setSnap(false);
  // 清空选择（点空白）
  const blank = await api.toPage({ x: 1000, y: 700 });
  await page.mouse.click(blank.x, blank.y);

  // 1) 选择：点选 / Shift 加选 / 框选
  const rectId = (await api.nodeIds())[0];
  const secondId = await api.createRect({ x: 520, y: 320, width: 120, height: 90 });
  const rectCenter = await api.centerOf(rectId);
  const rectPoint = await api.toPage(rectCenter);
  await page.mouse.click(rectPoint.x, rectPoint.y);
  const clickSelected = await api.selection();
  const secondCenter = await api.centerOf(secondId);
  const secondPoint = await api.toPage(secondCenter);
  await page.keyboard.down('Shift');
  await page.mouse.click(secondPoint.x, secondPoint.y);
  await page.keyboard.up('Shift');
  const shiftSelected = await api.selection();
  report('W1-选择（点选/Shift 加选）', clickSelected.length === 1 && shiftSelected.length === 2, {
    clickSelected,
    shiftSelected,
  });

  const marqueeFrom = await api.toPage({ x: 60, y: 60 });
  const marqueeTo = await api.toPage({ x: 760, y: 560 });
  await page.mouse.move(marqueeFrom.x, marqueeFrom.y);
  await page.mouse.down();
  await page.mouse.move(marqueeTo.x, marqueeTo.y, { steps: 6 });
  await page.waitForTimeout(80);
  const marqueeDrawn = (await api.stats())?.marquee === true;
  await page.mouse.up();
  await page.waitForTimeout(120);
  const marqueeSelected = await api.selection();
  report('W1b-框选（矩形绘制与结算）', marqueeDrawn && marqueeSelected.length >= 2, {
    marqueeDrawn,
    marqueeSelected,
  });

  // 2) 移动（吸附关闭 → 精确位移）
  await api.select([rectId]);
  const moveBefore = await api.geometry(rectId);
  const moveFrom = await api.toPage({
    x: moveBefore.x + moveBefore.width / 2,
    y: moveBefore.y + moveBefore.height / 2,
  });
  await page.mouse.move(moveFrom.x, moveFrom.y);
  await page.mouse.down();
  await page.mouse.move(moveFrom.x + 40, moveFrom.y + 30, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const moveAfter = await api.geometry(rectId);
  report('W2-移动', moveAfter.x - moveBefore.x === 40 && moveAfter.y - moveBefore.y === 30, {
    dx: moveAfter.x - moveBefore.x,
    dy: moveAfter.y - moveBefore.y,
  });

  // 3) 缩放：8 手柄的 se
  await api.select([rectId]);
  const scaleBefore = await api.geometry(rectId);
  const seHandle = await api.toPage({
    x: scaleBefore.x + scaleBefore.width,
    y: scaleBefore.y + scaleBefore.height,
  });
  await page.mouse.move(seHandle.x, seHandle.y);
  await page.mouse.down();
  await page.mouse.move(seHandle.x + 60, seHandle.y + 40, { steps: 4 });
  await page.waitForTimeout(80);
  const handlesDuring = (await api.stats())?.handles ?? 0;
  await page.mouse.up();
  await page.waitForTimeout(120);
  const scaleAfter = await api.geometry(rectId);
  report(
    'W3-缩放（8 手柄：se 对侧不动）',
    handlesDuring === 8 &&
      scaleAfter.width === scaleBefore.width + 60 &&
      scaleAfter.height === scaleBefore.height + 40 &&
      scaleAfter.x === scaleBefore.x &&
      scaleAfter.y === scaleBefore.y,
    {
      size: [
        `${scaleBefore.width}x${scaleBefore.height}`,
        `${scaleAfter.width}x${scaleAfter.height}`,
      ],
      handlesDuring,
    },
  );

  // 4) 旋转：角外侧旋转区 + Shift 吸附 15°
  const rotateBefore = await api.geometry(rectId);
  const cornerOutside = await api.toPage({ x: rotateBefore.x - 12, y: rotateBefore.y - 12 });
  await page.mouse.move(cornerOutside.x, cornerOutside.y);
  await page.mouse.down();
  await page.mouse.move(cornerOutside.x + 150, cornerOutside.y + 60, { steps: 8 });
  await page.keyboard.down('Shift');
  await page.mouse.move(cornerOutside.x + 160, cornerOutside.y + 70, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(120);
  const rotateAfter = await api.geometry(rectId);
  report(
    'W4-旋转（角外侧区、Shift 吸附 15°）',
    rotateAfter.rotation !== rotateBefore.rotation && Math.abs(rotateAfter.rotation % 15) < 1e-6,
    { rotation: [rotateBefore.rotation, rotateAfter.rotation] },
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);

  // 5) 画布缩放（⌘= / ⌘0）
  const zoomBefore = await api.viewport();
  await page.keyboard.press('Control+=');
  await page.waitForTimeout(120);
  const zoomAfterKey = await api.viewport();
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(120);
  const zoomReset = await api.viewport();
  report(
    'W5-画布缩放（⌘+ / ⌘0）',
    zoomAfterKey.zoom > zoomBefore.zoom && Math.abs(zoomReset.zoom - 1) < 1e-6,
    { before: zoomBefore.zoom, afterKey: zoomAfterKey.zoom, reset: zoomReset.zoom },
  );

  // 6) 画布平移（中键拖拽 + 空格拖拽）
  const panBefore = await api.viewport();
  const panPoint = await api.toPage({ x: 400, y: 400 });
  await page.mouse.move(panPoint.x, panPoint.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(panPoint.x + 70, panPoint.y + 50, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(120);
  const panAfter = await api.viewport();
  await page.keyboard.down(' ');
  await page.mouse.move(panPoint.x, panPoint.y);
  await page.mouse.down();
  await page.mouse.move(panPoint.x - 30, panPoint.y - 20, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  await page.waitForTimeout(120);
  const panAfterSpace = await api.viewport();
  report(
    'W6-画布平移（中键 / 空格拖拽）',
    panAfter.panX - panBefore.panX === 70 && panAfterSpace.panX - panAfter.panX === -30,
    { panX: [panBefore.panX, panAfter.panX, panAfterSpace.panX] },
  );
  await page.evaluate(() => globalThis.__dforgeCanvas.setViewport({ zoom: 1, panX: 80, panY: 60 }));

  // 7) 复制粘贴（⌘C / ⌘V）
  await api.select([rectId]);
  const countBeforeClipboard = await api.nodeCount();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(250);
  const countAfterPaste = await api.nodeCount();
  report('W7-复制粘贴（⌘C / ⌘V）', countAfterPaste === countBeforeClipboard + 1, {
    before: countBeforeClipboard,
    after: countAfterPaste,
  });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);

  // 8) 层级（⌘] / ⇧⌘] / ⌘[ / ⇧⌘[）
  const orderBefore = await api.nodeIds();
  await api.select([orderBefore[0]]);
  await page.keyboard.press('Control+]');
  await page.waitForTimeout(100);
  const orderForward = await api.nodeIds();
  await page.keyboard.press('Control+Shift+]');
  await page.waitForTimeout(100);
  const orderFront = await api.nodeIds();
  await page.keyboard.press('Control+Shift+[');
  await page.waitForTimeout(100);
  const orderBack = await api.nodeIds();
  report(
    'W8-层级（⌘] / ⇧⌘] / ⇧⌘[）',
    orderForward[1] === orderBefore[0] &&
      orderFront[orderFront.length - 1] === orderBefore[0] &&
      orderBack[0] === orderBefore[0],
    { before: orderBefore[0], forward: orderForward, front: orderFront, back: orderBack },
  );
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);

  // 9) 编组 / 解组（⌘G / ⇧⌘G）
  const idsForGroup = await api.nodeIds();
  await api.select([idsForGroup[0], idsForGroup[1]]);
  await page.keyboard.press('Control+g');
  await page.waitForTimeout(150);
  const groupSelection = await api.selection();
  const groupGeometry = groupSelection.length === 1 ? await api.geometry(groupSelection[0]) : null;
  const childrenInGroup = groupGeometry?.type === 'group' ? 2 : 0;
  await page.keyboard.press('Control+Shift+g');
  await page.waitForTimeout(150);
  const afterUngroup = await api.nodeIds();
  report(
    'W9-编组/解组（⌘G / ⇧⌘G，世界形状不变）',
    groupGeometry?.type === 'group' &&
      childrenInGroup === 2 &&
      afterUngroup.length === idsForGroup.length,
    {
      groupType: groupGeometry?.type ?? null,
      childrenInGroup,
      afterUngroupCount: afterUngroup.length,
    },
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);

  // 10) 撤销 / 重做（⌘Z / ⇧⌘Z）
  await api.select([rectId]);
  const undoBase = await api.geometry(rectId);
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(120);
  const nudged = await api.geometry(rectId);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);
  const undone = await api.geometry(rectId);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(120);
  const redone = await api.geometry(rectId);
  report(
    'W10-撤销/重做（⌘Z / ⇧⌘Z，Shift+方向键微移 10px）',
    nudged.x === undoBase.x + 10 && undone.x === undoBase.x && redone.x === nudged.x,
    { base: undoBase.x, nudged: nudged.x, undone: undone.x, redone: redone.x },
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);

  // 11) 对齐 / 分布（C9 工具条真实按钮）
  const idsForAlign = await ensureTwoRectangles(page, api, rectId);
  await api.select([idsForAlign[0], idsForAlign[1]]);
  await page.waitForTimeout(120);
  const toolbarRadius = await page
    .locator('[data-df-canvas-toolbar]')
    .evaluate((element) => getComputedStyle(element).borderRadius)
    .catch(() => 'missing');
  await page.click('[data-df-canvas-action="alignLeft"]');
  await page.waitForTimeout(150);
  const lefts = [await api.geometry(idsForAlign[0]), await api.geometry(idsForAlign[1])];
  await page.evaluate((ids) => globalThis.__dforgeCanvas.session().setSelection(ids), idsForAlign);
  const thirdForDistribute = await api.createRect({ x: 300, y: 640, width: 80, height: 60 });
  await page.evaluate(
    ([a, b, c]) => globalThis.__dforgeCanvas.session().setSelection([a, b, c]),
    [idsForAlign[0], idsForAlign[1], thirdForDistribute],
  );
  await page.click('[data-df-canvas-action="distributeHorizontal"]');
  await page.waitForTimeout(150);
  const distributed = await Promise.all(
    [idsForAlign[0], idsForAlign[1], thirdForDistribute].map((id) => api.geometry(id)),
  );
  const sorted = [...distributed].sort((a, b) => a.x - b.x);
  const gap1 = sorted[1].x - (sorted[0].x + sorted[0].width);
  const gap2 = sorted[2].x - (sorted[1].x + sorted[1].width);
  report(
    'W11-对齐与分布（工具条按钮；C9 圆角 13 胶囊）',
    lefts[0].x === lefts[1].x && Math.abs(gap1 - gap2) < 1e-6 && toolbarRadius === '13px',
    { lefts: lefts.map((item) => item.x), gaps: [gap1, gap2], toolbarRadius },
  );
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);

  // 12) 吸附（6px 阈值：参考线出现 + 落点被吸到对齐位置）
  const snapIds = await ensureTwoRectangles(page, api, rectId);
  await api.select([snapIds[0]]);
  const snapTarget = await api.geometry(snapIds[1]);
  const snapSelf = await api.geometry(snapIds[0]);
  await api.setSnap(true);
  const pullFrom = await api.toPage({
    x: snapSelf.x + snapSelf.width / 2,
    y: snapSelf.y + snapSelf.height / 2,
  });
  const wantX = snapTarget.x + 3; // 目标：与参考对象左边缘差 3px（阈值内 → 应被吸到 0）
  const pullTo = await api.toPage({
    x: wantX + snapSelf.width / 2,
    y: snapSelf.y + snapSelf.height / 2,
  });
  await page.mouse.move(pullFrom.x, pullFrom.y);
  await page.mouse.down();
  await page.mouse.move(pullTo.x, pullTo.y, { steps: 5 });
  await page.waitForTimeout(150);
  const snapStats = await api.stats();
  const guides = (snapStats?.snapGuides ?? 0) + (snapStats?.measurements ?? 0);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const snapped = await api.geometry(snapIds[0]);
  await api.setSnap(false);
  report(
    'W12-吸附（阈值 6px、红色参考线与测量来自引擎）',
    guides > 0 && Math.abs(snapped.x - snapTarget.x) < 1e-6,
    { guidesAndMeasurements: guides, snappedX: snapped.x, targetX: snapTarget.x },
  );

  // 13) 文本内联编辑（双击进入 → 输入 → 失焦提交 → 撤销）
  const textId = await api.createTextAt({ x: 640, y: 520 });
  await page.waitForTimeout(150);
  const textPoint = await api.toPage({ x: 700, y: 530 });
  await page.mouse.dblclick(textPoint.x, textPoint.y);
  await page.waitForSelector('[data-df-text-overlay]', { timeout: 5000 }).catch(() => null);
  const overlayVisible = await page.locator('[data-df-text-overlay]').count();
  await page.keyboard.type('设界画布');
  await page.waitForTimeout(120);
  // 失焦提交：点画布空白
  const dismiss = await api.toPage({ x: 1000, y: 720 });
  await page.mouse.click(dismiss.x, dismiss.y);
  await page.waitForTimeout(200);
  const committed = await api.textContent(textId);
  await api.select([textId]);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  const restored = await api.textContent(textId);
  report(
    'W13-文本内联编辑（双击进入 / 失焦提交 / 撤销回退）',
    overlayVisible === 1 && committed === '设界画布' && restored === '',
    { overlayVisible, committed, restored },
  );

  // C11 右键菜单（条目 32 高 + 快捷键右对齐）
  await api.select([snapIds[0]]);
  const menuPoint = await api.toPage({ x: snapTarget.x + 10, y: snapTarget.y + 10 });
  await page.mouse.click(menuPoint.x, menuPoint.y, { button: 'right' });
  await page
    .waitForSelector('[data-df-canvas-context-menu] [role="menu"]', { timeout: 5000 })
    .catch(() => null);
  const menu = await page
    .locator('[data-df-canvas-context-menu] [role="menu"]')
    .evaluate((element) => {
      const items = [...element.querySelectorAll('[role="menuitem"]')];
      const first = items[0];
      const shortcut = first?.querySelector('.dfg-menu__shortcut');
      const label = first?.querySelector('.dfg-menu__label-text');
      return {
        items: items.length,
        itemHeight: first === undefined ? null : getComputedStyle(first).minHeight,
        hasShortcut: shortcut !== null && shortcut !== undefined,
        shortcutRightOfLabel:
          shortcut !== null && shortcut !== undefined && label !== null && label !== undefined
            ? shortcut.getBoundingClientRect().left > label.getBoundingClientRect().right
            : false,
        shortcutText: shortcut?.textContent ?? null,
      };
    })
    .catch(() => null);
  await page.keyboard.press('Escape');
  report(
    'W14-C11 右键菜单（条目 32 高 + 快捷键右对齐）',
    menu !== null &&
      menu.items > 0 &&
      menu.itemHeight === '32px' &&
      menu.hasShortcut &&
      menu.shortcutRightOfLabel,
    menu ?? 'menu-missing',
  );
}

/** 确保页面上至少有两个顶层矩形（上一步的撤销可能回退了新建）。 */
async function ensureTwoRectangles(_page, api, preferredId) {
  const ids = await api.nodeIds();
  const usable = [];
  for (const id of ids.slice(0, 8)) {
    const node = await api.geometry(id);
    if (node !== null && node.type === 'rect') usable.push(id);
  }
  if (usable.length >= 2) return [usable[0], usable[1]];
  if (usable.length === 1) {
    const created = await api.createRect({ x: 620, y: 300, width: 110, height: 80 });
    return [usable[0], created];
  }
  const first = (await api.geometry(preferredId)) ?? null;
  void first;
  const created = await api.createRect({ x: 200, y: 220, width: 140, height: 90 });
  const second = await api.createRect({ x: 620, y: 300, width: 110, height: 80 });
  return [created, second];
}

/**
 * 四回归场景（票 16 · 报告 §E1-E4——Node 级测试看不见、只有真浏览器能逮住的故障）。
 *
 * R2/R3/R4 打在主取样页上（真实指针/键盘事件 + 调试句柄读真实运行态）；
 * R1 需要一次**受控的加载失败**，另起独立浏览器上下文（干净 HTTP 缓存，abort 才可靠生效），
 * 但重试必须发生在**同一 JS realm**里走产品路径（会话换代重挂）——整页刷新不算恢复
 * （§E1 中毒路径的特征恰恰是「只有整页刷新能恢复」）。
 *
 * @param {import('playwright-core').Page} page 主取样页
 * @param {ReturnType<typeof makeApi>} api 页面 API 包装
 * @param {{ canvasUrl: string, proxyDaemon: boolean, daemonUrl: string }} options 主流程上下文
 */
async function runRegressions(page, api, options) {
  const { canvasUrl, proxyDaemon } = options;

  // --- R2（E4）：指针拖出画布松开 → 交互收口（节点不粘光标） ---
  await api.setViewport({ zoom: 1, panX: 80, panY: 60 });
  await api.setSnap(false);
  const r2Id = await api.createRect({ x: 940, y: 560, width: 120, height: 80 });
  const r2Start = await api.geometry(r2Id);
  const r2From = await api.toPage({ x: r2Start.x + 60, y: r2Start.y + 40 });
  await page.mouse.move(r2From.x, r2From.y);
  await page.mouse.down();
  await page.mouse.move(r2From.x + 40, r2From.y + 30, { steps: 4 });
  // 拖出画布表面再松开：松开点取宿主工具行按钮（画布壳之外的真实区域）
  const outsideBox = await page.locator('[data-df-studio-tool="select"]').boundingBox();
  if (outsideBox === null) throw new Error('R2 夹具异常：找不到画布壳之外的宿主工具按钮');
  await page.mouse.move(outsideBox.x + outsideBox.width / 2, outsideBox.y + outsideBox.height / 2, {
    steps: 4,
  });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const r2Interaction = await page.evaluate(() => {
    const state = globalThis.__dforgeCanvas.session().store.getState();
    return { interaction: state.interaction.kind, draft: state.draft !== null };
  });
  const r2Committed = await api.geometry(r2Id);
  // 节点不粘光标：松开后**无按键**移动鼠标横穿画布，节点必须纹丝不动
  await page.mouse.move(r2From.x, r2From.y, { steps: 6 });
  await page.mouse.move(r2From.x + 120, r2From.y + 60, { steps: 6 });
  await page.waitForTimeout(120);
  const r2AfterHover = await api.geometry(r2Id);
  record(
    assertions,
    'R2-pointer-release-outside-settles',
    r2Interaction.interaction === 'idle' &&
      r2Interaction.draft === false &&
      (r2Committed.x !== r2Start.x || r2Committed.y !== r2Start.y) &&
      r2AfterHover.x === r2Committed.x &&
      r2AfterHover.y === r2Committed.y,
    {
      interactionAfterRelease: r2Interaction,
      start: { x: r2Start.x, y: r2Start.y },
      committed: { x: r2Committed.x, y: r2Committed.y },
      afterHoverMove: { x: r2AfterHover.x, y: r2AfterHover.y },
    },
  );

  // --- R3（E2）：拖动节点松手 → 浮层工具条位置跟随（文档快照订阅驱动） ---
  await api.setViewport({ zoom: 1, panX: 80, panY: 60 });
  const r3Id = await api.createRect({ x: 700, y: 600, width: 120, height: 80 });
  await api.select([r3Id]);
  await page.waitForTimeout(120);
  const toolbarPos = () =>
    page
      .locator('[data-df-canvas-toolbar]')
      .evaluate((element) => ({
        left: Number.parseFloat(element.style.left),
        top: Number.parseFloat(element.style.top),
      }))
      .catch(() => null);
  const toolbarBefore = await toolbarPos();
  const r3 = await api.geometry(r3Id);
  const r3From = await api.toPage({ x: r3.x + 60, y: r3.y + 40 });
  await page.mouse.move(r3From.x, r3From.y);
  await page.mouse.down();
  await page.mouse.move(r3From.x + 50, r3From.y + 30, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const toolbarAfter = await toolbarPos();
  record(
    assertions,
    'R3-toolbar-follows-drag',
    toolbarBefore !== null &&
      toolbarAfter !== null &&
      Math.abs(toolbarAfter.left - toolbarBefore.left - 50) < 1e-6 &&
      Math.abs(toolbarAfter.top - toolbarBefore.top - 30) < 1e-6,
    {
      before: toolbarBefore,
      after: toolbarAfter,
      expectedDelta: { left: 50, top: 30 },
    },
  );

  // --- R4（E3）：焦点在按钮上，空格/Enter 归按钮原生激活（画布不劫持） ---
  const r4TextId = await api.createTextAt({ x: 420, y: 480 });
  await page.waitForTimeout(100);
  const toolState = () =>
    page.evaluate(() => {
      const state = globalThis.__dforgeCanvas.session().store.getState();
      return {
        tool: state.tool,
        spacePressed: state.spacePressed,
        editing: state.editing !== null,
      };
    });
  // 空格：焦点在工具按钮上按下 → 画布不得进平移预备；松开 → 按钮激活（切到手型工具）
  await page.locator('[data-df-studio-tool="hand"]').focus();
  await page.keyboard.down(' ');
  await page.waitForTimeout(80);
  const duringSpace = await toolState();
  await page.keyboard.up(' ');
  await page.waitForTimeout(150);
  const afterSpace = await toolState();
  // Enter：选中文本节点后焦点在按钮上按 Enter → 不得误触 editText；按钮激活（切回选择工具）
  await api.select([r4TextId]);
  await page.locator('[data-df-studio-tool="select"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const afterEnter = await toolState();
  record(
    assertions,
    'R4-activation-keys-reach-button',
    duringSpace.spacePressed === false &&
      afterSpace.tool === 'hand' &&
      afterEnter.editing === false &&
      afterEnter.tool === 'select',
    { duringSpace, afterSpace, afterEnter },
  );

  // --- R1（E1）：CanvasKit 脚本加载失败 → 标签即摘即净 → 重试成功（同一 realm） ---
  const browser = page.context().browser();
  if (browser === null) throw new Error('R1 夹具异常：拿不到浏览器实例');
  const r1Context = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
  });
  const r1Page = await r1Context.newPage();
  const r1Errors = [];
  r1Page.on('pageerror', (error) => r1Errors.push(String(error)));
  if (proxyDaemon) await routeDaemon(r1Page);
  try {
    // ① 注入失败：canvaskit.js 网络层 abort → boot 走 onerror（先证明「失败真的发生了」）
    await r1Page.route('**/canvaskit/canvaskit.js', (route) => route.abort());
    await r1Page.goto(canvasUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const failedBanner = await r1Page
      .waitForSelector('[data-df-canvas-status="error"]', { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    // ② 失败标签即摘即净：DOM 不留 data-df-canvaskit 残留（残留会让重试误判「已就绪」直接放行）
    const residualTags = await r1Page.evaluate(
      () => document.querySelectorAll('script[data-df-canvaskit]').length,
    );
    // ③ 产品路径重试：导入当前文档 → 会话换代 → 画布重挂 → loadCanvasKit 重试（失败不缓存）
    await r1Page.unroute('**/canvaskit/canvaskit.js');
    const retry = await r1Page.evaluate(async () => {
      const handle = globalThis.__dforgeCanvas;
      return handle.importIr(handle.exportIr());
    });
    const recovered = await r1Page
      .waitForFunction(
        () => {
          const runtime = globalThis.__dforgeCanvas?.runtime();
          return (
            runtime !== undefined &&
            runtime.canvasKit === 'ready' &&
            runtime.fonts === 'ready' &&
            (runtime.frameCount ?? 0) >= 1
          );
        },
        null,
        { timeout: 90_000 },
      )
      .then(() => true)
      .catch(() => false);
    const r1Runtime = await r1Page.evaluate(() => globalThis.__dforgeCanvas.runtime());
    const r1Stats = await r1Page.evaluate(() => globalThis.__dforgeCanvas.stats());
    record(
      assertions,
      'R1-canvaskit-fail-recover-retry',
      failedBanner && residualTags === 0 && retry?.ok === true && recovered,
      {
        failureObserved: failedBanner,
        residualScriptTags: residualTags,
        retry,
        recovered,
        canvasKit: r1Runtime?.canvasKit ?? null,
        fonts: r1Runtime?.fonts ?? null,
        frameCount: r1Runtime?.frameCount ?? null,
        nodesDrawn: r1Stats?.nodesDrawn ?? null,
        pageErrors: r1Errors.slice(0, 3),
      },
    );
  } finally {
    await r1Context.close().catch(() => undefined);
  }
}

/** 主色（令牌 primary #0D99FF）像素计数：证明「高亮真的画到画布上了」。 */
async function countAccentPixels(buffer) {
  const { PNG } = await import('pngjs');
  const png = PNG.sync.read(buffer);
  let pixels = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    const r = png.data[index];
    const g = png.data[index + 1];
    const b = png.data[index + 2];
    if (r < 90 && g > 110 && g < 210 && b > 200) pixels += 1;
  }
  return { pixels, width: png.width, height: png.height };
}

/** 独立浏览器重启取样（截图段用；避免与交互态耦合）。 */
async function takeScreenshot(chromePath, url, outPath) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
      deviceScaleFactor: VIEWPORT.dpr,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('favicon'))
        errors.push(message.text());
    });
    await routeDaemon(page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForSelector('canvas[data-df-canvas]', { timeout: 60_000 });
    try {
      // 空转页面只出一帧（循环只在有请求时重画）——等到「首帧已出」即可
      await page.waitForFunction(
        () => {
          const runtime = globalThis.__dforgeCanvas?.runtime();
          return (
            runtime !== undefined && runtime.canvasKit !== 'loading' && runtime.frameCount >= 1
          );
        },
        null,
        { timeout: 90000 },
      );
    } catch (error) {
      throw new Error(
        `帧未就绪（${String(error)}）；页面错误：${errors.slice(0, 3).join(' | ') || '无'}`,
      );
    }
    await page.evaluate(() => document.fonts.ready);
    mkdirSync(dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath, animations: 'disabled' });
  } finally {
    await browser.close();
  }
}

main()
  .then(async () => {
    await release();
  })
  .catch(async (error) => {
    notes.push(`未预期失败：${String(error)}`);
    console.error(`未预期失败：${String(error)}`);
    evidence.diff = {
      bbox: null,
      diffPixels: null,
      ratio: null,
      note: '门禁执行中断：无像素比对结论',
    };
    await finish(1, `违规：门禁执行中断（${String(error)}）`);
  });
