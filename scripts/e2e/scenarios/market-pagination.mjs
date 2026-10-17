/**
 * 冒烟场景 · 市场过滤 × 分页边界（审计 08 · F-05-01 跨域复验，回归候选 R-05-01）。
 *
 * 缺陷（审计 05 · F-05-01，B 级）：许可档 / 来源仓库 / 已装载三项是**客户端过滤**，
 * 只作用于已加载页；首屏 0 命中时 `renderPagination()` 直接返回 null——用户看到
 * 「没有匹配的资源」且「加载更多」消失，但后续页里其实有匹配资产（当前场景：第 2–3 页
 * 的 70 条 `later/repo`）。
 *
 * 本场景在**生产构建 + 真 Chromium + 同源网关**上钉住两件事：
 *   ① 已加载 60 / 总数 130、首屏过滤命中 0 时，分页入口必须仍在（当前产品应如实判红）；
 *   ② 未过滤时增量分页确实能到 130，且全量加载后同一过滤命中 70（证明缺陷是「入口消失」
 *      而不是数据不存在）。
 *
 * 夹具自足：索引由场景播种到独立数据根（不依赖真实采集线 / 开发机产物）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const id = 'market-pagination';
export const title = '市场过滤×分页边界（F-05-01 · 首屏 0 命中时加载更多不得消失）';

/** 首页一页的条数（`toQueryParams` 的缺省 limit）。 */
const PAGE_SIZE = 60;
/** 首屏批次（高分，排在前 60 条）。 */
const FIRST_BATCH = 60;
/** 后续批次（低分，排在第 61–130 条；过滤只应在这里命中）。 */
const LATER_BATCH = 70;
const TOTAL = FIRST_BATCH + LATER_BATCH;
const FIRST_REPO = 'first/batch';
const LATER_REPO = 'later/repo';

const MARKET_INDEX_FILENAME = 'df.marketplace.index.v1.json';

/** 造一条合法市场资产（字段形状沿用 nav 场景的最小夹具）。 */
function fixtureAsset(index) {
  const later = index >= FIRST_BATCH;
  const serial = String(index + 1).padStart(3, '0');
  const repo = later ? LATER_REPO : FIRST_REPO;
  return {
    id: `gh:fixture/${later ? 'later' : 'first'}#skills/asset-${serial}`,
    kind: 'skill',
    name: `asset-${serial}`,
    displayName: { 'zh-CN': `分页夹具 ${serial}`, en: `Pagination fixture ${serial}` },
    summary: { 'zh-CN': `分页回归夹具（${repo}）`, en: `Pagination fixture (${repo})` },
    description: '仅用于过滤×分页边界回归，不代表真实采集数据。',
    source: {
      repo,
      repoId: index + 1,
      path: `skills/asset-${serial}`,
      ref: `${serial.repeat(10)}abcdefghij`.slice(0, 40),
      fetchedAt: '2026-10-16T00:00:00.000Z',
      license: { spdx: 'MIT', gate: 'view-only', evidence: { path: 'LICENSE', sha256: '' } },
      stars: 1,
      pushedAt: '2026-10-16T00:00:00.000Z',
      archived: false,
    },
    capabilities: [],
    facets: { category: '其他', lane: 'create', mode: null, tags: [], scenes: [] },
    quality: { score: later ? 50 : 90, dims: {} },
    installGate: {
      mode: 'view-only',
      licenseGate: 'view-only',
      security: 'pass',
      reasons: [],
      ackRequired: [],
    },
    digest: `e2e-market-pagination-${serial}`,
  };
}

