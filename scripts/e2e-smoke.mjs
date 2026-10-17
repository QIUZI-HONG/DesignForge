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
 *   export async function run(page, ctx) { … }    // 返回 { steps: Step[] }（可省略，见下）
 *   // Step = { name, status: 'pass' | 'fail' | 'blocked', detail? }
 *
 * **runner 与场景的契约**（两边必须一致，否则场景会恒定失败或空跑假绿）：
 *   - `ctx.assert(condition, name, detail?)`：记录一条 pass/fail 步骤。场景可以只用
 *     `ctx.assert` 而不自收集 steps（画布场景即此风格）；runner 负责把它们并入证据。
 *   - `ctx.routeDaemon()`：让页面里的 daemon 请求可达。本 runner 用**同源网关**
 *     （`/df/*` → daemon），请求天然同源，故该钩子为 no-op（保留以对齐场景契约）。
 *   - `ctx.canvasUrl`：画布宿主页地址（已带 `?daemon=` 查询串，场景可再追加 `&doc=`）。
 *   - `ctx.homeUrl / pageUrl / webUrl / daemonUrl / dataRoot / workspaceDir / log / verbose`。
 *
 * **steps = 0 必须非零退出**（防假绿）：场景既不自报 steps、也不用 `ctx.assert` 时，
 * runner 记一条 fail 步骤并以 exit 1 结束——「什么都没跑」不等于「跑过了」。
 * 场景模块导入失败（含语法错）同样记 fail 步骤、落证据、清子进程，以 exit 1 结束。
 *
 * 用法（仓库根执行）：
 *   pnpm e2e:smoke                        # 自动构建 + 起站点 + 起 daemon
 *   DF_WEB_URL=http://127.0.0.1:3000 pnpm e2e:smoke   # 站点已在跑，复用
 *   pnpm e2e:smoke --scenario home        # 只跑一个场景
 *
 * 环境变量：DF_WEB_URL、DF_E2E_KEEP=1（保留临时数据目录）、BENCH_CHROME_EXECUTABLE、
 *           DF_EVIDENCE_DIR（证据根，缺省 ~/df-evidence）。
 *
 * **编辑器真实门禁（D4）**：场景之外 runner 还跑「四之二」段——构建前先就位 CanvasKit
 * 资产（`public/canvaskit/` 是生成物、不入库），随后对 `/editor` 断言资产可达（200）+
 * 画布元素挂载 + Skia 就绪 + 首帧出帧 + 无未捕获异常。渲染坏了就是非零退出，
 * 不再有「body 非空」的假绿（`/editor` 路由缺失 → blocked，不是通过）。
 *
 * 退出码（三态，禁止假绿）：0 = 全部步骤通过；1 = 有步骤失败 / 场景空跑（契约违约）；
 * 2 = **阻塞**（daemon 起不来 / 站点起不来 / Chromium 缺失 / 场景标记 blocked）。
 * 任何退出路径都：先落证据 → 再清子进程（daemon / 站点 / 网关 / 浏览器）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveChromeExecutable } from './lib/browser-toolchain.mjs';
import { freePort, startFixtureDaemon, startSameOriginGateway } from './lib/gates.mjs';
import { buildJUnitXml } from './lib/junit.mjs';

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

/**
 * 构建前置：CanvasKit 运行时资产（wasm + 字体）就位。
 *
 * 为什么 runner 自己也要做一遍：`public/canvaskit/` 是**生成物且不入库**（.gitignore），
 * fresh worktree 里不存在；而本 runner 直接拉起 `next build` / `next start`，
 * 绕过 npm 的 `prebuild` / `prestart` 钩子。资产缺失时 `/canvaskit/canvaskit.js` 会 404，
 * 编辑器停在「Skia 初始化失败」——下面的编辑器真实门禁因此必须判红（不得假绿）。
 */
function ensureCanvasKitAssets() {
  const script = join(repoRoot, 'apps/web/src/features/canvas/tools/copy-canvaskit-assets.mjs');
  if (!existsSync(script)) {
    log('CanvasKit 资产脚本不存在（跳过准备；编辑器门禁会因此失败）');
    return false;
  }
  const result = spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: 'utf8' });
  if (result.status === 0) {
    log(result.stdout.trim());
    return true;
  }
  console.error(`CanvasKit 资产准备失败：${result.stderr ?? String(result.error)}`);
  return false;
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

/** 缓存的 Chromium 可执行文件（研究 #5：playwright-core 1.63 需显式 executablePath）。
 *  实现回抽到 `lib/browser-toolchain.mjs`（复核 J8：一处实现，不再第三份）。 */
