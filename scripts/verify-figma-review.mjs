#!/usr/bin/env node
/**
 * verify-figma-review —— 评审特性对照门禁（FE-07 交付；本票范围内自管，**不接 CI**）。
 *
 * 对照面（C12 / C13 / C14 · F7 / F10）：编辑器里的三块评审面
 * —— 评论钉点/线程、Present 浮层、版本抽屉与并排对比，
 * 以及《前端验收标准 v1》§5 的六态挂点（hover / active(focus-visible) / disabled /
 * loading / empty / error）。
 *
 * 取样口径：**组件完整边界 + 固定留白**（钉点/控制条/抽屉逐单元取样），
 * 两侧（参照集与实际）同一 DPR（1.5，与《前端验收标准 v1》§3 一致）；
 * 交互断言（非像素）走 `data-df-*` 挂点：评论钉点位置随视口换算、Present 键盘翻页与边界、
 * 版本恢复两步确认——这些断言在参照集未冻结时也会先跑，失败即 exit 1（逻辑缺陷不等参照集）。
 *
 * 判定：pixelmatch 8.0.0（threshold 0.1）+ pngjs 逐单元比对，差异像素率 ≤ `--max-ratio` 通过。
 *
 * 退出码（三态，**禁止假绿**）：
 *   0 = 全部通过；
 *   1 = 交互断言失败 / 有单元超差或参照图缺失（参照集已冻结的前提下）；
 *   2 = **阻塞**——参照集未冻结（REF-01 未完成）/ 站点不可达 / 未找到 Chromium /
 *       或取样单元在宿主页上还取不到（记录为 pending，绝不计为通过）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-figma-review.mjs                       # 默认 http://127.0.0.1:3210/editor
 *   DF_REVIEW_URL=http://127.0.0.1:3000/editor node scripts/verify-figma-review.mjs
 *   node scripts/verify-figma-review.mjs --only comments/pins --verbose
 *
 * 环境变量：DF_WEB_URL（站点根，默认 http://127.0.0.1:3210）、DF_REVIEW_URL（评审页，优先）、
 *           DF_REF_DIR（参照集根，默认 ~/df-evidence/reference-v1，评审参照放在其 review/ 子目录）、
 *           DF_EVIDENCE_DIR（证据根，默认 ~/df-evidence）、
 *           BENCH_CHROME_EXECUTABLE（Chromium 可执行文件；否则自动探测缓存）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { resolveChromeExecutable as resolveChrome } from './lib/browser-toolchain.mjs';
import { bboxOfDiff } from './lib/pixels.mjs';

const WEB_URL = process.env.DF_WEB_URL ?? 'http://127.0.0.1:3210';
const REVIEW_URL = process.env.DF_REVIEW_URL ?? `${WEB_URL}/editor`;
const REF_ROOT = resolve(process.env.DF_REF_DIR ?? join(homedir(), 'df-evidence', 'reference-v1'));
/** 评审参照集子目录：与页面级/面板级取样名空间隔离。 */
const REF_DIR = join(REF_ROOT, 'review');
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const TICKET = 'fe-07';
const THRESHOLD = 0.1;
/** 取样留白（组件边界外扩；spec：组件级取样统一 8px）。 */
const MARGIN = 8;
const STATES = ['hover', 'active', 'disabled', 'loading', 'empty', 'error'];

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = flagValue('--only');
const maxRatio = Number(flagValue('--max-ratio') ?? '0.001');

const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const evidenceDir = join(EVIDENCE_ROOT, TICKET);
const evidencePath = join(evidenceDir, `verify-figma-review-${stamp}.json`);

/**
 * 取样单元：`root` 取组件边界；`prepare` 把宿主页推进到该状态。
 * prepare 拿不到目标（宿主还没提供）即抛错 → 记 pending + exit 2，绝不算通过。
 *
 * 宿主前置（FE-03 接线时需满足，否则对应单元记 pending）：
 * - 评论类单元要求**文档里有至少一条评论**（空文档只有落点按钮，没有钉点）；
 * - 版本类单元要求宿主可点「保存当前版本」（本门禁的 prepare 自己点，无需预置）；
 * - 六态里 disabled / loading / error 本票三块**没有对应状态**（本地存储同步、无网络等待），
 *   stateCoverage 会如实记为 missing——不是「通过」，是待办。
 */
