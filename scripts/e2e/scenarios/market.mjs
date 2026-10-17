/**
 * e2e 场景 · 市场列表可达性（修复批次 5 · 工作包 A；DEF-R1 / #46）。
 *
 * 缺陷背景：daemon 早已按 `limit/offset` 切片，页面却固定只取首屏 60 条且无分页——
 * 344 个资源里约 284 个在界面上**不可达**。本场景把这个回归固定在最高接缝上
 * （真 daemon + 生产构建站点 + 真 Chromium，经 runner 的同源网关形态）：
 *
 * ① 统计行与索引 total 一致（`共 70 个资源`）；
 * ② 首屏卡片数 = 页大小（当前 60）；
 * ③ **total > 首屏数时分页控件必须存在**（`[data-df-market="pagination"]` +「加载更多」
 *    按钮）——这是「可达性」的判据：分页被删/被藏时本步必须 fail；
 * ④ 点「加载更多」→ 卡片按 offset 累加到 70、进度文案更新；
 * ⑤ 到达终点给「已全部加载（70）」且「加载更多」按钮消失。
 *
 * 自足性：索引是**场景自己播种的夹具**（`<ctx.dataRoot>/market/` 下 daemon 的候选路径），
 * 不依赖真实采集线产物、不依赖开发机已有数据——CI 与开发机同一条链。
 * 场景协议见 `scripts/e2e-smoke.mjs` 头注释。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const id = 'market';
export const title = '市场列表可达性（首屏 60 → 加载更多 → 已全部加载 · DEF-R1）';

/** 夹具资产总数：必须 > 首屏页大小，才暴露「服务端 total 大于已载数」的不可达面。 */
const TOTAL_ASSETS = 70;

/** 首屏页大小（与 `apps/web/src/features/market/filters.ts` 的 `toQueryParams` 缺省值一致）。 */
const FIRST_PAGE_SIZE = 60;

/** 市场索引文件名（daemon 候选路径 `<数据根>/market/df.marketplace.index.v1.json`）。 */
const MARKET_INDEX_FILENAME = 'df.marketplace.index.v1.json';

/**
 * 构造第 `index` 张夹具资产。
 *
 * 字段形状按 `parseMarketplaceIndex` 的契约补全（缺关键字段会被静默跳过，令 total 偏小
 * 而让断言失真）；每张只改 id/name/displayName/summary，其余沿用 daemon 测试夹具默认值。
 */
function makeAsset(index) {
  const ordinal = String(index).padStart(2, '0');
  return {
    id: `gh:market-e2e/fixtures#asset-${ordinal}`,
    kind: 'skill',
    name: `market-e2e-asset-${ordinal}`,
    displayName: { 'zh-CN': `市场夹具资源 ${ordinal}`, en: `Market fixture asset ${ordinal}` },
    summary: {
      'zh-CN': `分页可达性回归夹具第 ${ordinal} 条（不代表真实采集数据）`,
      en: `Pagination fixture asset ${ordinal}`,
    },
    description: '夹具资产：只用于市场列表分页/可达性回归。',
    source: {
      repo: 'market-e2e/fixtures',
      repoId: 1,
      path: `assets/asset-${ordinal}`,
      ref: 'a'.repeat(40),
      fetchedAt: '2026-10-16T00:00:00.000Z',
      license: {
        spdx: 'MIT',
        gate: 'loadable',
        evidence: { path: 'LICENSE', sha256: 'b'.repeat(64) },
      },
      stars: 100,
      pushedAt: '2026-10-01T09:00:00.000Z',
      archived: false,
      homepage: null,
      upstream: null,
      brandDerived: false,
    },
    capabilities: ['prompt:inject'],
    facets: { category: '其他', lane: 'create', mode: 'components', tags: ['fixture'], scenes: [] },
    quality: {
      score: 0.5,
      dims: { spec: 0.5, maintenance: 0.5, docs: 0.5, security: 0.5, ecosystem: 0.5 },
    },
    installGate: {
      mode: 'loadable',
      licenseGate: 'loadable',
      security: 'pass',
      reasons: [],
      ackRequired: [],
    },
    digest: `sha256:${String(index).padStart(64, '0')}`,
    embeddingRef: null,
    yanked: null,
  };
}

/** 夹具索引：counts 与 assets 长度严格一致（统计行读 counts、分页读 total 切片）。 */
function marketIndexFixture() {
  return {
    schema: 'df.marketplace.index/v1',
    generatedAt: '2026-10-16T00:00:00.000Z',
    collector: { name: 'e2e-market-fixture', version: '0.0.0', runId: 'market', odsWatermark: '' },
    counts: {
      total: TOTAL_ASSETS,
      byKind: { skill: TOTAL_ASSETS, plugin: 0, 'design-system': 0, template: 0 },
      loadable: TOTAL_ASSETS,
    },
    assets: Array.from({ length: TOTAL_ASSETS }, (_, index) => makeAsset(index + 1)),
  };
}

/** 播种市场索引夹具（daemon 每次查询按请求现读索引，落盘即生效）。 */
function seedMarketIndex(dataRoot) {
  const marketDir = join(dataRoot, 'market');
  mkdirSync(marketDir, { recursive: true });
  writeFileSync(
    join(marketDir, MARKET_INDEX_FILENAME),
    `${JSON.stringify(marketIndexFixture(), null, 2)}\n`,
    'utf8',
  );
}

/** 轮询直到 `probe()` 为真（返回最终真值；超时返回 false）。 */
async function waitForCondition(probe, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probe()) === true) return true;
    await new Promise((done) => setTimeout(done, 150));
  }
  return (await probe()) === true;
}