const resolveChrome = resolveChromeExecutable;

// ---------------------------------------------------------------------------
// 子进程登记与清理（任何退出路径都不得留残留进程）
// ---------------------------------------------------------------------------

/** 已登记的子进程（daemon / 站点）；`process.on('exit')` 兜底同步杀。 */
const children = new Set();
let webServer = null;
let gateway = null;
let browser = null;
let fixtureDaemon;
/** 站点 / daemon 地址（场景执行函数与主流程共用；无守卫时保持 null）。 */
let webUrl = null;
let daemonUrl = null;

/** 登记子进程（退出时兜底清理；不在退出回调里 await，只能同步 kill）。 */
function track(child) {
  if (child === null || child === undefined) return child;
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

process.on('exit', () => {
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // 已退出
    }
  }
});

/** 结束 daemon / 站点 / 网关 / 浏览器（各处提前退出与收尾复用；幂等）。 */
async function shutdown() {
  await gateway?.close().catch(() => undefined);
  gateway = null;
  await browser?.close().catch(() => undefined);
  browser = null;
  const running = [...children];
  for (const child of running) child.kill('SIGTERM');
  await Promise.all(
    running.map(
      (child) =>
        new Promise((done) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            done();
            return;
          }
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
        }),
    ),
  );
  await fixtureDaemon?.close().catch(() => undefined);
}

/** 落盘证据 → 打日志 → 清理子进程 → 退出（唯一出口）。 */
async function finish(result, code) {
  result.exitCode = code;
  result.finishedAt = new Date().toISOString();
  result.attempts ??= {
    policy: 'no-retry',
    maxAttemptsPerStep: 1,
    retriedSteps: 0,
    totalStepExecutions: 0,
    byScenario: [],
  };
  mkdirSync(runDir, { recursive: true });
  // JUnit 与 JSON 同一次落盘：三态映射在 scripts/lib/junit.mjs 里由步骤现算，
  // 不复制 summary 数字（两处统计漂移会掩盖 flake）。
  const junitPath = join(runDir, `e2e-smoke-${stamp}.junit.xml`);
  writeFileSync(
    junitPath,
    buildJUnitXml({
      name: 'e2e-smoke',
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      exitCode: code,
      scenarios: result.scenarios,
      editorGate: result.editorGate,
      blockedReason: Array.isArray(result.notes) ? result.notes.join('；') : undefined,
    }),
    'utf8',
  );
  result.junitPath = junitPath;
  const evidencePath = join(runDir, `e2e-smoke-${stamp}.json`);
  writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  log(`证据：${evidencePath}`);
  log(`JUnit：${junitPath}`);
  if (process.env.DF_E2E_KEEP === '1') log(`临时数据目录（保留）：${dataRoot}`);
  await shutdown();
  process.exit(code);
}

// ---------------------------------------------------------------------------
// 一、场景发现
// ---------------------------------------------------------------------------

const scenarioFiles = existsSync(scenariosDir)
  ? readdirSync(scenariosDir)
      .filter((name) => name.endsWith('.mjs'))
      .sort()
  : [];
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
  // 编辑器真实门禁（见「四之二」）：/editor 的资产 / Skia / 首帧 / 无异常硬断言
  editorGate: null,
  // 尝试记录（#107）：runner 不做重试；每个场景恰好执行一次，失败按真缺陷登记。
  attempts: { policy: 'no-retry', maxAttemptsPerStep: 1, retriedSteps: 0, byScenario: [] },
  // 验收标准 §4 字段族：冒烟是步骤级断言，不逐像素对照 → 无像素比对（三项 null + 说明）。
  diff: {
    bbox: null,
    diffPixels: null,
    ratio: null,
    note: 'e2e 冒烟为步骤级断言（无参照集截图比对）：无像素比对结论；步骤明细见 scenarios[].steps',
  },
  exitCode: 2,
};

if (!existsSync(scenariosDir)) {
  console.error('阻塞：场景目录不存在（scripts/e2e/scenarios）。');
  await finish(evidence, 2);
}

if (selected.length === 0) {
  console.error(`阻塞：没有匹配的场景文件（--scenario ${String(onlyScenario)}）。`);
  await finish(evidence, 2);
}

// ---------------------------------------------------------------------------
// 二、主流程：起 daemon → 起站点 → 网关 → 浏览器 → 逐场景执行 → 汇总退出码
// ---------------------------------------------------------------------------