const SAMPLES = [
  {
    id: 'comments/pins',
    root: '[data-df-comment-layer]',
    note: '评论模式下的钉点层（含一条真实发布的评论；钉点按世界坐标换算定位）',
    prepare: async (page) => {
      await enterCommentMode(page);
      await createComment(page, '这里的间距太大了');
    },
  },
  {
    id: 'comments/pin-hover',
    root: '[data-df-comment-pin][data-df-state="hover"]',
    note: '钉点悬停展开（验收 §5 hover 挂点：data-df-state="hover"）',
    prepare: async (page) => {
      await enterCommentMode(page);
      await createComment(page, '标题层级有点乱');
      await page.locator('[data-df-comment-pin]').first().hover();
      await page.waitForSelector('[data-df-comment-pin][data-df-state="hover"]', { timeout: 3000 });
    },
  },
  {
    id: 'comments/thread-panel',
    root: '[data-df-panel="comments"]',
    note: '线程面板（未解决列表 + 回复/解决操作；含一条真实评论）',
    prepare: async (page) => {
      await enterCommentMode(page);
      await createComment(page, '这条要留到评审看');
    },
  },
  {
    id: 'comments/resolved-collapsed',
    root: '[data-df-sample="comments/resolved"]',
    note: '已解决段默认折叠（C12 要点：已解决折叠）',
    prepare: async (page) => {
      await enterCommentMode(page);
      await createComment(page, '已经处理完的问题');
      // 发布后该线程即处于激活态 → 面板里点「解决」把它移进折叠段
      await page
        .getByRole('button', { name: '解决', exact: true })
        .first()
        .click({ timeout: 3000 });
      await page.waitForSelector('[data-df-sample="comments/resolved"]', { timeout: 3000 });
    },
  },
  {
    id: 'comments/empty',
    root: '[data-df-sample="comments/empty"]',
    note: '空态（无评论；验收 §5 empty）',
    prepare: async (page) => {
      await enterCommentMode(page);
    },
  },
  {
    id: 'present/stage',
    root: '[data-df-presenter]',
    note: 'Present 浮层（黑底 + 顶部悬浮控制条）',
    prepare: async (page) => {
      // 顶栏「演示」入口（FE-03 预留 id）：**需要文档里有画板才可点**（FE-06 接入后满足）
      await page.getByRole('button', { name: '演示' }).first().click({ timeout: 3000 });
      await page.waitForSelector('[data-df-presenter]', { timeout: 3000 });
    },
  },
  {
    id: 'present/controls-hidden',
    root: '[data-df-present-controls][data-df-state="hidden"]',
    note: '控制条自动隐藏（静止超时后 data-df-state="hidden"）',
    prepare: async (page) => {
      await page.getByRole('button', { name: '演示' }).first().click({ timeout: 3000 });
      // 等自动隐藏窗口走完（3s 阈值 + 500ms 推进间隔，留 1s 余量）
      await page.waitForSelector('[data-df-present-controls][data-df-state="hidden"]', {
        timeout: 6000,
      });
    },
  },
  {
    id: 'present/empty',
    root: '[data-df-sample="present/empty"]',
    note: '空态（无画板可演示；验收 §5 empty）',
  },
  {
    id: 'versions/drawer',
    root: '[data-df-versions-root]',
    note: '版本抽屉（时间戳列表）',
    prepare: async (page) => {
      // 顶栏入口（FE-03 预留 id，FE-07 注册后点亮）；抽屉经 portal 挂到 body
      await page.getByRole('button', { name: '版本历史' }).first().click({ timeout: 3000 });
      await page.waitForSelector('[role="dialog"]', { timeout: 3000 });
    },
  },
  {
    id: 'versions/compare',
    root: '[data-df-version-compare]',
    note: '并排对比（F10 第一步；恢复两步确认的第一击）',
    prepare: async (page) => {
      await page.getByRole('button', { name: '版本历史' }).first().click({ timeout: 3000 });
      await page.locator('[data-df-version-capture]').first().click({ timeout: 3000 });
      await page.locator('[data-df-version-row] button', { hasText: '对比' }).first().click();
      await page.waitForSelector('[data-df-version-compare]', { timeout: 3000 });
    },
  },
  {
    id: 'versions/empty',
    root: '[data-df-sample="versions/empty"]',
    note: '空态（无版本；验收 §5 empty）',
  },
  {
    id: 'versions/row-hover',
    root: '[data-df-version-row][data-df-state="hover"]',
    note: '版本行悬停（验收 §5 hover；需宿主预置至少一条版本）',
    prepare: async (page) => {
      await page.getByRole('button', { name: '版本历史' }).first().click({ timeout: 3000 });
      await page.locator('[data-df-version-capture]').first().click({ timeout: 3000 });
      await page.locator('[data-df-version-row]').first().hover();
      await page.waitForSelector('[data-df-version-row][data-df-state="hover"]', { timeout: 3000 });
    },
  },
];

