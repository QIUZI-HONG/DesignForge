#!/usr/bin/env node
/**
 * e2e-smoke-min —— **临时最小 runner**（FE-06 交付，待 FE-02 的正式 runner 合入后删除）。
 *
 * 为什么会有这个文件：本票需要「画布场景」的 e2e（拖画 → 持久化 → 导出/导入往返）
 * 在集成分支上真实可跑，而正式 runner（`scripts/e2e-smoke.mjs`，自动发现
 * `scripts/e2e/scenarios/*.mjs`）归 FE-02，落地时间晚于本票。本 runner 严格按
 * FE-02 简报 §3 的场景契约实现（`run(page, ctx)`），因此**换 runner 不需要改场景**：
 * 它只负责起 daemon（临时目录）、复用/启动站点、逐场景执行、非零退出即失败。
 *
 * 退出码：0 通过 / 1 场景失败 / 2 阻塞（站点或 daemon 起不来、无 Chromium、无场景）。
 *
 * 用法（仓库根执行）：
 *   node scripts/e2e-smoke-min.mjs                  # 全部场景
 *   node scripts/e2e-smoke-min.mjs canvas          # 只跑名字含 canvas 的场景
 *   DF_WEB_URL=http://localhost:3216 node scripts/e2e-smoke-min.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_APP_DIR = join(REPO_ROOT, 'apps', 'web');
const SCENARIO_DIR = join(REPO_ROOT, 'scripts', 'e2e', 'scenarios');
const DAEMON_PREFIX = '/df-daemon';

const filter = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
let webUrl = process.env.DF_WEB_URL;
let daemonUrl = process.env.DF_DAEMON_URL;

const cleanups = [];
let workspaceDir;

/** 探测 HTTP。 */
async function probe(url) {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    return response.status < 500;
  } catch {
    return false;
  }
}

/** 端口是否被占用。 */
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

/** 起子进程并收集输出。 */
function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buffer = '';
  child.stdout?.on('data', (chunk) => {
    buffer += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    buffer += chunk.toString();
  });
  return { child, output: () => buffer };
}

/** 轮询等待。 */
async function waitFor(check, { timeout = 20000, interval = 200, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await Promise.resolve()
      .then(() => check())
      .catch(() => null);
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await new Promise((settle) => setTimeout(settle, interval));
  }
}

