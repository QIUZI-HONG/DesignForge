/**
 * 桌面壳主进程入口（FE-12 最小壳）。
 *
 * 运行模式（argv 开关；门禁脚本靠这些模式取证，默认不带开关时是**正常交互壳**）：
 * - `--df-shell-smoke=<jsonPath>`：装载目标页 → 测安全基线与页面事实 → 写自检 JSON → 按判据退出 0/1；
 * - `--df-capture=<pngPath>`：配合冒烟模式，就绪后 `capturePage` 写 PNG（壳内截图证据）；
 * - `--df-baseline-probe`：**不开窗**只读一次运行时偏好，往 stdout 打印 JSON（守卫的运行时兜底）；
 * - `--df-dpr=<n>`：指定设备像素比（对照态 1.5，见验收标准 §3）。
 *
 * 模式判定与自检硬超时的武装判据在 `run-mode.ts`（纯函数，单测钉死）：**硬超时只对自检类运行
 * （probe/smoke）武装**——交互壳要长期存活，被兜底计时器扫到就是误杀（D-8 / UX-04）。
 *
 * 安全面：窗口选项取自 `window-options.ts`（守卫静态断言该文件，勿在此就地放宽）；
 * 新窗口一律拒绝、页内导航按 `external-links.ts` 白名单判决，白名单外链转 `shell.openExternal`。
 * 多标签 / 托盘 / 更新通道等 15 项按《范围边界》A 区缓归 P6——本文件不得顺手长胖。
 */

import { mkdirSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, type NativeImage, shell } from 'electron';

import { decideExternalOpen, decideInPageNavigation } from './external-links.js';
import { resolveLoadPlanFromDisk } from './load-target.js';
import { buildMenuTemplate } from './menu.js';
import { resolvePreloadPath } from './preload-path.js';
import {
  armsSelfCheckTimeout,
  readArg,
  resolveRunMode,
  SELF_CHECK_TIMEOUT_MS,
} from './run-mode.js';
import {
  evaluateSelfCheck,
  type SecuritySnapshot,
  SHELL_SELF_CHECK_SCHEMA,
  type ShellBaselineProbeReport,
  type ShellSelfCheckReport,
  splitSecurityFindings,
} from './shell-selfcheck.js';
import { startCorsProbeServer, startStaticServer } from './static-server.js';
import { buildWindowOptions, WINDOW_SIZE } from './window-options.js';

/** 壳资源根：源码态（src/main/）与编译态（dist/main/）上溯两级都是 apps/desktop。 */
const SHELL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** 仓库根：壳再上溯两级。 */
const REPO_ROOT = join(SHELL_ROOT, '..', '..');
/** 截图前的稳定等待（字体/首帧落定）。 */
const CAPTURE_SETTLE_MS = 600;

/** 运行模式与自检超时判据（纯函数层，见 `run-mode.ts`；与门禁/单测同一份口径）。 */
const runMode = resolveRunMode(process.argv);
const requestedDpr = Number(readArg(process.argv, 'df-dpr') ?? Number.NaN);
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
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
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
  innerWidth: number;
  innerHeight: number;
  nodeGlobals: { require: boolean; process: boolean; module: boolean };
  contextIsolated: boolean | null;
  sandboxed: boolean | null;
}

/**
 * 把**页面视口**校正到基准尺寸。
 *
 * 为什么需要：合成器按物理像素取整（本机 WSLg + `force-device-scale-factor=1.5` 实测内容区
 * 1441×901 而非 1440×900）——差 1px 会让「壳内截图 vs 浏览器截图」的逐像素对照失去可比性
 * （验收标准 §3）。这里做**有界**试探（至多 4 次），命中即止；一次都没命中就如实记进 notes，
 * 不伪装成通过。
 */