/** 把「场景未产出任何步骤」记成失败：空跑必须非零退出（防假绿）。 */
function assertStepsProduced(scenarioId, steps) {
  if (steps.length > 0) return steps;
  return [
    {
      name: '场景产出步骤',
      status: 'fail',
      detail: `${scenarioId} 未产出任何步骤（steps=0）——场景必须自报 steps 或使用 ctx.assert 记录，空跑不得计为通过`,
    },
  ];
}

/** 执行单个场景，返回它贡献的步骤（异常/导入失败都记 fail 步骤，不中断其余场景）。 */
async function runScenario(file) {
  let module;
  try {
    module = await import(join(scenariosDir, file));
  } catch (error) {
    log(`场景加载失败：${file} —— ${String(error)}`);
    return {
      id: file.replace(/\.mjs$/, ''),
      title: file,
      steps: [{ name: '场景加载', status: 'fail', detail: `模块导入失败：${String(error)}` }],
      pageErrors: [],
    };
  }

  const scenarioId = typeof module.id === 'string' ? module.id : file.replace(/\.mjs$/, '');
  const scenarioTitle = typeof module.title === 'string' ? module.title : scenarioId;
  if (typeof module.run !== 'function') {
    log(`场景 ${file} 未导出 run(page, ctx)。`);
    return {
      id: scenarioId,
      title: scenarioTitle,
      steps: [{ name: '场景入口', status: 'fail', detail: '场景未导出 run(page, ctx)' }],
      pageErrors: [],
    };
  }

  // 场景隔离夹具：每个场景一套**独立数据根 + 独立 daemon + 独立网关**。
  // 为什么必须隔离：各场景对工作区状态的假设互斥（首页场景断言「空数据根」的空态，
  // 画布场景要自己造文档）；共用一个工作区时，前一个场景落下的文档会把后一个场景判红
  // ——那是夹具串味，不是产品缺陷（判红的说明必须指向真缺陷，否则门禁自己就不可信）。
  const scenarioDataRoot = join(runDir, 'scenarios', scenarioId, 'data');
  const scenarioWorkspace = join(scenarioDataRoot, 'workspace');
  mkdirSync(scenarioWorkspace, { recursive: true });
  let scenarioDaemon;
  let scenarioGateway;
  try {
    scenarioDaemon = await startFixtureDaemon({
      dataRoot: scenarioDataRoot,
      workspaceDir: scenarioWorkspace,
    });
    scenarioGateway = await startSameOriginGateway({ webUrl, daemonUrl: scenarioDaemon.url });
  } catch (error) {
    log(`场景夹具起不来：${scenarioId} —— ${String(error)}`);
    return {
      id: scenarioId,
      title: scenarioTitle,
      dataRoot: scenarioDataRoot,
      steps: [
        {
          name: '场景夹具（独立 daemon + 同源网关）',
          status: 'blocked',
          detail: `夹具起不来：${String(error)}`,
        },
      ],
      pageErrors: [],
    };
  }
  const scenarioGatewayUrl = scenarioGateway.url;
  const scenarioDaemonUrl = scenarioDaemon.url;

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  /** 场景用 `ctx.assert` 记录的步骤（与场景自报的 steps 合并）。 */
  const assertedSteps = [];
  log(`场景开始：${scenarioTitle}（${scenarioId}）数据根 ${scenarioDataRoot}`);
  let steps = [];
  try {
    const result = await module.run(page, {
      // 页面走同源网关；`?daemon=` 指向网关下的 `/df`（同源，与生产形态一致）
      homeUrl: `${scenarioGatewayUrl}/?daemon=${encodeURIComponent(`${scenarioGatewayUrl}/df`)}`,
      canvasUrl: `${scenarioGatewayUrl}/_canvas?daemon=${encodeURIComponent(`${scenarioGatewayUrl}/df`)}`,
      pageUrl: scenarioGatewayUrl,
      webUrl,
      daemonUrl: scenarioDaemonUrl,
      dataRoot: scenarioDataRoot,
      workspaceDir: scenarioWorkspace,
      log: (message) => log(`  ${scenarioId} · ${message}`),
      verbose,
      assert: (condition, name, detail) => {
        assertedSteps.push(
          detail === undefined
            ? { name, status: condition === true ? 'pass' : 'fail' }
            : { name, status: condition === true ? 'pass' : 'fail', detail },
        );
      },
      // 同源网关已让页面请求与 daemon 同源；钩子保留以对齐场景契约（no-op）。
      routeDaemon: async () => undefined,
    });
    steps = Array.isArray(result?.steps) ? result.steps : [];
  } catch (error) {
    steps = [{ name: '场景执行', status: 'fail', detail: String(error) }];
  } finally {
    await context.close();
    await scenarioGateway.close().catch(() => undefined);
    await scenarioDaemon.close().catch(() => undefined);
  }
  steps = assertStepsProduced(scenarioId, [...steps, ...assertedSteps]);

  for (const step of steps) {
    const mark = step.status === 'pass' ? '✓' : step.status === 'blocked' ? '⏸' : '✗';
    log(`  ${mark} ${step.name}${step.detail === undefined ? '' : ` —— ${step.detail}`}`);
  }
  return { id: scenarioId, title: scenarioTitle, dataRoot: scenarioDataRoot, steps, pageErrors };
}