/** Chromium 可执行文件。 */
function resolveChrome() {
  if (process.env.BENCH_CHROME_EXECUTABLE !== undefined) return process.env.BENCH_CHROME_EXECUTABLE;
  const cacheRoot = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cacheRoot)) return undefined;
  for (const entry of readdirSync(cacheRoot)) {
    if (!entry.startsWith('chromium-')) continue;
    const candidate = join(cacheRoot, entry, 'chrome-linux64', 'chrome');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** 准备 daemon（临时工作目录）。 */
async function ensureDaemon() {
  if (daemonUrl !== undefined && (await probe(`${daemonUrl}/health`))) return;
  workspaceDir = await mkdtemp(join(tmpdir(), 'df-e2e-ws-'));
  const dataRoot = await mkdtemp(join(tmpdir(), 'df-e2e-data-'));
  let port = 4518;
  while (await portBusy(port)) port += 1;
  const started = startProcess(process.execPath, [join(REPO_ROOT, 'apps/daemon/src/main.ts')], {
    env: {
      DF_WORKSPACE_DIR: workspaceDir,
      DF_DATA_ROOT: dataRoot,
      DF_PORT: String(port),
      DF_HOST: '127.0.0.1',
    },
  });
  cleanups.push(() => started.child.kill('SIGTERM'));
  const url = await waitFor(
    () => {
      const match = started.output().match(/\[daemon\] listening on (http:\/\/[^\s]+)/);
      return match === null ? null : match[1];
    },
    { timeout: 25000, label: 'daemon 启动' },
  ).catch(() => null);
  if (url === null) {
    console.error(`阻塞：daemon 未能启动（输出尾部：${started.output().slice(-400)}）`);
    process.exit(2);
  }
  daemonUrl = url;
}

/** 准备站点（复用已运行的 dev/start；Next 16 dev 每项目单实例）。 */
async function ensureWeb() {
  if (webUrl !== undefined && (await probe(`${webUrl}/_canvas`))) return;
  let port = 3326;
  while (await portBusy(port)) port += 1;
  const started = startProcess(
    'pnpm',
    ['--filter', '@dforge/web', 'exec', 'next', 'dev', '-p', String(port)],
    {
      cwd: REPO_ROOT,
    },
  );
  cleanups.push(() => started.child.kill('SIGTERM'));
  webUrl = `http://localhost:${port}`;
  const reused = await waitFor(
    () => {
      const match = started.output().match(/existing server at (http:\/\/localhost:\d+)/);
      return match === null ? null : match[1];
    },
    { timeout: 6000, label: '既有 dev 探测' },
  ).catch(() => null);
  if (reused !== null) webUrl = reused;
  const ready = await waitFor(() => probe(`${webUrl}/_canvas`), {
    timeout: 120000,
    interval: 500,
    label: '站点就绪',
  })
    .then(() => true)
    .catch(() => false);
  if (!ready) {
    console.error(`阻塞：站点未能启动（输出尾部：${started.output().slice(-400)}）`);
    process.exit(2);
  }
}

/** 场景上下文：daemon 转发（绕开浏览器 CORS：daemon 暂不发 CORS 头）。 */
function scenarioContext(page, log) {
  return {
    webUrl,
    daemonUrl,
    canvasUrl: `${webUrl}/_canvas?daemon=${encodeURIComponent(DAEMON_PREFIX)}`,
    log,
    assert(condition, message, detail) {
      if (!condition) {
        const error = new Error(
          `断言失败：${message}${detail === undefined ? '' : ` —— ${JSON.stringify(detail)}`}`,
        );
        throw error;
      }
      log(`  ok ${message}`);
    },
    async routeDaemon() {
      await page.route(`**${DAEMON_PREFIX}/**`, async (route) => {
        const request = route.request();
        const parsed = new URL(request.url());
        const target = `${daemonUrl}${parsed.pathname.replace(DAEMON_PREFIX, '')}${parsed.search}`;
        try {
          const response = await fetch(target, {
            method: request.method(),
            headers: { 'content-type': 'application/json' },
            ...(request.method() === 'GET' || request.method() === 'HEAD'
              ? {}
              : { body: request.postData() ?? '{}' }),
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
    },
  };
}

/** 主流程。 */
async function main() {
  if (!existsSync(SCENARIO_DIR)) {
    console.error(`阻塞：场景目录不存在：${SCENARIO_DIR}`);
    process.exit(2);
  }
  const files = readdirSync(SCENARIO_DIR).filter((name) => name.endsWith('.mjs'));
  const targets = filter === undefined ? files : files.filter((name) => name.includes(filter));
  if (targets.length === 0) {
    console.error(`阻塞：没有匹配的场景（筛选：${filter ?? '全部'}）`);
    process.exit(2);
  }
  const chrome = resolveChrome();
  if (chrome === undefined) {
    console.error('阻塞：未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）');
    process.exit(2);
  }
  // 资产：画布场景需要 CanvasKit（幂等）
  spawn(
    process.execPath,
    [join(WEB_APP_DIR, 'src/features/canvas/tools/copy-canvaskit-assets.mjs')],
    {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    },
  ).on('exit', () => undefined);
  await ensureDaemon();
  await ensureWeb();

  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  let failed = 0;
  try {
    for (const file of targets) {
      const log = (line) => console.log(`  ${line}`);
      console.log(`场景 ${file}`);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1.5,
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      try {
        const module = await import(pathToFileURL(join(SCENARIO_DIR, file)).href);
        const run = module.run;
        if (typeof run !== 'function') throw new Error('场景模块必须导出 run(page, ctx)');
        await run(page, scenarioContext(page, log));
        if (errors.length > 0) throw new Error(`页面错误：${errors.slice(0, 3).join(' | ')}`);
        console.log(`  通过 ${file}`);
      } catch (error) {
        failed += 1;
        console.error(`  失败 ${file}：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        // 忽略
      }
    }
    if (workspaceDir !== undefined) {
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  if (failed > 0) {
    console.error(`失败：${failed} 个场景未通过`);
    process.exit(1);
  }
  console.log('通过：全部场景');
  void readFileSync;
}

void main();
