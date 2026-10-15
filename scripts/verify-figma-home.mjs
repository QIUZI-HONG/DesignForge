#!/usr/bin/env node
/**
 * verify-figma-home —— 首页对照门禁（FE-02 交付；本票范围内自管，**不接 CI**）。
 *
 * 对照面：首页 `/`（清单 B 区 · 对标页 · **浅色基准**）的页面级截图。
 * 参照集：`~/df-evidence/reference-v1/`（REF-01 冻结；命名按采集规范
 *   `figma-B-<名称>-<主题>-<状态>.png`，本门禁取状态后缀匹配）。
 * 判定：pixelmatch 8.0.0（threshold 0.1，忽略抗锯齿像素）→ 页面级差异像素率 ≤ `--max-ratio`
 *   （默认 0.001，即 A 级 0.1%）；字号/阴影/动效终态按 B 级人工复核登记。
 *
 * 状态覆盖（验收标准 §5）：每个状态都有**真实取样配方**（不是拼图）——
 *   default 直接载入；hover 悬停卡片；active 键盘聚焦卡片链接（focus-visible）；
 *   disabled 展开设置菜单后的禁用项；loading 用路由拦截压住 /documents；
 *   empty 指向空数据根；error 拦截 /documents 使其失败。
 *   无参照集时逐项记 `pending` 并整体 exit 2（禁止假绿）。
 *
 * 数据来源：默认直连站点（`DF_WEB_URL`）；给定 `--fixture <workspace 目录>` 时，门禁自己起一个
 * **夹具 daemon**（临时数据根 + 指定工作目录）并用**同源网关**把站点与 daemon 合成一个源——
 * 页面级对照要能与参照集对上，就必须让页面显示指定的样例数据（见 `scripts/lib/gates.mjs`）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-figma-home.mjs                    # 默认 http://127.0.0.1:3210
 *   DF_WEB_URL=http://127.0.0.1:3000 node scripts/verify-figma-home.mjs
 *   node scripts/verify-figma-home.mjs --sample-only --fixture ~/df-evidence/fe-02/fixture-workspace
 *   # ↑ 只取样（供 REF-01 参照集采集会话对照），无判定
 *
 * 环境变量：DF_WEB_URL（站点）、DF_HOME_FIXTURE（等同 --fixture）、DF_REF_DIR（参照集）、
 *           DF_EVIDENCE_DIR（证据根）、BENCH_CHROME_EXECUTABLE（Chromium 可执行文件）。
 *
 * 退出码（门禁三态，禁止假绿）：0 全部通过 / 1 有状态超差 / 2 **阻塞**
 * （参照集未冻结 / 站点不可达 / Chromium 或依赖缺失；`--sample-only` 恒为 2，因为取样无判定）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { startFixtureDaemon, startSameOriginGateway } from './lib/gates.mjs';

const WEB_URL = process.env.DF_WEB_URL ?? 'http://127.0.0.1:3210';
const REF_DIR = resolve(process.env.DF_REF_DIR ?? join(homedir(), 'df-evidence', 'reference-v1'));
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const TICKET = 'fe-02';
const THRESHOLD = 0.1;
const PAGE = '/';
/** 本页要取的状态（验收标准 §5 六态 + 默认态）。 */
const STATES = ['default', 'hover', 'active', 'disabled', 'loading', 'empty', 'error'];

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const sampleOnly = args.includes('--sample-only');
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = flagValue('--only');
const maxRatio = Number(flagValue('--max-ratio') ?? '0.001');
/** 夹具工作目录：给了就自己起 daemon + 同源网关（页面显示指定样例数据）。 */
const fixtureDir = flagValue('--fixture') ?? process.env.DF_HOME_FIXTURE;

const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const evidenceDir = join(EVIDENCE_ROOT, TICKET);
const evidencePath = join(evidenceDir, `verify-figma-home-${stamp}.json`);