/** 播种索引（daemon 按请求现读索引，落盘即生效）。 */
function seedMarketIndex(dataRoot) {
  const assets = Array.from({ length: TOTAL }, (_, index) => fixtureAsset(index));
  const marketDir = join(dataRoot, 'market');
  mkdirSync(marketDir, { recursive: true });
  writeFileSync(
    join(marketDir, MARKET_INDEX_FILENAME),
    `${JSON.stringify(
      {
        schema: 'df.marketplace.index/v1',
        generatedAt: '2026-10-16T00:00:00.000Z',
        collector: {
          name: 'e2e-market-pagination',
          version: '0.0.0',
          runId: 'market-pagination',
          odsWatermark: '',
        },
        counts: {
          total: TOTAL,
          byKind: { skill: TOTAL, plugin: 0, 'design-system': 0, template: 0 },
          loadable: 0,
        },
        assets,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

/** 等卡片数量达到预期（避免把渲染时差当结论）。 */
async function waitForCardCount(page, count, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await page
      .locator('[data-df-market="card"]')
      .count()
      .catch(() => 0);
    if (current === count) return current;
    await page.waitForTimeout(120);
  }
  return page
    .locator('[data-df-market="card"]')
    .count()
    .catch(() => 0);
}

/** 主入口。 */
export async function run(page, ctx) {
  const requests = [];
  const pageErrors = [];
  const consoleErrors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  seedMarketIndex(ctx.dataRoot);

  const gateway = ctx.pageUrl;
  const daemonParam = `${gateway}/df`;
  const daemonQuery = `daemon=${encodeURIComponent(daemonParam)}`;
  const marketUrl = `${gateway}/market?${daemonQuery}`;

  // --- 0) 夹具索引经 daemon 读链可见（服务端独立真值） ---
  const query = await fetch(`${ctx.daemonUrl}/market/query?limit=200`)
    .then((response) => response.json())
    .catch(() => null);
  const serverTotal = query?.result?.total ?? null;
  const serverItems = query?.result?.items ?? [];
  const laterCount = serverItems.filter((asset) => asset.source?.repo === LATER_REPO).length;
  ctx.assert(
    serverTotal === TOTAL && serverItems.length === TOTAL && laterCount === LATER_BATCH,
    '夹具索引经 daemon 读链可见（130 条，其中 later/repo 70 条）',
    `total=${String(serverTotal)} items=${String(serverItems.length)} later=${String(laterCount)}`,
  );

  // --- 1) 首屏：60 / 130；分页入口在 ---
  await page.goto(marketUrl, { waitUntil: 'networkidle' });
  await page.locator('[data-df-market="card"]').first().waitFor({ timeout: 20_000 });
  const initialCards = await waitForCardCount(page, PAGE_SIZE);
  ctx.assert(
    initialCards === PAGE_SIZE,
    '首屏加载一页（60 张卡片）',
    `cards=${String(initialCards)}`,
  );
  const pagination = page.locator('[data-df-market="pagination"]');
  const initialPaginationText = (await pagination.textContent().catch(() => null)) ?? null;
  ctx.assert(
    initialPaginationText?.includes(`60 / ${TOTAL}`),
    '首屏分页显示「已加载 60 / 130」',
    initialPaginationText ?? '(无分页)',
  );

  // --- 2) 首屏 0 命中：空态出现，但后续页仍有匹配（F-05-01 的核心场景） ---
  const repoInput = page.getByRole('textbox', { name: '来源仓库' });
  await repoInput.fill(LATER_REPO);
  await page.waitForTimeout(400);
  const filteredCards = await waitForCardCount(page, 0, 5_000);
  const emptyState = await page
    .locator('[data-df-empty="no-result"]')
    .count()
    .catch(() => 0);
  ctx.assert(
    filteredCards === 0 && emptyState === 1,
    '首屏过滤命中 0：显示「没有匹配的资源」空态',
    `cards=${String(filteredCards)} emptyState=${String(emptyState)}`,
  );

  // **本场景的回归断言（当前产品应为红）**：已加载 60 < 总数 130，分页入口必须仍在。
  const paginationAfterFilter = await page
    .locator('[data-df-market="pagination"]')
    .count()
    .catch(() => 0);
  const loadMoreAfterFilter = await page
    .getByRole('button', { name: '加载更多' })
    .count()
    .catch(() => 0);
  ctx.assert(
    paginationAfterFilter === 1 && loadMoreAfterFilter === 1,
    'F-05-01：首屏 0 命中但已加载 < 总数时，「加载更多」不得消失',
    JSON.stringify({
      loaded: PAGE_SIZE,
      total: TOTAL,
      paginationNodes: paginationAfterFilter,
      loadMoreButtons: loadMoreAfterFilter,
      emptyStateShown: emptyState === 1,
    }),
  );

  // 独立证据：匹配资产确实在后续页（不是索引里没有）。
  const laterPage = await fetch(`${ctx.daemonUrl}/market/query?limit=200&offset=60`)
    .then((response) => response.json())
    .catch(() => null);
  const laterPageCount = (laterPage?.result?.items ?? []).filter(
    (asset) => asset.source?.repo === LATER_REPO,
  ).length;
  ctx.assert(
    laterPageCount === LATER_BATCH,
    '后续页确实含 70 条匹配资产（空态是可达性问题，不是无数据）',
    `laterOnOffset60=${String(laterPageCount)}`,
  );

  // --- 3) 清空过滤 → 增量分页到 130（证明分页本身可用） ---
  await repoInput.fill('');
  await waitForCardCount(page, PAGE_SIZE, 5_000);
  await page.getByRole('button', { name: '加载更多' }).click();
  const afterSecondPage = await waitForCardCount(page, FIRST_BATCH + PAGE_SIZE, 20_000);
  ctx.assert(
    afterSecondPage === FIRST_BATCH + PAGE_SIZE,
    '「加载更多」追加第二页（120 张）',
    `cards=${String(afterSecondPage)}`,
  );
  await page.getByRole('button', { name: '加载更多' }).click();
  const afterAllPages = await waitForCardCount(page, TOTAL, 20_000);
  const allShown = await page.getByText(`已全部加载（${TOTAL}）`).count();
  ctx.assert(
    afterAllPages === TOTAL && allShown > 0,
    '增量分页到终点（130 张 + 「已全部加载」）',
    JSON.stringify({ cards: afterAllPages, allShown: allShown > 0 }),
  );

  // --- 4) 全量加载后同一过滤命中 70（过滤语义本身是对的，缺的是入口） ---
  await repoInput.fill(LATER_REPO);
  await page.waitForTimeout(400);
  const filteredAfterAll = await waitForCardCount(page, LATER_BATCH, 10_000);
  ctx.assert(
    filteredAfterAll === LATER_BATCH,
    '全量加载后过滤 later/repo 命中 70（过滤条件本身有效）',
    `cards=${String(filteredAfterAll)}`,
  );

  // --- 5) 四类不变量：同源网关 / 无 console、pageerror ---
  const httpRequests = requests.filter((url) => /^https?:\/\//.test(url));
  const foreign = httpRequests.filter((url) => new URL(url).origin !== gateway);
  ctx.assert(
    foreign.length === 0,
    '市场全程请求都在同源网关（无直连 daemon / 非网关 origin）',
    JSON.stringify({ requests: httpRequests.length, foreign: foreign.slice(0, 5) }),
  );
  const resident = httpRequests.filter((url) => /:(?:3000|4318)(?:\/|$)/.test(url));
  ctx.assert(
    resident.length === 0,
    '无对 3000/4318 常驻实例的调用（不碰真实数据根）',
    JSON.stringify({ resident: resident.slice(0, 5) }),
  );
  ctx.assert(
    consoleErrors.length === 0,
    '无 console 错误',
    JSON.stringify({ consoleErrors: consoleErrors.slice(0, 3) }),
  );
  ctx.assert(
    pageErrors.length === 0,
    '无未捕获异常（pageerror）',
    JSON.stringify({ pageErrors: pageErrors.slice(0, 3) }),
  );

  return { steps: [] };
}
