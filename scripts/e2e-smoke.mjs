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
 * 退出码（三态，禁止假绿）：0 = 全部步骤通过；1 = 有步骤失败 / 场景空跑（契约违约）；
 * 2 = **阻塞**（daemon 起不来 / 站点起不来 / Chromium 缺失 / 场景标记 blocked）。
 * 任何退出路径都：先落证据 → 再清子进程（daemon / 站点 / 网关 / 浏览器）。
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

// ---------------------------------------------------------------------------
// 子进程登记与清理（任何退出路径都不得留残留进程）
// ---------------------------------------------------------------------------

/** 已登记的子进程（daemon / 站点）；`process.on('exit')` 兜底同步杀。 */
const children = new Set();
let webServer = null;
/** 当前场景的同源网关（逐场景起停；任何退出路径都由 shutdown() 兜底关掉）。 */
let gateway = null;
let browser = null;
/** 当前场景的夹具 daemon（逐场景起停；同上）。 */
let fixtureDaemon;
/** 站点地址（构建/复用后固定；场景执行函数经 ctx 读取）。 */
let webUrl = null;

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
  mkdirSync(runDir, { recursive: true });
  const evidencePath = join(runDir, `e2e-smoke-${stamp}.json`);
  writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  log(`证据：${evidencePath}`);
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

/**
 * 执行单个场景，返回它贡献的步骤（异常/导入失败都记 fail 步骤，不中断其余场景）。
 *
 * `scenarioContext` 是**本场景专属**的 daemon / 同源网关 / 数据根（见主流程「场景隔离」）：
 * 场景会写持久化状态（新建文档），共用一个数据根会让「空态」这类断言被前一个场景污染。
 */
async function runScenario(file, scenarioContext) {
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

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  /** 场景用 `ctx.assert` 记录的步骤（与场景自报的 steps 合并）。 */
  const assertedSteps = [];
  const gatewayUrl = scenarioContext.gatewayUrl;
  log(`场景开始：${scenarioTitle}（${scenarioId}）`);
  let steps = [];
  try {
    const result = await module.run(page, {
      // 页面走同源网关；`?daemon=` 指向网关下的 `/df`（同源，与生产形态一致）
      homeUrl: `${gatewayUrl}/?daemon=${encodeURIComponent(`${gatewayUrl}/df`)}`,
      canvasUrl: `${gatewayUrl}/_canvas?daemon=${encodeURIComponent(`${gatewayUrl}/df`)}`,
      pageUrl: gatewayUrl,
      webUrl,
      daemonUrl: scenarioContext.daemonUrl,
      dataRoot: scenarioContext.dataRoot,
      workspaceDir: scenarioContext.workspaceDir,
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
  }
  steps = assertStepsProduced(scenarioId, [...steps, ...assertedSteps]);

  for (const step of steps) {
    const mark = step.status === 'pass' ? '✓' : step.status === 'blocked' ? '⏸' : '✗';
    log(`  ${mark} ${step.name}${step.detail === undefined ? '' : ` —— ${step.detail}`}`);
  }
  await context.close();
  return { id: scenarioId, title: scenarioTitle, steps, pageErrors };
}

try {
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

    // CanvasKit 运行时资产（wasm 7.3MB + Noto 字体）是第三方二进制、不入库（.gitignore），
    // 由 copy 脚本从 node_modules 幂等落盘到 apps/web/public/canvaskit——画布场景的 Skia
    // 初始化依赖它（`/canvaskit/canvaskit.js`）。漏这步会让 canvas 场景恒定超时（假红）。
    const assets = track(
      spawn(
        process.execPath,
        [join(repoRoot, 'apps/web/src/features/canvas/tools/copy-canvaskit-assets.mjs')],
        { cwd: repoRoot, stdio: 'inherit' },
      ),
    );
    const assetsCode = await new Promise((resolveAssets) => assets.on('exit', resolveAssets));
    if (assetsCode !== 0) {
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

  // --- 浏览器（全场景共用一个实例；每个场景各自开 context） ---
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

  // --- 场景隔离：每个场景一套「夹具 daemon + 数据根 + 同源网关」 ---
  // 为什么不能共用一套：场景会写持久化状态（新建文档、拖画保存），共用数据根时后跑的场景
  // 会读到前一个场景的产物——实测 canvas 先跑会让 home 的「空态」断言假红（顺序耦合）。
  // 逐场景起停的代价只有 daemon 冷启（~1s），换来场景与文件顺序无关。
  evidence.daemon = {
    url: null,
    dataRoot,
    workspaceDir,
    note: '每个场景独立 daemon + 独立数据根 + 独立同源网关（场景之间不串持久化状态）',
  };

  const allSteps = [];
  for (const [index, file] of selected.entries()) {
    const scenarioName = file.replace(/\.mjs$/, '');
    const scenarioDataRoot = join(dataRoot, `scenario-${String(index + 1)}-${scenarioName}`);
    const scenarioWorkspace = join(scenarioDataRoot, 'workspace');
    mkdirSync(scenarioWorkspace, { recursive: true });

    let scenarioDaemon = null;
    let scenarioGateway = null;
    try {
      try {
        scenarioDaemon = await startFixtureDaemon({
          dataRoot: scenarioDataRoot,
          workspaceDir: scenarioWorkspace,
        });
      } catch (error) {
        // 第一个场景就起不来 = 真 daemon 不可用（前置不成立）→ 整体阻塞；
        // 后续场景失败则如实记 blocked 步骤，不吞掉其余场景。
        if (index === 0) {
          console.error(
            ['阻塞：daemon 起不来（本 runner 需要真 daemon 才能跑主路径）。', String(error)].join(
              '\n',
            ),
          );
          await finish(evidence, 2);
        }
        const blockedStep = {
          name: '夹具 daemon',
          status: 'blocked',
          detail: `daemon 起不来：${String(error)}`,
        };
        evidence.scenarios.push({
          id: scenarioName,
          title: file,
          steps: [blockedStep],
          pageErrors: [],
          dataRoot: scenarioDataRoot,
        });
        allSteps.push(blockedStep);
        continue;
      }

      fixtureDaemon = scenarioDaemon;
      gateway = await startSameOriginGateway({ webUrl, daemonUrl: scenarioDaemon.url });
      scenarioGateway = gateway;
      log(`daemon 就绪：${scenarioDaemon.url}（数据根 ${scenarioDataRoot}）· 网关 ${gateway.url}`);

      const scenario = await runScenario(file, {
        gatewayUrl: gateway.url,
        daemonUrl: scenarioDaemon.url,
        dataRoot: scenarioDataRoot,
        workspaceDir: scenarioWorkspace,
      });
      scenario.daemonUrl = scenarioDaemon.url;
      scenario.dataRoot = scenarioDataRoot;
      evidence.scenarios.push(scenario);
      allSteps.push(...scenario.steps);
    } finally {
      // 场景专属子进程随场景结束即清（不留在机器上等到整轮结束）。
      await scenarioGateway?.close().catch(() => undefined);
      gateway = null;
      await scenarioDaemon?.close().catch(() => undefined);
      fixtureDaemon = undefined;
    }
  }

  // --- 汇总与退出码 ---
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
