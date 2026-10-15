#!/usr/bin/env node
/**
 * e2e-smoke —— 端到端冒烟 runner（FE-02 建立；场景按文件自动发现）。
 *
 * 与单元测试的分工：单测在 jsdom 里断言组件行为；冒烟在**真实链路**上跑——
 * 真 daemon 子进程（临时数据目录）+ 真 web 站点（生产构建）+ 真 Chromium，
 * 覆盖「打开首页 → 新建 → 打开文档 → 断言持久化」这条主路径。
 *
 * 场景协议（`scripts/e2e/scenarios/*.mjs`，本 runner 自动发现并逐个执行）：
 *   export const id = 'home';                     // 场景标识（报告用）
 *   export const title = '…';                     // 场景名（报告用，中文）
 *   export async function run(page, ctx) { … }    // 返回 { steps: Step[] }
 *   // Step = { name, status: 'pass' | 'fail' | 'blocked', detail? }
 * 新增场景（如 FE-06 的画布）只需放文件进该目录，不必改本 runner。
 *
 * 用法（仓库根执行）：
 *   pnpm e2e:smoke                        # 自动构建 + 起站点 + 起 daemon
 *   DF_WEB_URL=http://127.0.0.1:3000 pnpm e2e:smoke   # 站点已在跑，复用
 *   pnpm e2e:smoke --scenario home        # 只跑一个场景
 *
 * 环境变量：DF_WEB_URL、DF_E2E_KEEP=1（保留临时数据目录）、BENCH_CHROME_EXECUTABLE、
 *           DF_EVIDENCE_DIR（证据根，缺省 ~/df-evidence）。
 *
 * 退出码（三态，禁止假绿）：0 = 全部步骤通过；1 = 有步骤失败；
 * 2 = **阻塞**（daemon 起不来 / 站点起不来 / Chromium 缺失 / 场景标记 blocked）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { freePort, startFixtureDaemon, startSameOriginGateway } from './lib/gates.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scenariosDir = join(repoRoot, 'scripts', 'e2e', 'scenarios');
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const TICKET = 'fe-02';

const args = process.argv.slice(2);
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const onlyScenario = flagValue('--scenario');
const verbose = args.includes('--verbose');

const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const runDir = join(EVIDENCE_ROOT, TICKET, 'e2e', stamp);
const dataRoot = join(runDir, 'data');
const workspaceDir = join(dataRoot, 'workspace');

/** 向 stdout 打一行（带前缀，便于从日志里区分子进程输出）。 */
function log(message) {
  console.log(`[e2e] ${message}`);
}

/** 轮询 HTTP 直到 200（或超时）。 */
async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '未发起请求';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
      lastError = `HTTP ${String(response.status)}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((done) => setTimeout(done, 300));
  }
  log(`${label} 等待超时（${lastError}）`);
  return false;
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

/** 落盘证据 JSON 并退出。 */
function finish(result, code) {
  result.exitCode = code;
  result.finishedAt = new Date().toISOString();
  mkdirSync(runDir, { recursive: true });
  const evidencePath = join(runDir, `e2e-smoke-${stamp}.json`);
  writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  log(`证据：${evidencePath}`);
  if (process.env.DF_E2E_KEEP === '1') log(`临时数据目录（保留）：${dataRoot}`);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// 一、场景发现
// ---------------------------------------------------------------------------

if (!existsSync(scenariosDir)) {
  console.error('阻塞：场景目录不存在（scripts/e2e/scenarios）。');
  process.exit(2);
}

const scenarioFiles = readdirSync(scenariosDir)
  .filter((name) => name.endsWith('.mjs'))
  .sort();
const selected = scenarioFiles.filter(
  (name) => onlyScenario === undefined || name.startsWith(onlyScenario),
);

const evidence = {
  ticket: 'FE-02',
  gate: 'e2e-smoke',
  startedAt: startedAt.toISOString(),
  webUrl: process.env.DF_WEB_URL ?? null,
  scenarioFiles: selected,
  daemon: null,
  scenarios: [],
  exitCode: 2,
};

if (selected.length === 0) {
  console.error(`阻塞：没有匹配的场景文件（--scenario ${String(onlyScenario)}）。`);
  finish(evidence, 2);
}

// ---------------------------------------------------------------------------
// 二、起 daemon（子进程 + 临时数据目录；共享件见 scripts/lib/gates.mjs）
// ---------------------------------------------------------------------------

mkdirSync(workspaceDir, { recursive: true });
let webServer = null;
let gateway = null;
let fixtureDaemon;
try {
  fixtureDaemon = await startFixtureDaemon({ dataRoot, workspaceDir });
} catch (error) {
  evidence.daemon = { url: null, dataRoot, workspaceDir };
  console.error(
    ['阻塞：daemon 起不来（本 runner 需要真 daemon 才能跑主路径）。', String(error)].join('\n'),
  );
  finish(evidence, 2);
}
const daemonUrl = fixtureDaemon.url;
log(`daemon 就绪：${daemonUrl}（数据根 ${dataRoot}）`);
evidence.daemon = { url: daemonUrl, dataRoot, workspaceDir };

/** 结束 daemon / 站点 / 网关（各处提前退出与收尾复用）。 */
async function shutdown() {
  await gateway?.close();
  webServer?.kill('SIGTERM');
  await fixtureDaemon?.close();
}

// ---------------------------------------------------------------------------
// 三、站点（复用 DF_WEB_URL，或生产构建 + 起服务）
// ---------------------------------------------------------------------------

let webUrl = process.env.DF_WEB_URL ?? null;

if (webUrl === null) {
  const webPort = await freePort();
  webUrl = `http://127.0.0.1:${webPort}`;
  const nextBin = join(repoRoot, 'apps/web/node_modules/.bin/next');
  if (!existsSync(nextBin)) {
    await shutdown();
    console.error('阻塞：未找到 next 可执行文件（先 pnpm install）。');
    finish(evidence, 2);
  }

  const build = spawn(nextBin, ['build'], { cwd: join(repoRoot, 'apps/web'), stdio: 'inherit' });
  const buildCode = await new Promise((resolveBuild) => build.on('exit', resolveBuild));
  if (buildCode !== 0) {
    await shutdown();
    console.error('阻塞：web 构建失败（见上方 next build 输出）。');
    finish(evidence, 2);
  }

  webServer = spawn(nextBin, ['start', '-p', String(webPort)], {
    cwd: join(repoRoot, 'apps/web'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  webServer.stdout.on('data', (chunk) => {
    if (verbose) process.stdout.write(`[web] ${String(chunk)}`);
  });
  webServer.stderr.on('data', (chunk) => {
    if (verbose) process.stderr.write(`[web] ${String(chunk)}`);
  });
}

evidence.webUrl = webUrl;
if (!(await waitForHttp(webUrl, 60_000, '站点'))) {
  await shutdown();
  console.error(`阻塞：站点不可达（${webUrl}）。`);
  finish(evidence, 2);
}
log(`站点就绪：${webUrl}`);

// ---------------------------------------------------------------------------
// 三之二、同源网关（还原架构 §3.1 的「Web 应用 ↑↓ 同源 HTTP」形态）
// ---------------------------------------------------------------------------

gateway = await startSameOriginGateway({ webUrl, daemonUrl });
const gatewayUrl = gateway.url;
evidence.gatewayUrl = gatewayUrl;
log(`同源网关就绪：${gatewayUrl}（/df/* → daemon，其余 → 站点）`);

// ---------------------------------------------------------------------------
// 四、浏览器 + 场景执行
// ---------------------------------------------------------------------------

const chrome = resolveChrome();
if (chrome === undefined) {
  await shutdown();
  console.error('阻塞：未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）。');
  finish(evidence, 2);
}

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });

const allSteps = [];
for (const file of selected) {
  const module = await import(join(scenariosDir, file));
  const scenarioId = typeof module.id === 'string' ? module.id : file.replace(/\.mjs$/, '');
  const scenarioTitle = typeof module.title === 'string' ? module.title : scenarioId;
  if (typeof module.run !== 'function') {
    console.error(`阻塞：场景 ${file} 未导出 run(page, ctx)。`);
    await browser.close();
    await shutdown();
    finish(evidence, 2);
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  log(`场景开始：${scenarioTitle}（${scenarioId}）`);
  let steps = [];
  try {
    const result = await module.run(page, {
      // 页面走同源网关；`?daemon=` 指向网关下的 `/df`（同源，与生产形态一致）
      homeUrl: `${gatewayUrl}/?daemon=${encodeURIComponent(`${gatewayUrl}/df`)}`,
      pageUrl: gatewayUrl,
      webUrl,
      daemonUrl,
      dataRoot,
      workspaceDir,
      log: (message) => log(`  ${scenarioId} · ${message}`),
      verbose,
    });
    steps = Array.isArray(result?.steps) ? result.steps : [];
  } catch (error) {
    steps = [{ name: '场景执行', status: 'fail', detail: String(error) }];
  }

  for (const step of steps) {
    const mark = step.status === 'pass' ? '✓' : step.status === 'blocked' ? '⏸' : '✗';
    log(`  ${mark} ${step.name}${step.detail === undefined ? '' : ` —— ${step.detail}`}`);
  }
  evidence.scenarios.push({ id: scenarioId, title: scenarioTitle, steps, pageErrors });
  allSteps.push(...steps);
  await context.close();
}

await browser.close();
await shutdown();

// ---------------------------------------------------------------------------
// 五、汇总与退出码
// ---------------------------------------------------------------------------

const failures = allSteps.filter((step) => step.status === 'fail');
const blocked = allSteps.filter((step) => step.status === 'blocked');
const passed = allSteps.filter((step) => step.status === 'pass');

evidence.summary = {
  steps: allSteps.length,
  passed: passed.length,
  failed: failures.length,
  blocked: blocked.length,
};

if (failures.length > 0) {
  console.error(`失败：${failures.map((step) => step.name).join('、')}`);
  finish(evidence, 1);
}
if (blocked.length > 0) {
  console.error(
    [
      `阻塞：${blocked.length} 个步骤未通过（前置未就绪，非本票缺陷）——`,
      ...blocked.map((step) => `  · ${step.name}：${step.detail ?? ''}`),
    ].join('\n'),
  );
  finish(evidence, 2);
}

finish(evidence, 0);
