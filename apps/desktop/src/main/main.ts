/**
 * 桌面壳主进程入口（FE-12 最小壳）。
 *
 * 运行模式（argv 开关；门禁脚本靠这些模式取证，默认不带开关时是**正常交互壳**）：
 * - `--df-shell-smoke=<jsonPath>`：装载目标页 → 测安全基线与页面事实 → 写自检 JSON → 按判据退出 0/1；
 * - `--df-capture=<pngPath>`：配合冒烟模式，就绪后 `capturePage` 写 PNG（壳内截图证据）；
 * - `--df-baseline-probe`：**不开窗**只读一次运行时偏好，往 stdout 打印 JSON（守卫的运行时兜底）；
 * - `--df-dpr=<n>`：指定设备像素比（对照态 1.5，见验收标准 §3）。
 *
 * 安全面：窗口选项取自 `window-options.ts`（守卫静态断言该文件，勿在此就地放宽）；
 * 新窗口一律拒绝、页内导航按 `external-links.ts` 白名单判决，白名单外链转 `shell.openExternal`。
 * 多标签 / 托盘 / 更新通道等 15 项按《范围边界》A 区缓归 P6——本文件不得顺手长胖。
 */

import { mkdirSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, shell } from 'electron';

import { decideExternalOpen, decideInPageNavigation } from './external-links.js';
import { resolveLoadPlanFromDisk } from './load-target.js';
import { buildMenuTemplate } from './menu.js';
import { resolvePreloadPath } from './preload-path.js';
import {
  evaluateSelfCheck,
  splitSecurityFindings,
  type SecuritySnapshot,
  SHELL_SELF_CHECK_SCHEMA,
  type ShellBaselineProbeReport,
  type ShellSelfCheckReport,
} from './shell-selfcheck.js';
import { startCorsProbeServer, startStaticServer } from './static-server.js';
import { buildWindowOptions, WINDOW_SIZE } from './window-options.js';

/** 壳资源根：源码态（src/main/）与编译态（dist/main/）上溯两级都是 apps/desktop。 */
const SHELL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** 仓库根：壳再上溯两级。 */
const REPO_ROOT = join(SHELL_ROOT, '..', '..');
/** 自检硬超时：装载卡死或渲染进程崩掉时，冒烟段不能无限等。 */
const SELF_CHECK_TIMEOUT_MS = 30_000;
/** 截图前的稳定等待（字体/首帧落定）。 */
const CAPTURE_SETTLE_MS = 600;

/** 取 argv 里 `--name=value` 形式的值。 */
function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit?.slice(prefix.length);
}

const smokeReportPath = readArg('df-shell-smoke');
const capturePath = readArg('df-capture');
const probeMode = process.argv.includes('--df-baseline-probe');
const requestedDpr = Number(readArg('df-dpr') ?? Number.NaN);
const hasDpr = Number.isFinite(requestedDpr) && requestedDpr > 0;

/** 对照态的设备像素比必须先于 app ready 生效（Chromium 启动开关）。 */
if (hasDpr) {
  app.commandLine.appendSwitch('force-device-scale-factor', String(requestedDpr));
}

/** 往 stdout 同步写一行（进程随即退出，管道下不能依赖异步 flush）。 */
function writeStdout(line: string): void {
  writeSync(1, `${line}\n`);
}

/** 退出并带回退出码（`app.exit` 走优雅退出，随后 process.exit 兜底不吊死门禁）。 */
function finish(code: number): never {
  app.exit(code);
  process.exit(code);
}

/**
 * 运行时安全实测（Electron 44 无 `getLastWebPreferences`，故走「可观测事实」三条腿）：
 * 1) contextIsolation / sandbox —— preload 里的 `process.contextIsolated` / `process.sandboxed`（权威）；
 * 2) nodeIntegration —— 页面里能否看到 Node 全局（`require`/`process`/`module`）；
 * 3) webSecurity —— 跨源本地探针：页面 fetch 一个**不带 CORS 头**的本地端口，
 *    同源策略生效则必然失败（webSecurity=true），成功则说明 webSecurity 被关（违规）。
 * `allowRunningInsecureContent` 无可靠运行时观测 → 记 `null`（守卫据此退 2，绝不当作通过）。
 */
