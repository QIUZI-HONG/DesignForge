/**
 * 门禁 UI 段公共件（修复批次 4 · 工作包 D1）——真浏览器挂载断言。
 *
 * 为什么需要（缺陷现场）：`verify-ai-two-state` / `verify-image-two-state` 的 UI 挂载探测
 * 原先是「fetch 宿主页 HTML 找 `data-df-panel=…`」——而客户端挂载的组件（AI 抽屉 / 出图面板）
 * **不会出现在 SSR HTML** 里，探测恒为 `pending`（等于没测）。本模块把该段升级为
 * **真浏览器断言**（playwright-core + 真 Chromium），与 `verify-canvas` 同一条驱动口径。
 *
 * daemon 请求怎么走：页面用相对前缀 `?daemon=/df-daemon`（客户端只做字符串拼接，相对前缀可用），
 * 由 Playwright 的 `page.route` 把 `**\/df-daemon/**` 转发给真实 daemon（Node 侧 fetch）——
 * 绕开的只有浏览器 CORS 层，被验证的仍是「客户端真实请求语义 + 真实 daemon」（同 verify-canvas）。
 * **为什么不走同源网关**：Next 16 dev 有开发源限制（非 `localhost` 的 Host/
 * `_next/*` 请求会被拦，实测经网关打开时客户端 chunk 不 boot、整棵树停在 SSR 空槽）。
 *
 * 三态语义（与《前端验收标准 v1》§4 一致，禁止假绿）：
 * - `passed`：页面可达 + 全部 UI 断言通过；
 * - `failed`：页面可达但有断言不成立（含「空跑零断言」——什么都不跑不等于跑过了）；
 * - `blocked`：环境前置不成立（未找到 Chromium / 站点起不来 / 编辑器路由不可达）——
 *   调用方据此把门禁置为 exit 2（阻塞），**不是通过**。
 *
 * 站点来源：优先复用 `DF_WEB_URL`；未设置时自起 `next dev`（4420+ 空闲端口，遵守
 * 「4318 / 3000 是常驻实例，勿动」的端口纪律；Next 16 每项目单实例，遇到既有 dev
 * 服务自报地址时复用之，与 `verify-canvas` 同口径）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** daemon 请求在页面里的相对前缀（Playwright 路由据此转发；见模块头注释）。 */
export const DAEMON_ROUTE_PREFIX = '/df-daemon';

/** 自起站点的端口扫描起点（4420+：避开常驻的 4318（daemon）/ 3000（站点））。 */
const WEB_PORT_START = 4420;
/** 端口扫描跨度（4420–4479 足够；两端都被占说明本机环境异常）。 */
const WEB_PORT_SPAN = 60;

/** 阻塞类错误（前置不成立；调用方按 exit 2 处理）。 */
export class UiMountBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UiMountBlockedError';
  }
}

/** 缓存的 Chromium（playwright-core 需显式 executablePath；与 verify-canvas 同口径）。 */
export function resolveChrome() {
  if (process.env.BENCH_CHROME_EXECUTABLE !== undefined) {
    return process.env.BENCH_CHROME_EXECUTABLE;
  }
  const cacheRoot = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cacheRoot)) return undefined;
  for (const entry of readdirSync(cacheRoot)) {
    if (!entry.startsWith('chromium-')) continue;
    const candidate = join(cacheRoot, entry, 'chrome-linux64', 'chrome');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** 端口是否空闲（能 listen 即空闲）。 */
function portFree(port) {
  return new Promise((settle) => {
    const server = createNetServer();
    server.once('error', () => settle(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => settle(true));
    });
  });
}

/** 从起点向上取第一个空闲端口（端口纪律：4420+）。 */
async function freePortFrom(start) {
  for (let port = start; port < start + WEB_PORT_SPAN; port += 1) {
    if (await portFree(port)) return port;
  }
  throw new UiMountBlockedError(`找不到空闲端口（扫描 ${start}–${start + WEB_PORT_SPAN}）`);
}

/** 等待谓词返回真值（返回后立即停止轮询）。 */
async function waitFor(check, { timeout, interval }) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() >= deadline) return null;
    await new Promise((settle) => setTimeout(settle, interval));
  }
}