// ---------------------------------------------------------------------------
// 编辑器真实门禁（D4）·定义段；主流程在「四之二」处调用
// ---------------------------------------------------------------------------

/**
 * 编辑器真实门禁（不再是「body 非空」）。
 *
 * 判定口径（任一不满足 → 该步骤 fail，退出码非零，绝不假绿）：
 * 1. `/canvaskit/canvaskit.js` 必须由站点真实提供（200）——构建前置失效时这里先红；
 * 2. `/editor` 必须挂上画布元素，并给出 **Skia 就绪信号**（`__dforgeCanvas.runtime().canvasKit === 'ready'`）；
 * 3. 必须**真的出帧**（`runtime().frameCount >= 1`，且最近一帧的渲染统计可读）；
 * 4. 编辑器页面不得有未捕获异常（pageerror）。
 *
 * 三态：`/editor` 路由缺失（404）→ blocked（前置未落地，退出码 2，与既有语义一致）；
 * 站点在、渲染坏 → fail（退出码 1）。
 */
async function runEditorGate(browser, urls) {
  const steps = [];
  const pageErrors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  // ① 资产可达（构建前置是否真的生效）
  let assetStatus = 0;
  try {
    assetStatus = (await page.request.get(`${urls.webUrl}/canvaskit/canvaskit.js`)).status();
  } catch (error) {
    pageErrors.push(`资产探测失败：${String(error)}`);
  }
  steps.push({
    name: '编辑器 · CanvasKit 资产可访问（/canvaskit/canvaskit.js）',
    status: assetStatus === 200 ? 'pass' : 'fail',
    detail: `HTTP ${String(assetStatus)}`,
  });

  // ② 路由可达（缺失 = blocked，不是「通过」）
  const editorUrl = `${urls.gatewayUrl}/editor?daemon=${encodeURIComponent(`${urls.gatewayUrl}/df`)}`;
  let routeStatus = 0;
  try {
    const response = await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    routeStatus = response === null ? 0 : response.status();
  } catch (error) {
    pageErrors.push(`/editor 打开失败：${String(error)}`);
  }
  if (routeStatus === 404) {
    steps.push({
      name: '编辑器 · /editor 路由可达',
      status: 'blocked',
      detail: '路由未落地（HTTP 404）',
    });
    await context.close();
    return { steps, pageErrors };
  }
  steps.push({
    name: '编辑器 · /editor 路由可达',
    status: routeStatus >= 200 && routeStatus < 400 ? 'pass' : 'fail',
    detail: `HTTP ${String(routeStatus)}`,
  });

  // ③ 画布元素挂载
  try {
    await page.waitForSelector('canvas[data-df-canvas]', { timeout: 30_000 });
    steps.push({ name: '编辑器 · 画布元素挂载', status: 'pass' });
  } catch (error) {
    steps.push({
      name: '编辑器 · 画布元素挂载',
      status: 'fail',
      detail: String(error).slice(0, 200),
    });
  }

  // ④ Skia 就绪信号（失败时带上调试句柄与页面上的失败提示，便于定位）
  try {
    await page.waitForFunction(
      () => globalThis.__dforgeCanvas?.runtime().canvasKit === 'ready',
      null,
      { timeout: 60_000 },
    );
    steps.push({ name: '编辑器 · Skia 就绪信号（canvasKit=ready）', status: 'pass' });
  } catch {
    const diagnostic = await page
      .evaluate(() => {
        const handle = globalThis.__dforgeCanvas;
        return handle === undefined
          ? { handle: null }
          : { handle: true, runtime: handle.runtime(), error: handle.error() };
      })
      .catch(() => null);
    const banner = await page
      .locator('[data-df-canvas-status="error"]')
      .innerText()
      .catch(() => null);
    steps.push({
      name: '编辑器 · Skia 就绪信号（canvasKit=ready）',
      status: 'fail',
      detail: `${JSON.stringify(diagnostic)} ${banner ?? ''}`.slice(0, 300),
    });
  }

  // ⑤ 首帧 + 渲染统计（断言「画了什么」而不是「页面有字」）
  try {
    await page.waitForFunction(
      () => (globalThis.__dforgeCanvas?.runtime().frameCount ?? 0) >= 1,
      null,
      { timeout: 60_000 },
    );
    steps.push({ name: '编辑器 · 首帧渲染完成（frameCount ≥ 1）', status: 'pass' });
  } catch (error) {
    steps.push({
      name: '编辑器 · 首帧渲染完成（frameCount ≥ 1）',
      status: 'fail',
      detail: String(error).slice(0, 200),
    });
  }
  const frame = await page
    .evaluate(() => {
      const handle = globalThis.__dforgeCanvas;
      return handle === undefined
        ? null
        : { runtime: handle.runtime(), stats: handle.stats(), nodeCount: handle.nodeCount() };
    })
    .catch(() => null);
  steps.push({
    name: '编辑器 · 渲染统计可读（帧内容被真实绘制）',
    status: frame === null || frame.stats === null || frame.stats === undefined ? 'fail' : 'pass',
    detail: JSON.stringify(frame).slice(0, 300),
  });

  // ⑥ 未捕获异常（编辑器整族不得在种子里抛错）
  steps.push({
    name: '编辑器 · 无未捕获异常（pageerror）',
    status: pageErrors.length === 0 ? 'pass' : 'fail',
    detail: pageErrors.join(' | ').slice(0, 300),
  });

  await context.close();
  return { steps, pageErrors };
}