/** 证据骨架（字段按《前端验收标准 v1》§4；阻塞时也落盘，记录待办）。 */
function baseEvidence() {
  return {
    ticket: 'FE-02',
    gate: 'verify-figma-home',
    page: PAGE,
    level: 'A（布局/几何/颜色；字形与阴影按 B 级人工复核）',
    theme: 'light（首页族浅色基准，验收标准 §3）',
    params: {
      threshold: THRESHOLD,
      maxRatio,
      engine: 'pixelmatch@8.0.0',
      aaIgnore: true,
      engineVersionNote: '升级比对库 = 重定基线（研究 #5 §3.4）',
    },
    viewport: { width: 1440, height: 900, dpr: 1.5 },
    startedAt: startedAt.toISOString(),
    webUrl: WEB_URL,
    referenceDir: REF_DIR,
    states: [],
    stateCoverage: STATES.map((state) => ({ state, status: 'pending', recipe: state, note: '' })),
    artifacts: {},
    humanReview: {
      verdict: 'pending',
      reviewer: null,
      reason: '自动判定只给 A 级结论；字形/阴影/动效终态按 B 级需人工复核登记。',
    },
    exitCode: 2,
  };
}

/** 落盘证据并结束进程。 */
function finish(evidence, code, message) {
  evidence.exitCode = code;
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (message) console.error(message);
  console.error(`证据：${evidencePath}`);
  process.exit(code);
}

/** `{sha256, length}` 指纹（大件入证据的约定）。 */
function fingerprint(filePath) {
  const buffer = readFileSync(filePath);
  return {
    path: filePath,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    length: buffer.length,
  };
}

/** 参照集探测：目录存在且有 PNG 才算「已冻结」。 */
function inspectReferenceDir() {
  if (!existsSync(REF_DIR)) return { ready: false, reason: `参照集目录不存在：${REF_DIR}` };
  const files = readdirSync(REF_DIR).filter((name) => name.endsWith('.png'));
  if (files.length === 0) return { ready: false, reason: `参照集为空（无 PNG）：${REF_DIR}` };
  return { ready: true, files };
}