/** 站点可达探测（根路径 200 才算就绪；dev 首编译很慢，调用方给足超时）。 */
async function probeSite(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** CanvasKit 运行时资产就位（与 e2e runner 同口径；dev server 不跑 prebuild 钩子）。 */
function ensureCanvasKitAssets(repoRoot) {
  const script = join(repoRoot, 'apps/web/src/features/canvas/tools/copy-canvaskit-assets.mjs');
  if (!existsSync(script)) return;
  spawnSync(process.execPath, [script], { cwd: repoRoot, stdio: 'ignore' });
}

/** 起子进程（独立进程组：pnpm → next dev 是多跳链，退整组才不留孙进程）。 */
function spawnDetached(command, args, options) {
  return spawn(command, args, { ...options, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** 整组信号（detached 的子进程不在本进程组内；已退出则忽略）。 */
function signalGroup(child, signal) {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, signal);
  } catch {
    // 已退出 / 组内已空
  }
}

/** 站点句柄集合：进程退出兜底整组回收（防残留占端口）。 */
const liveChildren = new Set();
process.on('exit', () => {
  for (const child of liveChildren) signalGroup(child, 'SIGTERM');
});

/**
 * 确保站点可用：复用 `DF_WEB_URL`，或自起 next dev（4420+）。
 *
 * @param {{ repoRoot?: string, log?: (message: string) => void }} options
 * @returns {Promise<{ url: string, started: boolean, stop: () => Promise<void> }>}
 */
export async function ensureWebSite(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const log = options.log ?? (() => {});
  const envUrl = process.env.DF_WEB_URL;
  if (envUrl !== undefined && envUrl !== '') {
    if (!(await probeSite(envUrl))) {
      throw new UiMountBlockedError(`站点不可达（DF_WEB_URL=${envUrl}）`);
    }
    return { url: envUrl, started: false, stop: async () => {} };
  }

  ensureCanvasKitAssets(repoRoot);
  const port = await freePortFrom(WEB_PORT_START);
  const child = spawnDetached(
    'pnpm',
    ['--filter', '@dforge/web', 'exec', 'next', 'dev', '-p', String(port)],
    { cwd: repoRoot, env: { ...process.env } },
  );
  liveChildren.add(child);
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += String(chunk);
  });

  const stop = async () => {
    if (!liveChildren.has(child)) return;
    liveChildren.delete(child);
    signalGroup(child, 'SIGTERM');
    const exited = await waitFor(() => child.exitCode !== null || child.signalCode !== null, {
      timeout: 5000,
      interval: 100,
    });
    if (exited === null) signalGroup(child, 'SIGKILL');
  };

  // Next 16 每项目单实例：既有 dev 服务在跑时新进程会自报地址后退出——复用它而不是判阻塞
  let url = `http://localhost:${String(port)}`;
  const existing = await waitFor(
    () => {
      const match = output.match(/existing server at (http:\/\/localhost:\d+)/);
      return match?.[1] ?? null;
    },
    { timeout: 6000, interval: 200 },
  );
  if (typeof existing === 'string') {
    log(`复用已运行的 next dev：${existing}（Next 16 每项目单实例）`);
    url = existing;
  } else {
    // 端口漂移兜底：计划端口被占时 Next 会自报真实地址
    const advertised = await waitFor(
      () => {
        const match = output.match(/(?:Local:|existing server at)\s+(http:\/\/localhost:\d+)/);
        return match?.[1] ?? null;
      },
      { timeout: 8000, interval: 200 },
    );
    if (typeof advertised === 'string' && advertised !== url) {
      log(`端口漂移：计划 ${url} 已被占用，改用站点自报地址 ${advertised}`);
      url = advertised;
    }
  }

  const ready = await waitFor(() => (probeSite(url) ? true : null), {
    timeout: 180_000,
    interval: 500,
  });
  if (ready === null) {
    await stop();
    throw new UiMountBlockedError(`站点未能启动（输出尾部：${output.slice(-400)}）`);
  }
  log(`站点就绪：${url}${child.exitCode !== null ? '（复用既有实例）' : ''}`);
  return { url, started: true, stop };
}