try {
  mkdirSync(workspaceDir, { recursive: true });
  try {
    fixtureDaemon = await startFixtureDaemon({ dataRoot, workspaceDir });
  } catch (error) {
    evidence.daemon = { url: null, dataRoot, workspaceDir };
    console.error(
      ['阻塞：daemon 起不来（本 runner 需要真 daemon 才能跑主路径）。', String(error)].join('\n'),
    );
    await finish(evidence, 2);
  }
  daemonUrl = fixtureDaemon.url;
  log(`daemon 就绪：${daemonUrl}（数据根 ${dataRoot}）`);
  evidence.daemon = { url: daemonUrl, dataRoot, workspaceDir };

  // --- 站点（复用 DF_WEB_URL，或生产构建 + 起服务） ---
  webUrl = process.env.DF_WEB_URL ?? null;

  if (webUrl === null) {
    const webPort = await freePort();
    webUrl = `http://127.0.0.1:${webPort}`;
    const nextBin = join(repoRoot, 'apps/web/node_modules/.bin/next');
    if (!existsSync(nextBin)) {
      console.error('阻塞：未找到 next 可执行文件（先 pnpm install）。');
      await finish(evidence, 2);
    }

    // 构建前置：资产未就位 → 站点起来也是「Skia 初始化失败」的假绿。
    // 准备失败即阻塞（exit 2）：叠合 C 线「缺资产不得假绿」的口径，不把失败留到编辑器门禁才发现。
    if (!ensureCanvasKitAssets()) {
      console.error('阻塞：CanvasKit 资产准备失败（apps/web/public/canvaskit）。');
      await finish(evidence, 2);
    }

    const build = track(
      spawn(nextBin, ['build'], { cwd: join(repoRoot, 'apps/web'), stdio: 'inherit' }),
    );
    const buildCode = await new Promise((resolveBuild) => build.on('exit', resolveBuild));
    if (buildCode !== 0) {
      console.error('阻塞：web 构建失败（见上方 next build 输出）。');
      await finish(evidence, 2);
    }

    webServer = track(
      spawn(nextBin, ['start', '-p', String(webPort)], {
        cwd: join(repoRoot, 'apps/web'),
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
    webServer.stdout.on('data', (chunk) => {
      if (verbose) process.stdout.write(`[web] ${String(chunk)}`);
    });
    webServer.stderr.on('data', (chunk) => {
      if (verbose) process.stderr.write(`[web] ${String(chunk)}`);
    });
  }

  evidence.webUrl = webUrl;
  if (!(await waitForHttp(webUrl, 60_000, '站点'))) {
    console.error(`阻塞：站点不可达（${webUrl}）。`);
    await finish(evidence, 2);
  }
  log(`站点就绪：${webUrl}`);

  // --- 同源网关（还原架构 §3.1 的「Web 应用 ↑↓ 同源 HTTP」形态） ---
  gateway = await startSameOriginGateway({ webUrl, daemonUrl });
  const gatewayUrl = gateway.url;
  evidence.gatewayUrl = gatewayUrl;
  log(`同源网关就绪：${gatewayUrl}（/df/* → daemon，其余 → 站点）`);

  // --- 浏览器 + 场景执行 ---
  const chrome = resolveChrome();
  if (chrome === undefined) {
    console.error('阻塞：未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）。');
    await finish(evidence, 2);
  }

  const { chromium } = await import('playwright-core');
  try {
    browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  } catch (error) {
    console.error(`阻塞：Chromium 启动失败：${String(error)}`);
    await finish(evidence, 2);
  }

  const allSteps = [];
  for (const file of selected) {
    const scenarioStarted = Date.now();
    const scenario = await runScenario(file);
    // 尝试记录：每个场景只跑一次（不重试）。durationMs 用于 flake 统计的抖动观察。
    scenario.attempt = 1;
    scenario.durationMs = Date.now() - scenarioStarted;
    evidence.scenarios.push(scenario);
    allSteps.push(...scenario.steps);
  }

  // --- 四之二、编辑器真实门禁（D4：/editor 不再只看「body 非空」） ---
  log('编辑器门禁开始：/editor 真实渲染断言（资产 / Skia / 首帧 / 无异常）');
  const editorGateStarted = Date.now();
  const editorGate = await runEditorGate(browser, { webUrl, gatewayUrl });
  const editorGateDurationMs = Date.now() - editorGateStarted;
  for (const gateStep of editorGate.steps) {
    const mark = gateStep.status === 'pass' ? '✓' : gateStep.status === 'blocked' ? '⏸' : '✗';
    log(
      `  ${mark} ${gateStep.name}${gateStep.detail === undefined ? '' : ` —— ${gateStep.detail}`}`,
    );
  }
  evidence.editorGate = {
    steps: editorGate.steps,
    pageErrors: editorGate.pageErrors,
    attempt: 1,
    durationMs: editorGateDurationMs,
  };
  allSteps.push(...editorGate.steps);

  // --- 汇总与退出码 ---
  const failures = allSteps.filter((step) => step.status === 'fail');
  const blocked = allSteps.filter((step) => step.status === 'blocked');
  const passed = allSteps.filter((step) => step.status === 'pass');

  evidence.summary = {
    steps: allSteps.length,
    passed: passed.length,
    failed: failures.length,
    blocked: blocked.length,
    byScenario: evidence.scenarios.map((scenario) => ({
      id: scenario.id,
      steps: scenario.steps.length,
      passed: scenario.steps.filter((step) => step.status === 'pass').length,
      failed: scenario.steps.filter((step) => step.status === 'fail').length,
      blocked: scenario.steps.filter((step) => step.status === 'blocked').length,
      attempt: scenario.attempt,
      durationMs: scenario.durationMs,
    })),
  };
  // 尝试记录：本 runner 不重试；失败如实保留（4 条已知红见交接说明，不接必过门禁）。
  evidence.attempts = {
    policy: 'no-retry',
    maxAttemptsPerStep: 1,
    retriedSteps: 0,
    totalStepExecutions: allSteps.length,
    byScenario: evidence.scenarios.map((scenario) => ({
      id: scenario.id,
      attempt: scenario.attempt,
      steps: scenario.steps.length,
      durationMs: scenario.durationMs,
    })),
    editorGate: { attempt: 1, steps: editorGate.steps.length, durationMs: editorGateDurationMs },
  };

  if (failures.length > 0) {
    console.error(`失败：${failures.map((step) => step.name).join('、')}`);
    await finish(evidence, 1);
  }
  if (blocked.length > 0) {
    console.error(
      [
        `阻塞：${blocked.length} 个步骤未通过（前置未就绪，非本票缺陷）——`,
        ...blocked.map((step) => `  · ${step.name}：${step.detail ?? ''}`),
      ].join('\n'),
    );
    await finish(evidence, 2);
  }

  await finish(evidence, 0);
} catch (error) {
  // 未预期异常（含浏览器/网关中途失败）：先落证据再退出，绝不留残留进程。
  evidence.notes = [`未预期失败：${String(error)}`];
  console.error(`违规：runner 执行中断（${String(error)}）`);
  await finish(evidence, 1);
}