/** 主入口。 */
export async function run(page, ctx) {
  // --- 0) 前置：夹具 daemon 活着（失败时归因指向夹具，而不是页面） ---
  const health = await fetch(`${ctx.daemonUrl}/health`).catch(() => null);
  ctx.assert(
    health?.ok === true,
    '本地服务（夹具 daemon）可达',
    health === null ? `不可达：${ctx.daemonUrl}` : `HTTP ${String(health.status)}`,
  );
  if (health?.ok !== true) return { steps: [] };

  // --- 1) 播种 70 条索引，再打开市场页（懒加载：导航前落盘即可被消费） ---
  seedMarketIndex(ctx.dataRoot);
  const gateway = ctx.pageUrl; // 同源网关 origin（无查询串）
  const daemonParam = `${gateway}/df`; // 网关形态下的端点（同源，与生产形态一致）
  await page.goto(`${gateway}/market?daemon=${encodeURIComponent(daemonParam)}`, {
    waitUntil: 'networkidle',
  });

  const grid = page.locator('[data-df-market="grid"]');
  const cards = page.locator('[data-df-market="card"]');
  const gridReady = await grid
    .first()
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  ctx.assert(gridReady, '市场列表渲染（卡片网格挂载）', page.url());
  if (!gridReady) return { steps: [] };

  // --- 2) 统计行与索引 total 一致 ---
  const summaryText = await page
    .locator('[data-df-market="result-count"]')
    .innerText()
    .catch(() => '');
  ctx.assert(
    summaryText.includes(`共 ${String(TOTAL_ASSETS)} 个资源`),
    `统计行显示「共 ${String(TOTAL_ASSETS)} 个资源」`,
    summaryText,
  );

  // --- 3) 首屏卡片数 = 页大小（卡片计数与网格 data-df-count 交叉核对） ---
  const firstScreenReady = await waitForCondition(
    async () => (await cards.count()) === FIRST_PAGE_SIZE,
    15_000,
  );
  const firstScreenCount = await cards.count();
  const gridCount = await grid
    .first()
    .getAttribute('data-df-count')
    .catch(() => null);
  ctx.assert(
    firstScreenReady && Number(gridCount) === FIRST_PAGE_SIZE,
    `首屏卡片数 = ${String(FIRST_PAGE_SIZE)}（页大小）`,
    `cards=${String(firstScreenCount)} grid.data-df-count=${String(gridCount)}`,
  );

  // --- 4) 可达性判据：total > 首屏数 ⇒ 分页控件与「加载更多」必须存在 ---
  const pagination = page.locator('[data-df-market="pagination"]');
  const loadMoreButton = page.getByRole('button', { name: '加载更多' });
  const paginationCount = await pagination.count();
  const loadMoreCount = await loadMoreButton.count();
  ctx.assert(
    paginationCount > 0 && loadMoreCount > 0,
    'total 大于首屏数时分页控件存在（可达性判据）',
    `服务端 total=${String(TOTAL_ASSETS)} > 首屏=${String(FIRST_PAGE_SIZE)}；pagination=${String(paginationCount)} loadMore=${String(loadMoreCount)}`,
  );
  if (paginationCount === 0 || loadMoreCount === 0) return { steps: [] };

  // --- 5) 首屏进度文案（已加载 60 / 70） ---
  const firstProgressText = await pagination.innerText().catch(() => '');
  ctx.assert(
    firstProgressText.includes(`已加载 ${String(FIRST_PAGE_SIZE)} / ${String(TOTAL_ASSETS)}`),
    `首屏进度文案「已加载 ${String(FIRST_PAGE_SIZE)} / ${String(TOTAL_ASSETS)}」`,
    firstProgressText.replaceAll('\n', ' / '),
  );

  // --- 6) 点「加载更多」→ 卡片按 offset 累加到 total ---
  await loadMoreButton.click();
  const allLoaded = await waitForCondition(
    async () => (await cards.count()) === TOTAL_ASSETS,
    20_000,
  );
  const totalCount = await cards.count();
  const gridTotalCount = await grid
    .first()
    .getAttribute('data-df-count')
    .catch(() => null);
  ctx.assert(
    allLoaded && Number(gridTotalCount) === TOTAL_ASSETS,
    `点击「加载更多」后卡片累加到 ${String(TOTAL_ASSETS)}`,
    `cards=${String(totalCount)} grid.data-df-count=${String(gridTotalCount)}`,
  );

  // --- 7) 进度文案更新为已加载 70 / 70 ---
  const finalProgressText = await pagination.innerText().catch(() => '');
  ctx.assert(
    finalProgressText.includes(`已加载 ${String(TOTAL_ASSETS)} / ${String(TOTAL_ASSETS)}`),
    `进度文案更新「已加载 ${String(TOTAL_ASSETS)} / ${String(TOTAL_ASSETS)}」`,
    finalProgressText.replaceAll('\n', ' / '),
  );

  // --- 8) 终点：已全部加载（70）且「加载更多」按钮消失 ---
  const doneReady = await waitForCondition(
    async () =>
      (await pagination.innerText().catch(() => '')).includes(
        `已全部加载（${String(TOTAL_ASSETS)}）`,
      ),
    15_000,
  );
  const finalText = await pagination.innerText().catch(() => '');
  const buttonAfterDone = await page.getByRole('button', { name: '加载更多' }).count();
  ctx.assert(
    doneReady && buttonAfterDone === 0,
    `终点给「已全部加载（${String(TOTAL_ASSETS)}）」且「加载更多」按钮消失`,
    `text=${finalText.replaceAll('\n', ' / ')}；loadMore=${String(buttonAfterDone)}`,
  );

  return { steps: [] };
}