async function readSecuritySnapshot(
  window: BrowserWindow,
  page: {
    nodeGlobals: { require: boolean; process: boolean; module: boolean };
    contextIsolated: boolean | null;
    sandboxed: boolean | null;
  },
  probeOrigin: string,
): Promise<SecuritySnapshot> {
  const corsBypassed = (await window.webContents.executeJavaScript(
    `fetch(${JSON.stringify(`${probeOrigin}/no-cors-endpoint`)}).then(() => true).catch(() => false)`,
  )) as boolean;

  return {
    contextIsolation: page.contextIsolated,
    sandbox: page.sandboxed,
    nodeIntegration:
      page.nodeGlobals.require || page.nodeGlobals.process || page.nodeGlobals.module,
    webSecurity: corsBypassed !== true,
    allowRunningInsecureContent: null,
  };
}

/** 页面事实（在渲染进程内实测；只取与装载判据相关的字段）。 */
async function readPageSnapshot(window: BrowserWindow) {
  const raw = await window.webContents.executeJavaScript(
    `JSON.stringify({
      title: document.title,
      readyState: document.readyState,
      bodyChildren: document.body ? document.body.children.length : 0,
      marker: document.querySelector('[data-dforge-shell-fallback]')?.getAttribute('data-dforge-shell-fallback') ?? null,
      devicePixelRatio: window.devicePixelRatio,
      nodeGlobals: {
        require: typeof require !== 'undefined',
        process: typeof process !== 'undefined',
        module: typeof module !== 'undefined'
      },
      contextIsolated: (window.dforgeShell && window.dforgeShell.security) ? window.dforgeShell.security.contextIsolated : null,
      sandboxed: (window.dforgeShell && window.dforgeShell.security) ? window.dforgeShell.security.sandboxed : null
    })`,
  );
  return JSON.parse(raw) as PageProbe;
}

/** 页面实测结构（与上面的注入脚本一一对应）。 */
interface PageProbe {
  title: string;
  readyState: string;
  bodyChildren: number;
  marker: string | null;
  devicePixelRatio: number;
  nodeGlobals: { require: boolean; process: boolean; module: boolean };
  contextIsolated: boolean | null;
  sandboxed: boolean | null;
}

/**
 * 装载目标页：dev URL 直装；静态产物起**内置静态服务**装载（Next 导出资源是绝对路径，
 * file:// 会 404）；两者都没有则装壳内诊断页。
 */
async function loadTarget(window: BrowserWindow) {
  const plan = resolveLoadPlanFromDisk({ shellRoot: SHELL_ROOT, repoRoot: REPO_ROOT });

  if (plan.kind === 'dev-server') {
    await window.loadURL(plan.url);
    return { kind: plan.kind, url: window.webContents.getURL(), reason: plan.reason };
  }
  if (plan.kind === 'static-export') {
    const { origin } = await startStaticServer(plan.rootDir);
    await window.loadURL(`${origin}/`);
    return {
      kind: plan.kind,
      url: window.webContents.getURL(),
      reason: `${plan.reason} @ ${origin}`,
    };
  }

  await window.loadFile(join(SHELL_ROOT, 'resources', 'fallback.html'));
  return { kind: plan.kind, url: window.webContents.getURL(), reason: plan.reason };
}

/** 建壳窗口：选项全量来自 `buildWindowOptions`（守卫静态断言其 `webPreferences` 段）。 */
function createShellWindow(show: boolean): BrowserWindow {
  const window = new BrowserWindow(
    buildWindowOptions({ preloadPath: resolvePreloadPath(SHELL_ROOT) }),
  );

  // 新窗口一律拒绝：白名单内 https 外链转系统浏览器（票面硬口径）。
  window.webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideExternalOpen(url);
    if (decision.action === 'allow-external') {
      void shell.openExternal(decision.url);
    }
    return { action: 'deny' };
  });

  // 最小壳不承载 webview；出现即视为异常来源。
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  window.once('ready-to-show', () => {
    if (show) {
      window.show();
    }
  });

  return window;
}

/** 装载完成后挂页内导航守卫：同源放行，白名单外链转系统浏览器，其余拦下（见 `external-links.ts`）。 */
function attachNavigationGuard(window: BrowserWindow, targetUrl: string): void {
  window.webContents.on('will-navigate', (event, url) => {
    const decision = decideInPageNavigation(targetUrl, url);
    if (decision === 'allow') {
      return;
    }
    event.preventDefault();
    if (decision === 'open-external') {
      void shell.openExternal(url);
    }
  });
}

