#!/usr/bin/env node
/**
 * audit:a11y —— 无障碍审计入口（#107 · 审计 10a）。
 *
 * 复用审计 04（#54）的 axe 口径：`scripts/lib/axe.mjs` 提供 axe-core 注入、WCAG 2.2 AA
 * tag 集合与 impact 计数；本脚本只负责「起真实链路 + 逐页跑 axe + 落证据 + 三态退出」。
 *
 * 覆盖页面：首页 / 编辑器 / 市场 / 设置（与审计 04 的 axe 目标一致，各页独立 context）。
 * 真实链路：临时数据根 + 自起 daemon + 生产构建站点（next build + next start）+ 同源网关
 * + 真 Chromium。不碰 3000/4318 与 `~/.dforge`。
 *
 * 退出码（三态）：
 *   0 = 达到阈值（默认 critical）的违规为 0；
 *   1 = 存在达到阈值的违规（真违规；如 #74/#75 未修复前默认为 known-red）；
 *   2 = 阻塞（构建/站点/daemon/Chromium 起不来）。
 *
 * 用法（仓库根执行）：
 *   pnpm audit:a11y                     # 生产构建 + 起站点
 *   pnpm audit:a11y --skip-build        # 复用现有 .next（e2e 刚构建过时）
 *   pnpm audit:a11y --fail-on serious   # 更严格（#74–#77 修复后使用）
 *   DF_EVIDENCE_DIR=~/df-evidence/audit-50/aud-60a pnpm audit:a11y
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { countImpacts, loadAxeSource, runAxe, WCAG_TAGS } from '../lib/axe.mjs';
import { resolveChromeExecutable } from '../lib/browser-toolchain.mjs';
import { freePort, startFixtureDaemon, startSameOriginGateway } from '../lib/gates.mjs';
import { seedMarketIndex } from '../lib/market-fixture.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB_DIR = join(REPO_ROOT, 'apps', 'web');
const EVIDENCE_ROOT = resolve(
  process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence', 'audit-50', 'aud-60a'),
);
const RUN_ID = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const RUN_DIR = join(EVIDENCE_ROOT, 'a11y', RUN_ID);
const AXE_DIR = join(RUN_DIR, 'axe');
const DATA_ROOT = join(RUN_DIR, 'data');
/** 首页文档卡夹具名（卡片链接 `aria-label="打开「…」"` 与可见标题/元信息不一致，是 F-04-05 的取证目标）。 */
const HOME_DOCUMENT_NAME = '无障碍审计文档';

const args = process.argv.slice(2);
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const verbose = args.includes('--verbose');
const skipBuild = args.includes('--skip-build');
const failOn = flagValue('--fail-on') ?? 'critical';
if (!['critical', 'serious', 'none'].includes(failOn)) {
  console.error(`用法错误：--fail-on 只接受 critical | serious | none（收到 ${failOn}）。`);
  process.exit(2);
}

const startedAt = new Date();
mkdirSync(AXE_DIR, { recursive: true });
mkdirSync(DATA_ROOT, { recursive: true });

const evidence = {
  ticket: '#107',
  gate: 'audit:a11y',
  source: '审计 04（#54）axe 口径：axe-core + WCAG 2.2 AA tags，真实浏览器逐页检查',
  kind: 'gate（critical 默认阻断；#74–#77 修复前按 known-red 记录）',
  startedAt: startedAt.toISOString(),
  failOn,
  tags: WCAG_TAGS,
  urls: {},
  pages: [],
  summary: null,
  notes: [],
  exitCode: 2,
};

const children = new Set();
let webServer = null;
let daemon = null;
let gateway = null;
let browser = null;

function log(message) {
  console.log(`[a11y] ${message}`);
}

function track(child) {
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

async function shutdown() {
  await gateway?.close().catch(() => undefined);
  gateway = null;
  await browser?.close().catch(() => undefined);
  browser = null;
  await daemon?.close().catch(() => undefined);
  daemon = null;
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
}

async function finish(code, blockedReason) {
  evidence.finishedAt = new Date().toISOString();
  evidence.exitCode = code;
  if (blockedReason !== undefined) {
    evidence.notes.push(`阻塞：${blockedReason}`);
    console.error(`阻塞：${blockedReason}`);
  }
  const summaryPath = join(RUN_DIR, 'a11y-summary.json');
  writeFileSync(summaryPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  log(`证据：${summaryPath}`);
  await shutdown();
  process.exit(code);
}

function ensureCanvasKitAssets() {
  const script = join(WEB_DIR, 'src', 'features', 'canvas', 'tools', 'copy-canvaskit-assets.mjs');
  const result = spawnSync(process.execPath, [script], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status === 0) {
    if (verbose) log(result.stdout.trim());
    return true;
  }
  console.error(`CanvasKit 资产准备失败：${result.stderr ?? String(result.error)}`);
  return false;
}

async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = '未发起请求';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
      last = `HTTP ${String(response.status)}`;
    } catch (error) {
      last = String(error);
    }
    await new Promise((done) => setTimeout(done, 300));
  }
  log(`${label} 等待超时（${last}）`);
  return false;
}