/** 找某个状态的参照图（采集命名：`figma-B-<名称>-light-<状态>.png`）。 */
function referenceForState(files, state) {
  const hit = files.find((name) => {
    const lower = name.toLowerCase();
    return (
      lower.startsWith('figma-b') && lower.includes('light') && lower.endsWith(`-${state}.png`)
    );
  });
  return hit === undefined ? null : join(REF_DIR, hit);
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

/** 站点探测（不可达即阻塞，不猜）。 */
async function probeSite() {
  try {
    const response = await fetch(WEB_URL, { redirect: 'follow' });
    return { reachable: response.ok, status: response.status };
  } catch (error) {
    return { reachable: false, status: 0, error: String(error) };
  }
}

/**
 * 单个状态的取样配方（真实驱动界面进入该状态，不拼图、不摆拍）。
 * 返回 `{ annotate }`：取样后回填到证据里的现场事实（用于人工复核时确认状态真实成立）。
 */
const RECIPES = {
  async default(page, ctx) {
    await page.goto(ctx.url, { waitUntil: 'networkidle' });
    await page.waitForSelector('.dfg-home__topbar');
    return { annotate: { route: ctx.url } };
  },
  async hover(page, ctx) {
    await RECIPES.default(page, ctx);
    const card = page.locator('.dfg-home__card').first();
    if ((await card.count()) === 0) return { annotate: { skipped: '无卡片（数据根为空）' } };
    await card.hover();
    await card.locator('.dfg-home__card-menu button').first().waitFor({ state: 'visible' });
    return { annotate: { revealed: '卡片「…」菜单' } };
  },
  async active(page, ctx) {
    await RECIPES.default(page, ctx);
    const link = page.locator('.dfg-home__card-link').first();
    if ((await link.count()) === 0) return { annotate: { skipped: '无卡片（数据根为空）' } };
    // 键盘聚焦（Tab 进页面后落到卡片上），走 :focus-visible 路径
    await page.keyboard.press('Tab');
    await link.focus();
    return { annotate: { focus: '卡片链接（focus-visible）' } };
  },
  async disabled(page, ctx) {
    await RECIPES.default(page, ctx);
    await page.getByRole('button', { name: '设置与帮助' }).click();
    await page.getByRole('menuitem', { name: '设置' }).waitFor();
    return { annotate: { menu: '设置下拉（禁用项带理由提示）' } };
  },
  async loading(page, ctx) {
    // 压住文档列表请求：页面停在加载态（骨架），请求本身仍会发出
    await page.route('**/documents', async (route) => {
      await new Promise((done) => setTimeout(done, 4000));
      await route.continue();
    });
    await page.goto(ctx.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[aria-busy="true"]');
    return { annotate: { intercept: '延迟 /documents 4s' } };
  },
  async empty(page, ctx) {
    // 空数据根：daemon 用临时目录起（与本门禁的 e2e 口径一致），由调用方经 `?daemon=` 指向
    await RECIPES.default(page, ctx);
    const shown = await page.getByText('还没有设计文件').count();
    return { annotate: { emptyState: shown > 0 ? '无文件空态' : '数据根非空（配方未成立）' } };
  },
  async error(page, ctx) {
    await page.route('**/documents', (route) => route.abort());
    await page.goto(ctx.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.dfg-state--error');
    return { annotate: { intercept: '阻断 /documents' } };
  },
};

const evidence = baseEvidence();
const reference = inspectReferenceDir();

// `--sample-only` 的目的正是「参照集冻结**之前**先取样」：此时不判「未冻结」为阻塞，
// 但仍以 exit 2 收尾（取样无判定 ≠ 通过）。
if (!reference.ready && !sampleOnly) {
  evidence.blockedReason = reference.reason;
  evidence.states = STATES.map((state) => ({ state, status: 'pending' }));
  evidence.stateCoverage = evidence.stateCoverage.map((item) => ({
    ...item,
    status: 'pending',
    note: 'REF-01（Figma 参照集冻结）未完成；本门禁按三态退出码记阻塞，禁止以近似图判绿。',
  }));
  finish(
    evidence,
    2,
    [
      '阻塞：REF-01 未完成（Figma 参照集未冻结）。',
      `原因：${reference.reason}`,
      '待办：冻结参照集（命名 figma-B-<名称>-light-<状态>.png）后运行本门禁逐态取证；',
      '在此之前任何「通过」都是假绿。',
    ].join('\n'),
  );
}

const site = await probeSite();
if (!site.reachable) {
  evidence.blockedReason = `站点不可达：${WEB_URL}${PAGE}（HTTP ${String(site.status)}）`;
  finish(
    evidence,
    2,
    [
      '阻塞：首页站点不可达（本门禁需站点可访问）。',
      '提示：先起站点（如 pnpm --filter @dforge/web build && pnpm --filter @dforge/web start），',
      '或设置 DF_WEB_URL 指向已运行实例。',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// 夹具 daemon + 同源网关（可选：给了 --fixture / DF_HOME_FIXTURE 才起）
// ---------------------------------------------------------------------------

let pageOrigin = WEB_URL;
let daemon = null;
let gateway = null;

if (fixtureDir !== undefined && fixtureDir.trim() !== '') {
  const fixtureRoot = resolve(fixtureDir);
  if (!existsSync(fixtureRoot)) {
    evidence.blockedReason = `夹具工作目录不存在：${fixtureRoot}`;
    finish(evidence, 2, `阻塞：夹具工作目录不存在（${fixtureRoot}）。`);
  }
  try {
    daemon = await startFixtureDaemon({
      dataRoot: join(evidenceDir, 'fixture-data'),
      workspaceDir: fixtureRoot,
    });
  } catch (error) {
    evidence.blockedReason = String(error);
    finish(evidence, 2, `阻塞：夹具 daemon 起不来。\n${String(error)}`);
  }
  gateway = await startSameOriginGateway({ webUrl: WEB_URL, daemonUrl: daemon.url });
  pageOrigin = gateway.url;
  evidence.fixture = { workspaceDir: fixtureRoot, daemonUrl: daemon.url, gatewayUrl: gateway.url };
  console.error(`夹具 daemon：${daemon.url}；同源网关：${gateway.url}（/df/* → daemon）`);
}

/** 页面地址（走网关时带 `?daemon=`；同源，与生产形态一致）。 */
const pageUrl = `${pageOrigin}${PAGE}${
  gateway === null ? '' : `?daemon=${encodeURIComponent(`${gateway.url}/df`)}`
}`;

/** 收尾：关网关与夹具 daemon。 */
async function shutdown() {
  await gateway?.close();
  await daemon?.close();
}

const chrome = resolveChrome();
if (chrome === undefined) {
  await shutdown();
  evidence.blockedReason = '未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）';
  finish(
    evidence,
    2,
    '阻塞：未找到 Chromium 可执行文件（研究 #5：playwright-core 需显式 executablePath）。',
  );
}

const { chromium } = await import('playwright-core');
const { PNG } = await import('pngjs');
const pixelmatch = (await import('pixelmatch')).default;

const actualDir = join(evidenceDir, 'actual');
const diffDir = join(evidenceDir, 'diff');
mkdirSync(actualDir, { recursive: true });
mkdirSync(diffDir, { recursive: true });

const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
const context = await browser.newContext({
  viewport: { width: evidence.viewport.width, height: evidence.viewport.height },
  deviceScaleFactor: evidence.viewport.dpr,
  reducedMotion: 'reduce',
});

const targets = only === undefined ? STATES : STATES.filter((state) => state === only);
let failures = 0;

for (const state of targets) {
  const page = await context.newPage();
  const url = pageUrl;
  let annotate = {};
  try {
    const result = await RECIPES[state](page, { url, state });
    annotate = result?.annotate ?? {};
    // 字体就绪后再取样（ADR-0003：禁止静默回退；字体未就绪的截图一律不可作判据）
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);
  } catch (error) {
    failures += 1;
    evidence.states.push({ state, status: 'recipe-failed', reason: String(error) });
    if (verbose) console.error(`  ✗ ${state}：取样配方失败（${String(error)}）`);
    await page.close();
    continue;
  }

  const actualPath = join(actualDir, `home-light-${state}.png`);
  await page.screenshot({ path: actualPath, animations: 'disabled' });

  if (sampleOnly) {
    evidence.states.push({
      state,
      status: 'sampled',
      annotate,
      artifacts: { actual: fingerprint(actualPath) },
    });
    await page.close();
    continue;
  }

  const refPath = referenceForState(reference.files, state);
  if (refPath === null) {
    failures += 1;
    evidence.states.push({
      state,
      status: 'missing-reference',
      annotate,
      reference: `figma-B-*-light-${state}.png`,
    });
    await page.close();
    continue;
  }

  const refPng = PNG.sync.read(readFileSync(refPath));
  const actualPng = PNG.sync.read(readFileSync(actualPath));
  if (refPng.width !== actualPng.width || refPng.height !== actualPng.height) {
    failures += 1;
    evidence.states.push({
      state,
      status: 'size-mismatch',
      annotate,
      reference: { width: refPng.width, height: refPng.height },
      actual: { width: actualPng.width, height: actualPng.height },
    });
    await page.close();
    continue;
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
  const diffPath = join(diffDir, `home-light-${state}.png`);
  writeFileSync(diffPath, PNG.sync.write(diffPng));

  const status = ratio <= maxRatio ? 'pass' : 'fail';
  if (status === 'fail') failures += 1;
  evidence.states.push({
    state,
    status,
    annotate,
    diff: { diffPixels, totalPixels: total, ratio: Number(ratio.toFixed(6)), bbox: null },
    artifacts: {
      ref: fingerprint(refPath),
      actual: fingerprint(actualPath),
      diff: fingerprint(diffPath),
    },
  });
  if (verbose)
    console.error(
      `  ${status === 'pass' ? '✓' : '✗'} ${state}：差异率 ${(ratio * 100).toFixed(4)}%`,
    );
  await page.close();
}

await browser.close();
await shutdown();

if (sampleOnly) {
  evidence.sampledOnly = true;
  evidence.stateCoverage = evidence.stateCoverage.map((item) => ({
    ...item,
    status: 'sampled',
    note: '仅取样（供参照集采集会话对照）；无判定，故整体记阻塞。',
  }));
  finish(
    evidence,
    2,
    [
      `取样完成：${String(targets.length)} 个状态 → ${join(actualDir, 'home-light-*.png')}`,
      '阻塞：本次只取样、不做判定（取样 ≠ 通过；参照集冻结后再跑判定）。',
    ].join('\n'),
  );
}

evidence.stateCoverage = evidence.stateCoverage.map((item) => {
  const hit = evidence.states.find((entry) => entry.state === item.state);
  return {
    ...item,
    status: hit?.status ?? 'pending',
    note: hit === undefined ? '未取样。' : '已按配方真实驱动并取证（明细见 states）。',
  };
});

const code = failures === 0 ? 0 : 1;
finish(
  evidence,
  code,
  failures === 0
    ? `通过：${String(targets.length)} 个状态全部在容差内（≤ ${(maxRatio * 100).toFixed(2)}%）。`
    : `违规：${String(failures)} 个状态超差/参照图缺失/配方失败（明细见证据 JSON）。`,
);