/**
 * 跑一段 UI 挂载断言（真浏览器 + 同源网关 + 真点击）。
 *
 * @param {{
 *   daemonUrl: string,
 *   check: (context: {
 *     page: import('playwright-core').Page,
 *     record: (id: string, ok: boolean, detail: string) => void,
 *     screenshot: (fileName: string) => Promise<string>,
 *     editorUrl: string,
 *   }) => Promise<void>,
 *   evidenceDir: string,
 *   log?: (message: string) => void,
 *   screenshotName?: string,
 * }} options
 * @returns {Promise<{
 *   status: 'passed' | 'failed' | 'blocked',
 *   reason: string | null,
 *   steps: Array<{ id: string, ok: boolean, detail: string }>,
 *   editorUrl: string | null,
 *   screenshot: string | null,
 * }>}
 */
export async function runUiMountCheck(options) {
  const { daemonUrl, check, evidenceDir, screenshotName } = options;
  const log = options.log ?? (() => {});
  const steps = [];
  const record = (id, ok, detail) => {
    steps.push({ id, ok: Boolean(ok), detail });
  };
  let web = null;
  let browser = null;
  let editorUrl = null;
  let screenshot = null;

  const blocked = (reason) => ({
    status: 'blocked',
    reason,
    steps,
    editorUrl,
    screenshot,
  });

  try {
    const chrome = resolveChrome();
    if (chrome === undefined) {
      return blocked('未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）');
    }
    web = await ensureWebSite({ log });

    const { chromium } = await import('playwright-core');
    try {
      browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
    } catch (error) {
      return blocked(`Chromium 启动失败（无显示器环境？）：${String(error)}`);
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    // daemon 请求经页面相对前缀 → Playwright 转发真 daemon（Node 侧 fetch；见模块头注释）
    await page.route(`**${DAEMON_ROUTE_PREFIX}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const target = `${daemonUrl}${url.pathname.slice(DAEMON_ROUTE_PREFIX.length)}${url.search}`;
      const hasBody = request.method() !== 'GET' && request.method() !== 'HEAD';
      try {
        const response = await fetch(target, {
          method: request.method(),
          headers: {
            'content-type': 'application/json',
            ...(hasBody ? { body: request.postData() ?? '{}' } : {}),
          },
        });
        await route.fulfill({
          status: response.status,
          contentType: 'application/json',
          body: await response.text(),
        });
      } catch (error) {
        await route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, message: String(error) }),
        });
      }
    });
    log(`daemon 请求代理就绪：${DAEMON_ROUTE_PREFIX}/** → ${daemonUrl}`);

    // 页面直接开站点本源（dev 形态有开发源限制，经网关打开会停在 SSR 空槽）；`?daemon=` 用相对前缀
    editorUrl = `${web.url}/editor?daemon=${encodeURIComponent(DAEMON_ROUTE_PREFIX)}`;
    const capture = async (fileName) => {
      await mkdir(evidenceDir, { recursive: true });
      screenshot = join(evidenceDir, fileName);
      await page.screenshot({ path: screenshot });
      return screenshot;
    };
    log(`打开编辑器：${editorUrl}`);
    let response = null;
    try {
      response = await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    } catch (error) {
      return blocked(`编辑器打不开（${editorUrl}）：${String(error)}`);
    }
    const status = response?.status() ?? 0;
    if (status === 0 || status >= 400) {
      return blocked(`编辑器路由不可达（HTTP ${String(status)}）`);
    }

    try {
      await check({ page, record, screenshot: capture, editorUrl });
    } catch (error) {
      record('ui.check.crashed', false, `断言过程抛错：${String(error)}`);
    }
    if (screenshotName !== undefined && screenshot === null) {
      await capture(screenshotName).catch(() => undefined);
    }

    if (steps.length === 0) {
      return {
        status: 'failed',
        reason: 'UI 段未产生任何断言（空跑不得当绿）',
        steps,
        editorUrl,
        screenshot,
      };
    }
    const failedSteps = steps.filter((step) => !step.ok);
    return {
      status: failedSteps.length === 0 ? 'passed' : 'failed',
      reason:
        failedSteps.length === 0
          ? null
          : `UI 断言失败 ${String(failedSteps.length)} 项：${failedSteps
              .map((step) => step.id)
              .join(', ')}`,
      steps,
      editorUrl,
      screenshot,
    };
  } catch (error) {
    return blocked(String(error));
  } finally {
    if (browser !== null) await browser.close().catch(() => undefined);
    if (web !== null) await web.stop().catch(() => undefined);
  }
}