/**
 * 交互断言（非像素）：`data-df-*` 挂点上的逻辑行为，参照集冻结与否都要过。
 * 三态语义：
 * - `passed` 过；`failed` = 逻辑缺陷（exit 1）；
 * - `skipped` = 前置不成立（宿主还没接上，如「文档里没有画板 → 演示入口禁用」）——
 *   如实记录并**阻塞（exit 2）**，绝不算通过（禁假绿）。
 */
const INTERACTIONS = [
  {
    id: 'comments/pin-follows-viewport',
    note: '评论钉点位置 = 世界坐标 → 屏幕换算（缩放/平移跟随）',
    run: async (page) => {
      await enterCommentMode(page);
      await createComment(page, '跟随缩放的钉点');
      const pin = page.locator('[data-df-comment-pin]').first();
      await pin.waitFor({ timeout: 3000 });
      const before = await pin.boundingBox();
      if (before === null) return { status: 'failed', reason: '钉点没有包围盒' };
      // 走壳层真实缩放入口（FE-03 的缩放菜单；FE-07 的会话把外壳 zoom 桥成视口来源）
      const trigger = page.locator('[data-df-zoom]').first();
      if ((await trigger.count()) === 0) {
        return { status: 'skipped', reason: '宿主未提供缩放入口（[data-df-zoom]）' };
      }
      await trigger.click({ timeout: 3000 });
      await page.getByRole('menuitem', { name: '200%' }).first().click({ timeout: 3000 });
      await page.keyboard.press('Escape');
      const after = await pin.boundingBox();
      if (after === null) return { status: 'failed', reason: '缩放后钉点消失' };
      const moved = Math.abs(after.x - before.x) > 1 || Math.abs(after.y - before.y) > 1;
      return moved
        ? {
            status: 'passed',
            note: `100%→200% 钉点位移 Δ=(${(after.x - before.x).toFixed(1)}, ${(after.y - before.y).toFixed(1)})`,
          }
        : { status: 'failed', reason: '缩放后钉点未跟随（位置未变）' };
    },
  },
  {
    id: 'present/keyboard-paging',
    note: 'Present ←/→ 翻页且边界不越界、Esc 退出',
    run: async (page) => {
      const entry = page.getByRole('button', { name: '演示' }).first();
      if (await entry.isDisabled()) {
        return {
          status: 'skipped',
          reason: '演示入口禁用：文档里没有画板（FE-06 画布/文档接入前为空文档）',
        };
      }
      await entry.click({ timeout: 3000 });
      await page.waitForSelector('[data-df-presenter]', { timeout: 3000 });
      const indexOf = async () =>
        Number(await page.locator('[data-df-presenter]').getAttribute('data-df-slide-index'));
      await page.keyboard.press('ArrowLeft');
      const first = await indexOf();
      if (first !== 0) return { status: 'failed', reason: `首张 ← 越界：index=${String(first)}` };
      await page.keyboard.press('ArrowRight');
      const second = await indexOf();
      if (second !== first + 1) return { status: 'failed', reason: '→ 未翻页' };
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      const last = await indexOf();
      await page.keyboard.press('ArrowRight');
      const stillLast = await indexOf();
      if (stillLast !== last) return { status: 'failed', reason: '末张 → 越界' };
      await page.keyboard.press('Escape');
      if ((await page.locator('[data-df-presenter]').count()) !== 0) {
        return { status: 'failed', reason: 'Esc 未退出演示' };
      }
      return { status: 'passed' };
    },
  },
  {
    id: 'versions/two-step-confirm',
    note: '版本恢复两步确认：对比不动文档、确认才回滚',
    run: async (page) => {
      await page.getByRole('button', { name: '版本历史' }).first().click({ timeout: 3000 });
      await page.locator('[data-df-version-capture]').first().click({ timeout: 3000 });
      const row = page.locator('[data-df-version-row]').first();
      await row.waitFor({ timeout: 3000 });
      const snapshotVisible = (await row.count()) === 1;
      if (!snapshotVisible) return { status: 'failed', reason: '保存版本后列表没有条目' };
      await page.locator('[data-df-version-row] button', { hasText: '对比' }).first().click();
      await page.waitForSelector('[data-df-version-compare]', { timeout: 3000 });
      await page.locator('[data-df-version-confirm]').first().click({ timeout: 3000 });
      const closed = (await page.locator('[data-df-version-compare]').count()) === 0;
      return closed ? { status: 'passed' } : { status: 'failed', reason: '确认后对比视图未关闭' };
    },
  },
];