/**
 * 基线探针（守卫的运行时兜底）：不起业务窗口，装壳内诊断页（本地文件，离线可跑）后实测五顶。
 * 探针自带一个「不带 CORS 头」的本地端口做 webSecurity 的反证。
 */
async function runBaselineProbe(): Promise<never> {
  const window = createShellWindow(false);
  await window.loadFile(join(SHELL_ROOT, 'resources', 'fallback.html'));
  const probe = await startCorsProbeServer();
  try {
    const page = await readPageSnapshot(window);
    const security = await readSecuritySnapshot(window, page, probe.origin);
    const findings = splitSecurityFindings(security);
    const report: ShellBaselineProbeReport = {
      schema: SHELL_SELF_CHECK_SCHEMA,
      mode: 'probe',
      security,
    };
    writeStdout(`DFORGE_BASELINE_PROBE:${JSON.stringify({ ...report, ...findings })}`);
    // 0=五项全部实测且合规；1=实测到违规；2=有项测不到（无法结论，守卫按阻塞处理）
    if (findings.violations.length > 0) {
      return finish(1);
    }
    return finish(findings.undetermined.length > 0 ? 2 : 0);
  } finally {
    probe.server.close();
  }
}

/** 冒烟/截图模式：装载 → 测事实 → 写自检 JSON（+ 可选 PNG）→ 按判据退出。 */
async function runSmoke(reportPath: string, pngPath?: string): Promise<never> {
  const window = createShellWindow(Boolean(pngPath));
  const target = await loadTarget(window);
  attachNavigationGuard(window, target.url);

  if (pngPath) {
    await new Promise((resolve) => setTimeout(resolve, CAPTURE_SETTLE_MS));
    const image = await window.webContents.capturePage();
    mkdirSync(dirname(pngPath), { recursive: true });
    writeFileSync(pngPath, image.toPNG());
  }

  const page = await readPageSnapshot(window);
  const probe = await startCorsProbeServer();
  let security: SecuritySnapshot;
  try {
    security = await readSecuritySnapshot(window, page, probe.origin);
  } finally {
    probe.server.close();
  }

  const [contentWidth, contentHeight] = window.getContentSize();
  const report: ShellSelfCheckReport = {
    schema: SHELL_SELF_CHECK_SCHEMA,
    mode: pngPath ? 'capture' : 'smoke',
    target,
    window: {
      width: contentWidth ?? WINDOW_SIZE.width,
      height: contentHeight ?? WINDOW_SIZE.height,
      devicePixelRatio: page.devicePixelRatio,
    },
    security,
    page: {
      href: window.webContents.getURL(),
      title: page.title,
      readyState: page.readyState,
      bodyChildren: page.bodyChildren,
      marker: page.marker,
    },
  };

  const expectation = hasDpr
    ? {
        expectViewport: { width: WINDOW_SIZE.width, height: WINDOW_SIZE.height, dpr: requestedDpr },
      }
    : {};
  const failures = evaluateSelfCheck(report, expectation);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify({ ...report, failures }, null, 2)}\n`);
  writeStdout(`DFORGE_SHELL_SELFCHECK:${JSON.stringify({ ok: failures.length === 0, failures })}`);
  return finish(failures.length === 0 ? 0 : 1);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate()));

  const timeout = setTimeout(() => {
    process.stderr.write(`壳自检超时（${SELF_CHECK_TIMEOUT_MS}ms）：装载或渲染未完成\n`);
    finish(1);
  }, SELF_CHECK_TIMEOUT_MS);
  timeout.unref();

  try {
    if (probeMode) {
      await runBaselineProbe();
      return;
    }
    if (smokeReportPath) {
      await runSmoke(smokeReportPath, capturePath);
      return;
    }
    if (capturePath) {
      // 截图必须与冒烟报告同批产出（证据要能互相对上）；单独给 PNG 路径视为用法错误。
      process.stderr.write('用法错误：--df-capture 只能与 --df-shell-smoke 同用\n');
      finish(2);
      return;
    }

    // 正常交互壳：单窗口单工作区。
    const window = createShellWindow(true);
    const target = await loadTarget(window);
    attachNavigationGuard(window, target.url);
    app.on('window-all-closed', () => {
      app.quit();
    });
  } catch (error) {
    process.stderr.write(`壳启动失败：${String(error)}\n`);
    finish(1);
  }
});