async function startWebSite() {
  const nextBin = join(WEB_DIR, 'node_modules', '.bin', 'next');
  if (!existsSync(nextBin)) throw new Error(`未找到 next 可执行文件：${nextBin}`);
  if (!ensureCanvasKitAssets()) throw new Error('CanvasKit 资产准备失败');

  if (!skipBuild) {
    log('生产构建：next build');
    const build = track(spawn(nextBin, ['build'], { cwd: WEB_DIR, stdio: 'inherit' }));
    const code = await new Promise((done) => build.on('exit', done));
    if (code !== 0) throw new Error(`web 构建失败（exit ${String(code)}）`);
  }

  const port = await freePort();
  const url = `http://127.0.0.1:${String(port)}`;
  log(`生产站点：next start -p ${String(port)}`);
  webServer = track(
    spawn(nextBin, ['start', '-p', String(port)], {
      cwd: WEB_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  webServer.stdout.on('data', (chunk) => {
    if (verbose) process.stdout.write(`[web] ${String(chunk)}`);
  });
  webServer.stderr.on('data', (chunk) => {
    if (verbose) process.stderr.write(`[web] ${String(chunk)}`);
  });
  if (!(await waitForHttp(url, 90_000, '生产站点'))) throw new Error('生产站点不可达');
  return url;
}

function daemonQuery(gatewayUrl) {
  return `daemon=${encodeURIComponent(`${gatewayUrl}/df`)}`;
}

/**
 * 经 daemon API 建一份文档，让首页渲染文档卡。
 *
 * 为什么必须先建文档：空数据根的首页只有空态，不含文档卡链接（`aria-label` 排除
 * 可见标题/元信息），axe 的 `label-content-name-mismatch` 在首页就无从命中——审计 04
 * 的 5 serious 里有首页这一条，早期 `audit:a11y` 漏掉它正是夹具缺文档所致。
 * 建文档失败按阻塞处理：否则首页扫描口径又退回「空首页」，计数不可比。
 */
async function seedHomeDocument(daemonUrl) {
  const response = await fetch(`${daemonUrl}/documents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: HOME_DOCUMENT_NAME }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) {
    throw new Error(
      `首页文档夹具创建失败（HTTP ${String(response.status)}）：${JSON.stringify(body).slice(0, 200)}`,
    );
  }
  log(`首页文档夹具：${body?.result?.document?.id ?? HOME_DOCUMENT_NAME}`);
}

async function waitCanvasReady(page) {
  await page.waitForSelector('canvas[data-df-canvas]', { timeout: 60_000 });
  await page.waitForFunction(
    () => globalThis.__dforgeCanvas?.runtime().canvasKit === 'ready',
    null,
    { timeout: 90_000 },
  );
  await page.waitForFunction(
    () => (globalThis.__dforgeCanvas?.runtime().frameCount ?? 0) >= 1,
    null,
    { timeout: 60_000 },
  );
}

async function auditPage(context, target, axeSource) {
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) {
      consoleErrors.push(message.text().slice(0, 300));
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${String(response.status())} ${response.url()}`);
    }
  });

  const waitWarnings = [];
  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  } catch (error) {
    waitWarnings.push(`打开页面失败：${String(error)}`);
  }
  if (target.waitFor !== undefined) {
    await page.waitForSelector(target.waitFor, { timeout: 30_000 }).catch((error) => {
      waitWarnings.push(`等待 ${target.waitFor} 失败：${String(error).slice(0, 200)}`);
    });
  }
  if (target.waitCanvas === true) {
    await waitCanvasReady(page).catch((error) => {
      waitWarnings.push(`画布就绪失败：${String(error).slice(0, 200)}`);
    });
  }
  await page.waitForTimeout(1200);

  const result = await runAxe(page, axeSource);
  const counts = countImpacts(result.violations);
  const summary = {
    page: target.name,
    url: target.url,
    waitFor: target.waitFor ?? null,
    waitWarnings,
    counts: {
      critical: counts.critical,
      serious: counts.serious,
      moderate: counts.moderate,
      minor: counts.minor,
      unknown: counts.unknown,
      violations: result.violations.length,
      incomplete: result.incomplete.length,
    },
    violations: result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary,
      })),
    })),
    incomplete: result.incomplete.map((item) => ({
      id: item.id,
      impact: item.impact,
      help: item.help,
      nodes: item.nodes.length,
    })),
    pageErrors,
    consoleErrors,
    failedResponses,
  };
  writeFileSync(join(AXE_DIR, `${target.name}.json`), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(
    join(AXE_DIR, `${target.name}-summary.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await page.close();
  return summary;
}

try {
  seedMarketIndex(DATA_ROOT);
  const workspaceDir = join(DATA_ROOT, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  daemon = await startFixtureDaemon({ dataRoot: DATA_ROOT, workspaceDir });
  evidence.urls.daemon = daemon.url;
  log(`daemon 就绪：${daemon.url}（数据根 ${DATA_ROOT}）`);

  // 首页扫描前先建文档卡（见 seedHomeDocument 注释）。
  await seedHomeDocument(daemon.url);

  const webUrl = process.env.DF_WEB_URL ?? (await startWebSite());
  evidence.urls.web = webUrl;
  log(`站点就绪：${webUrl}`);

  gateway = await startSameOriginGateway({ webUrl, daemonUrl: daemon.url });
  evidence.urls.gateway = gateway.url;
  log(`同源网关就绪：${gateway.url}`);

  const chrome = resolveChromeExecutable();
  if (chrome === undefined)
    throw new Error('未找到 Chromium 可执行文件（playwright-core 缓存缺失）');
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });

  const query = daemonQuery(gateway.url);
  const targets = [
    // 等文档卡出现：卡片链接是首页 `label-content-name-mismatch` 的取证目标。
    { name: 'home', url: `${gateway.url}/?${query}`, waitFor: '.dfg-home__card' },
    {
      name: 'editor',
      url: `${gateway.url}/editor?${query}`,
      waitCanvas: true,
    },
    {
      name: 'market',
      url: `${gateway.url}/market?${query}`,
      waitFor: '[data-df-market="card"]',
    },
    { name: 'settings', url: `${gateway.url}/settings?${query}`, waitFor: 'body' },
  ];
  const axeSource = loadAxeSource(REPO_ROOT);

  for (const target of targets) {
    log(`axe：${target.name}`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await auditPage(context, target, axeSource);
      evidence.pages.push(page);
      log(
        `  ${target.name}: critical=${page.counts.critical} serious=${page.counts.serious} ` +
          `moderate=${page.counts.moderate} minor=${page.counts.minor} ` +
          `(violations=${page.counts.violations})`,
      );
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  const totals = evidence.pages.reduce(
    (sum, page) => ({
      critical: sum.critical + page.counts.critical,
      serious: sum.serious + page.counts.serious,
      moderate: sum.moderate + page.counts.moderate,
      minor: sum.minor + page.counts.minor,
      unknown: sum.unknown + page.counts.unknown,
      violations: sum.violations + page.counts.violations,
    }),
    { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0, violations: 0 },
  );
  const allViolations = evidence.pages.flatMap((page) =>
    page.violations.map((violation) => ({
      page: page.page,
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
    })),
  );
  const thresholdViolations =
    failOn === 'none'
      ? []
      : allViolations.filter((violation) =>
          failOn === 'critical'
            ? violation.impact === 'critical'
            : violation.impact === 'critical' || violation.impact === 'serious',
        );
  evidence.summary = {
    pages: evidence.pages.length,
    totals,
    threshold: failOn,
    thresholdViolations: thresholdViolations.length,
    thresholdByRule: thresholdViolations,
    note:
      failOn === 'none'
        ? '仅取证：不以违规数决定退出码。'
        : 'critical 默认阻断；#74/#75 未修复前预期 exit 1（known-red，如实记录）。',
  };
  log(
    `合计：critical=${totals.critical} serious=${totals.serious} moderate=${totals.moderate} ` +
      `minor=${totals.minor}`,
  );
  if (thresholdViolations.length > 0) {
    console.error(
      `违规（${failOn}）：${thresholdViolations.map((item) => `${item.page}/${item.id}`).join('、')}`,
    );
    await finish(1);
  }
  await finish(0);
} catch (error) {
  await finish(2, String(error));
}