/**
 * 进评论模式：顶栏预留入口 `review.comment.toggle`（FE-07 注册后点亮；
 * 未注册时入口禁用——点击会超时，该单元如实记 pending）。
 */
async function enterCommentMode(page) {
  await page.getByRole('button', { name: '评论' }).first().click({ timeout: 3000 });
  await page.waitForSelector('[data-df-comment-surface]', { timeout: 3000 });
}

/**
 * 走真实用户路径发一条评论：点画布落草稿 → 填文案 → 发布。
 * 落点带上偏移，避免多条评论叠在同一坐标（钉点会互相贴住，截图不可判）。
 */
async function createComment(page, text) {
  const surface = page.locator('[data-df-comment-surface]').first();
  await surface.click({ position: { x: 120, y: 90 }, timeout: 3000 });
  const input = page.locator('[data-df-comment-draft] textarea').first();
  await input.waitFor({ timeout: 3000 });
  await input.fill(text);
  await page.locator('[data-df-comment-draft] button', { hasText: '发布' }).first().click();
  await page.waitForSelector('[data-df-comment-pin]', { timeout: 3000 });
}

/** 证据骨架（字段按《前端验收标准 v1》§4；阻塞时也落盘，记录待办）。 */
function baseEvidence() {
  return {
    ticket: 'FE-07',
    gate: 'verify-figma-review',
    page: REVIEW_URL,
    level: 'A（布局/几何/颜色；字形与阴影按 B 级人工复核）',
    params: {
      threshold: THRESHOLD,
      maxRatio,
      engine: 'pixelmatch@8.0.0',
      aaIgnore: true,
      margin: MARGIN,
      engineVersionNote: '升级比对库 = 重定基线（研究 #5 §3.4）',
    },
    viewport: { width: 1440, height: 900, dpr: 1.5 },
    startedAt: startedAt.toISOString(),
    webUrl: WEB_URL,
    reviewUrl: REVIEW_URL,
    referenceDir: REF_DIR,
    samples: [],
    interactions: [],
    stateCoverage: STATES.map((state) => ({ state, samples: [], status: 'pending' })),
    artifacts: {},
    humanReview: {
      verdict: 'pending',
      reviewer: null,
      reason: '自动判定只给 A 级结论；字形/阴影/动效终态（含恢复流程录屏）按 B 级需人工复核登记。',
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

/** `{sha256, length}` 指纹。 */
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

/** 站点探测（不可达即阻塞，不猜）。 */
async function probeSite(url) {
  try {
    const response = await fetch(url, { redirect: 'manual' });
    return { reachable: response.status < 500, status: response.status };
  } catch (error) {
    return { reachable: false, status: 0, error: String(error) };
  }
}

const evidence = baseEvidence();

// —— 第一道：参照集探测（只探测不即退：交互断言与参照集无关，先跑出真实信号）。 ——
const reference = inspectReferenceDir();

// —— 第二道：评审面是否已挂载（FE-03 的编辑器路由接线）。 ——
const site = await probeSite(REVIEW_URL);
if (!site.reachable) {
  evidence.blockedReason = `评审页不可达：${REVIEW_URL}（HTTP ${String(site.status)}）`;
  finish(
    evidence,
    2,
    [
      '阻塞：评审页不可达（本门禁需评审面可访问）。',
      '提示：先起站点（如 pnpm --filter @dforge/web build && pnpm --filter @dforge/web start），',
      '或设置 DF_REVIEW_URL 指向已挂载评审面的页面。',
    ].join('\n'),
  );
}

const chrome = resolveChrome();
if (chrome === undefined) {
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
});
const page = await context.newPage();
await page.goto(REVIEW_URL, { waitUntil: 'networkidle' });
// 字体就绪后再取样（ADR-0003：禁止静默回退；字体未就绪的截图一律不可作判据）
await page.evaluate(() => document.fonts.ready);

// 等水合：插槽注册在客户端模块求值期发生，SSR 首屏还没有评审面
await page
  .waitForSelector('[data-df-comment-layer], [data-df-versions-root]', {
    state: 'attached',
    timeout: 8000,
  })
  .catch(() => null);
const mounted = await page.locator('[data-df-comment-layer], [data-df-versions-root]').count();
if (mounted === 0) {
  await browser.close();
  evidence.blockedReason = `页面未挂载评审面（找不到 [data-df-comment-layer]/[data-df-versions-root]）：${REVIEW_URL}`;
  finish(
    evidence,
    2,
    [
      '阻塞：宿主页未挂载评论层 / 版本抽屉。',
      '待办：FE-03 编辑器壳在编辑器路由挂载 `features/editor-review` 的组件',
      '（CommentLayer 进画布区域；CommentsModeToggle / PresentButton / VersionsButton 进顶栏插槽；',
      'VersionsDrawer 与 Presenter 挂布局外层）后重跑。',
    ].join('\n'),
  );
}

// —— 第三道：交互断言（与参照集无关，失败即逻辑缺陷 → exit 1；跳过 = 阻塞 → exit 2）。 ——
let interactionFailures = 0;
let interactionSkips = 0;
for (const interaction of INTERACTIONS) {
  const record = { id: interaction.id, note: interaction.note };
  try {
    const result = await interaction.run(page);
    record.status = result.status;
    if (result.note !== undefined) record.note = result.note;
    if (result.reason !== undefined) record.reason = result.reason;
    if (result.status === 'failed') interactionFailures += 1;
    if (result.status === 'skipped') interactionSkips += 1;
  } catch (error) {
    record.status = 'failed';
    record.reason = error instanceof Error ? error.message : String(error);
    interactionFailures += 1;
  }
  evidence.interactions.push(record);
  if (verbose)
    console.error(`  交互 ${record.status === 'passed' ? '✓' : record.status} ${record.id}`);
  await page.goto(REVIEW_URL, { waitUntil: 'networkidle' });
}

if (interactionFailures > 0) {
  await browser.close();
  finish(
    evidence,
    1,
    `违规：${String(interactionFailures)} 条交互断言失败（逻辑缺陷，不等参照集）。明细见证据 JSON。`,
  );
}

if (interactionSkips > 0) {
  await browser.close();
  evidence.blockedReason = `${String(interactionSkips)} 条交互断言前置不成立（跳过）；${reference.ready ? '' : `参照集：${reference.reason}`}`;
  finish(
    evidence,
    2,
    [
      `阻塞：${String(interactionSkips)} 条交互断言前置不成立（如实记 skipped，不计通过）。`,
      '常见前置：文档里没有画板（FE-06 画布/文档接入）、宿主未暴露缩放入口等——见证据 JSON 的 interactions.reason。',
    ].join('\n'),
  );
}

// —— 第三道：参照集（REF-01）。未冻结 = 阻塞，任何「通过」都是假绿。 ——
if (!reference.ready) {
  await browser.close();
  evidence.blockedReason = reference.reason;
  finish(
    evidence,
    2,
    [
      '阻塞：参照集未冻结（REF-01 未完成）。',
      `原因：${reference.reason}`,
      `评审参照集路径：${REF_DIR}（文件名 = 取样名把 / 换成 _，如 comments_pins.png）`,
      '交互断言已跑完（见证据 JSON 的 interactions；全绿也不代表通过——像素判定缺参照集）。',
      '待办：冻结参照集后运行本门禁逐单元取证；在此之前不得以自截图/近似图假绿。',
    ].join('\n'),
  );
}

const targets = only === undefined ? SAMPLES : SAMPLES.filter((sample) => sample.id === only);
let failures = 0;
let pending = 0;

for (const sample of targets) {
  const safeName = sample.id.replaceAll('/', '_');
  const refPath = join(REF_DIR, `${safeName}.png`);
  const actualPath = join(actualDir, `${safeName}.png`);
  const record = { id: sample.id, note: sample.note, root: sample.root };

  try {
    // 每个单元从头开始：回评审页再进状态（避免上一个单元的残留状态污染）
    await page.goto(REVIEW_URL, { waitUntil: 'networkidle' });
    if (sample.prepare !== undefined) await sample.prepare(page);
    const target = page.locator(sample.root);
    await target.first().waitFor({ state: 'visible', timeout: 3000 });
    const box = await target.first().boundingBox();
    if (box === null) throw new Error('元素没有包围盒');
    // 组件完整边界 + 8px 留白（几何计算；留白是 spec 固定值）
    const clip = {
      x: Math.max(0, box.x - MARGIN),
      y: Math.max(0, box.y - MARGIN),
      width: box.width + MARGIN * 2,
      height: box.height + MARGIN * 2,
    };
    await page.screenshot({ path: actualPath, clip, animations: 'disabled' });
  } catch (error) {
    pending += 1;
    record.status = 'pending';
    record.reason = `状态在宿主页上取不到：${error instanceof Error ? error.message : String(error)}`;
    evidence.samples.push(record);
    if (verbose) console.error(`  … ${sample.id}：${record.reason}`);
    continue;
  }

  if (!existsSync(refPath)) {
    failures += 1;
    record.status = 'missing-reference';
    record.reference = refPath;
    evidence.samples.push(record);
    if (verbose) console.error(`  ✗ ${sample.id}：参照图缺失（${safeName}.png）`);
    continue;
  }

  const refPng = PNG.sync.read(readFileSync(refPath));
  const actualPng = PNG.sync.read(readFileSync(actualPath));
  if (refPng.width !== actualPng.width || refPng.height !== actualPng.height) {
    failures += 1;
    record.status = 'size-mismatch';
    record.reference = { width: refPng.width, height: refPng.height };
    record.actual = { width: actualPng.width, height: actualPng.height };
    evidence.samples.push(record);
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
  const diffPath = join(diffDir, `${safeName}.png`);
  writeFileSync(diffPath, PNG.sync.write(diffPng));

  const status = ratio <= maxRatio ? 'pass' : 'fail';
  if (status === 'fail') failures += 1;
  record.status = status;
  record.diff = {
    diffPixels,
    totalPixels: total,
    ratio: Number(ratio.toFixed(6)),
    bbox: bboxOfDiff(diffPng),
  };
  record.artifacts = {
    ref: fingerprint(refPath),
    actual: fingerprint(actualPath),
    diff: fingerprint(diffPath),
  };
  evidence.samples.push(record);
  if (verbose) {
    console.error(
      `  ${status === 'pass' ? '✓' : '✗'} ${sample.id}：差异率 ${(ratio * 100).toFixed(4)}%`,
    );
  }
}

for (const state of STATES) {
  const hits = targets.filter((sample) => sample.id.endsWith(`/${state}`));
  evidence.stateCoverage = evidence.stateCoverage.map((item) =>
    item.state === state
      ? {
          ...item,
          samples: hits.map((sample) => sample.id),
          status: hits.length === 0 ? 'missing' : 'covered',
          note:
            hits.length === 0
              ? '本票未列出该态的独立取样单元（按需补挂点）。'
              : '有取样单元；待参照集冻结后逐单元出 A 级结论（缺项即缺陷）。',
        }
      : item,
  );
}

await browser.close();

// 判定：拦截到的（pending 取样单元）= 阻塞；超差/缺参照 = 违规；否则通过。

// 判定：pending（状态取不到）= 阻塞；超差/缺参照 = 违规；否则通过。
if (pending > 0) {
  finish(
    evidence,
    2,
    [
      `阻塞：${String(pending)} 个取样单元的状态在宿主页上取不到（记录为 pending，不计通过）。`,
      '提示：宿主页需要提供对应状态（评论钉点与解决段 / Present 空态 / 版本空态等），见各单元 note。',
    ].join('\n'),
  );
}

const code = failures === 0 ? 0 : 1;
finish(
  evidence,
  code,
  failures === 0
    ? `通过：${String(targets.length)} 个取样单元全部在容差内（≤ ${(maxRatio * 100).toFixed(2)}%）。`
    : `违规：${String(failures)} 个单元超差或参照图缺失（逐单元明细见证据 JSON）。`,
);