async function fitViewportToBaseline(
  window: BrowserWindow,
  target: { width: number; height: number },
): Promise<string[]> {
  const notes: string[] = [];
  const measure = async () => {
    const raw = (await window.webContents.executeJavaScript(
      'JSON.stringify([window.innerWidth, window.innerHeight])',
    )) as string;
    return JSON.parse(raw) as [number, number];
  };

  for (const [candidateWidth, candidateHeight] of [
    [target.width, target.height],
    [target.width - 1, target.height - 1],
    [target.width - 2, target.height - 2],
    [target.width + 1, target.height + 1],
  ] as Array<[number, number]>) {
    window.setContentSize(candidateWidth, candidateHeight);
    const [innerWidth, innerHeight] = await measure();
    if (innerWidth === target.width && innerHeight === target.height) {
      notes.push(
        `页面视口已校正：请求 ${candidateWidth}×${candidateHeight} → 实测 ${innerWidth}×${innerHeight}`,
      );
      return notes;
    }
  }

  const [finalWidth, finalHeight] = await measure();
  notes.push(
    `页面视口无法精确校正到 ${target.width}×${target.height}（合成器取整），实测 ${finalWidth}×${finalHeight}`,
  );
  return notes;
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

  const captureNotes: string[] = [];
  if (pngPath) {
    await new Promise((resolve) => setTimeout(resolve, CAPTURE_SETTLE_MS));
    const image = normalizeCapture(await window.webContents.capturePage(), captureNotes);
    mkdirSync(dirname(pngPath), { recursive: true });
    writeFileSync(pngPath, image.toPNG());
  }

  // 对照态要求页面视口严格等于基准（合成器取整会偏 1px），故先做有界校正再看事实
  const notes = [...captureNotes, ...(await fitViewportToBaseline(window, WINDOW_SIZE))];

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
      innerWidth: page.innerWidth,
      innerHeight: page.innerHeight,
    },
    security,
    page: {
      href: window.webContents.getURL(),
      title: page.title,
      readyState: page.readyState,
      bodyChildren: page.bodyChildren,
      marker: page.marker,
    },
    notes,
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

/**
 * 把截图裁到**基准物理尺寸**（1440×900 CSS × DPR）。
 *
 * 为什么需要：合成器按物理像素取整（本机 WSLg + DPR1.5 实测截图 2162×1352，基准应为 2160×1350），
 * 而验收标准 §3 要求两侧**同口径**才可比。偏差 ≤2px 时裁掉多出的右/下边（记为 note，不隐瞒）；
 * 偏差更大说明视口口径真的不对——**不裁**，让对照段按尺寸不一致判 fail。
 */
function normalizeCapture(image: NativeImage, notes: string[]): NativeImage {
  if (!hasDpr) {
    return image;
  }
  const target = {
    width: Math.round(WINDOW_SIZE.width * requestedDpr),
    height: Math.round(WINDOW_SIZE.height * requestedDpr),
  };
  const size = image.getSize();
  const withinTolerance =
    Math.abs(size.width - target.width) <= 2 && Math.abs(size.height - target.height) <= 2;
  const needsCrop = size.width !== target.width || size.height !== target.height;

  if (!withinTolerance || !needsCrop) {
    return image;
  }
  notes.push(
    `截图按基准物理尺寸裁切 ${size.width}×${size.height} → ${target.width}×${target.height}（合成器物理像素取整；§3 同口径要求）`,
  );
  return image.crop({ x: 0, y: 0, width: target.width, height: target.height });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate()));

  // 自检硬超时**只在自检类运行（probe/smoke）武装**：那两类的契约是「跑完就退出」，装载卡死
  // 必须被掐断；交互壳的契约是长期存活，被这个兜底计时器扫到就是误杀（D-8：存活恰好 30 秒后退 1）。
  if (armsSelfCheckTimeout(runMode)) {
    const timeout = setTimeout(() => {
      process.stderr.write(`壳自检超时（${SELF_CHECK_TIMEOUT_MS}ms）：装载或渲染未完成\n`);
      finish(1);
    }, SELF_CHECK_TIMEOUT_MS);
    timeout.unref();
  }

  try {
    if (runMode.kind === 'probe') {
      await runBaselineProbe();
      return;
    }
    if (runMode.kind === 'smoke') {
      await runSmoke(runMode.reportPath, runMode.capturePath);
      return;
    }
    if (runMode.kind === 'usage-error') {
      process.stderr.write(`${runMode.message}\n`);
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
