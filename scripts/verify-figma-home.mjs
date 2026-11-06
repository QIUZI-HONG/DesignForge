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
 * 取证实现统一在 `scripts/lib/figma-evidence.mjs`（arch-04）：本脚本只声明**状态单元表 +
 * 每个状态的取样配方**（`RECIPES`），另以钩子承载夹具 daemon 与 `--sample-only`。
 *
 * **语义变化（arch-04 登记）**：Chromium 解析统一走 `lib/browser-toolchain.mjs` 的
 * `resolveChromeExecutable()`，即 `BENCH_CHROME_EXECUTABLE` **存在才采用**。此前本门禁
 * 对非法 env 会带病进入浏览器阶段（稍后崩），现在直接 exit 2 阻塞（与 lib 及 shell-parity 同口径）。
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
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { runFigmaGate } from './lib/figma-evidence.mjs';
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

/** 夹具 daemon + 同源网关（可选：给了 --fixture / DF_HOME_FIXTURE 才起）。 */
let pageOrigin = WEB_URL;
let daemon = null;
let gateway = null;
let shutDown = false;

/** 收尾：关网关与夹具 daemon（幂等；每条出口都会调）。 */
async function shutdown() {
  if (shutDown) return;
  shutDown = true;
  await gateway?.close();
  await daemon?.close();
}

await runFigmaGate({
  gateName: 'verify-figma-home',
  ticket: TICKET,
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
  extras: { webUrl: WEB_URL },
  stateCoverage: STATES.map((state) => ({ state, status: 'pending', recipe: state, note: '' })),
  recordKey: 'states',
  evidenceShape: 'state',
  referenceDir: REF_DIR,
  evidenceRoot: EVIDENCE_ROOT,
  url: () =>
    `${pageOrigin}${PAGE}${
      gateway === null
        ? ''
        : `?daemon=${encodeURIComponent(`${gateway.url}/df`)}` +
          (daemon === null || daemon === undefined
            ? ''
            : `&dfToken=${encodeURIComponent(daemon.token)}`)
    }`,
  only,
  onlyKey: 'state',
  units: STATES.map((state) => ({
    state,
    prepare: (page, ctx) => RECIPES[state](page, { url: ctx.url, state }),
  })),
  capture: {
    kind: 'page',
    goto: false,
    fontsAfterPrepare: true,
    settleMs: 120,
    sampleOnly,
  },
  // 参照图命名匹配：采集规范 `figma-B-<名称>-light-<状态>.png`（状态后缀）。
  referencePath: (unit, ctx) => {
    const hit = (ctx.reference?.files ?? []).find((name) => {
      const lower = name.toLowerCase();
      return (
        lower.startsWith('figma-b') &&
        lower.includes('light') &&
        lower.endsWith(`-${unit.state}.png`)
      );
    });
    return hit === undefined
      ? { path: null, label: `figma-B-*-light-${unit.state}.png` }
      : { path: join(REF_DIR, hit) };
  },
  context: { reducedMotion: 'reduce' },
  thresholds: { threshold: THRESHOLD, maxRatio },
  reference: {
    // `--sample-only` 的目的正是「参照集冻结**之前**先取样」：此时不判「未冻结」为阻塞，
    // 但仍以 exit 2 收尾（取样无判定 ≠ 通过）。
    when: sampleOnly ? 'skip' : 'early',
    message: (_ctx, reference) => [
      '阻塞：REF-01 未完成（Figma 参照集未冻结）。',
      `原因：${reference.reason}`,
      '待办：冻结参照集（命名 figma-B-<名称>-light-<状态>.png）后运行本门禁逐态取证；',
      '在此之前任何「通过」都是假绿。',
    ],
    onBlocked: (ctx) => {
      ctx.evidence.states = STATES.map((state) => ({ state, status: 'pending' }));
      ctx.evidence.stateCoverage = ctx.evidence.stateCoverage.map((item) => ({
        ...item,
        status: 'pending',
        note: 'REF-01（Figma 参照集冻结）未完成；本门禁按三态退出码记阻塞，禁止以近似图判绿。',
      }));
    },
  },
  probe: {
    url: WEB_URL,
    mode: 'follow',
    reason: (_ctx, result) => `站点不可达：${WEB_URL}${PAGE}（HTTP ${String(result.status)}）`,
    message: () => [
      '阻塞：首页站点不可达（本门禁需站点可访问）。',
      '提示：先起站点（如 pnpm --filter @dforge/web build && pnpm --filter @dforge/web start），',
      '或设置 DF_WEB_URL 指向已运行实例。',
    ],
  },
  chrome: {},
  hooks: {
    // 夹具 daemon + 同源网关（站点探测之后、Chromium 解析之前）。
    beforeBrowser: async (ctx) => {
      if (fixtureDir === undefined || fixtureDir.trim() === '') return;
      const fixtureRoot = resolve(fixtureDir);
      if (!existsSync(fixtureRoot)) {
        ctx.block({
          reason: `夹具工作目录不存在：${fixtureRoot}`,
          message: [`阻塞：夹具工作目录不存在（${fixtureRoot}）。`],
        });
        return;
      }
      try {
        daemon = await startFixtureDaemon({
          dataRoot: join(ctx.evidenceDir, 'fixture-data'),
          workspaceDir: fixtureRoot,
        });
      } catch (error) {
        ctx.block({
          reason: String(error),
          message: [`阻塞：夹具 daemon 起不来。\n${String(error)}`],
        });
        return;
      }
      gateway = await startSameOriginGateway({ webUrl: WEB_URL, daemonUrl: daemon.url });
      pageOrigin = gateway.url;
      ctx.evidence.fixture = {
        workspaceDir: fixtureRoot,
        daemonUrl: daemon.url,
        gatewayUrl: gateway.url,
      };
      ctx.log(`夹具 daemon：${daemon.url}；同源网关：${gateway.url}（/df/* → daemon）`);
    },
    afterUnits: async (ctx) => {
      if (sampleOnly) {
        ctx.evidence.sampledOnly = true;
        ctx.evidence.stateCoverage = ctx.evidence.stateCoverage.map((item) => ({
          ...item,
          status: 'sampled',
          note: '仅取样（供参照集采集会话对照）；无判定，故整体记阻塞。',
        }));
        ctx.block({
          message: [
            `取样完成：${String(ctx.targets.length)} 个状态 → ${join(ctx.evidenceDir, 'actual', 'home-light-*.png')}`,
            '阻塞：本次只取样、不做判定（取样 ≠ 通过；参照集冻结后再跑判定）。',
          ],
        });
        return;
      }
      ctx.evidence.stateCoverage = ctx.evidence.stateCoverage.map((item) => {
        const hit = ctx.evidence.states.find((entry) => entry.state === item.state);
        return {
          ...item,
          status: hit?.status ?? 'pending',
          note: hit === undefined ? '未取样。' : '已按配方真实驱动并取证（明细见 states）。',
        };
      });
    },
    cleanup: shutdown,
  },
  verbose,
  messages: {
    pass: (ctx) =>
      `通过：${String(ctx.targets.length)} 个状态全部在容差内（≤ ${(maxRatio * 100).toFixed(2)}%）。`,
    fail: (ctx) =>
      `违规：${String(ctx.failures)} 个状态超差/参照图缺失/配方失败（明细见证据 JSON）。`,
  },
});
