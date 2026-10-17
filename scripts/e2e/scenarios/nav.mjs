/**
 * e2e 场景 · 站内导航携带 daemon 端点（修复批次 4 · 工作包 B；D-3 / UX-01）。
 *
 * 缺陷与断言（网关形态 = 缺陷唯一暴露面；runner 给每个场景起同源网关 + 独立 daemon + 独立数据根）：
 * ① 首页 → 打开文档 → 编辑器：跳转后的 URL 必须**带着端点参数**（丢参 = 编辑器回退端口窗探测
 *    → 在同源网关/非默认端口形态下整页「无法连接本地服务」）；编辑器内不得出现该文案；
 * ② 市场列表 → 点开卡片 → 详情：详情正常渲染（不是 DAEMON_UNREACHABLE 外壳），URL 保留端点
 *    参数，且回跳「返回市场」同样保留；
 * ③ 越权面：全程不得出现对 4318（或其他非网关 origin）的请求——丢参后前端会去打缺省端口，
 *    那台常驻实例的数据根与场景夹具不同（串库）；console/pageerror 不得有 CORS 类错误。
 *
 * 自足性：市场索引是**场景自己播种的夹具**（不依赖真实采集线数据、不依赖开发机已有产物），
 * 文档也由场景经 daemon API 创建——CI 与开发机同一条链。场景协议见 `scripts/e2e-smoke.mjs` 头注释。
 */
import { writeMarketIndex } from '../../lib/market-fixture.mjs';

export const id = 'nav';
export const title = '导航携带 daemon 端点（同源网关形态 · D-3/UX-01）';

/** 场景内创建的文档名（首页卡片按此名定位）。 */
const DOCUMENT_NAME = '导航夹具文档';

/** 夹具资产 id（`gh:owner/repo#path` 形状；详情页路由段编码后即此串）。 */
const FIXTURE_ASSET_ID = 'gh:nav-fixture/skills#skills/slide-deck';

/** 夹具资产主文案（zh-CN）（详情页渲染断言用）。 */
const FIXTURE_ASSET_TITLE = '幻灯片演示技能';

/** 最小市场索引（单条 view-only 资产；字段形状按 `parseMarketplaceIndex` 的契约子集）。 */
function marketIndexFixture() {
  return {
    schema: 'df.marketplace.index/v1',
    generatedAt: '2026-10-16T00:00:00.000Z',
    collector: { name: 'e2e-nav-fixture', version: '0.0.0', runId: 'nav', odsWatermark: '' },
    counts: {
      total: 1,
      byKind: { skill: 1, plugin: 0, 'design-system': 0, template: 0 },
      loadable: 0,
    },
    assets: [
      {
        id: FIXTURE_ASSET_ID,
        kind: 'skill',
        name: 'slide-deck',
        displayName: { 'zh-CN': FIXTURE_ASSET_TITLE, en: 'Slide deck skill' },
        summary: { 'zh-CN': '把大纲渲染成演示幻灯片（导航回归夹具）', en: 'Outline to slides' },
        description: '夹具资产：只用于导航回归（详情渲染 + 端点参数传递），不代表真实采集数据。',
        source: {
          repo: 'nav-fixture/skills',
          repoId: 1,
          path: 'skills/slide-deck',
          ref: 'abcdef1234567890',
          fetchedAt: '2026-10-16T00:00:00.000Z',
          license: { spdx: 'MIT', gate: 'view-only', evidence: { path: 'LICENSE', sha256: '' } },
          stars: 1,
          pushedAt: '2026-10-16T00:00:00.000Z',
          archived: false,
        },
        capabilities: [],
        facets: { category: '其他', lane: 'create', mode: null, tags: [], scenes: [] },
        quality: { score: 70, dims: {} },
        installGate: {
          mode: 'view-only',
          licenseGate: 'view-only',
          security: 'pass',
          reasons: [],
          ackRequired: [],
        },
        digest: 'e2e-nav-fixture',
      },
    ],
  };
}

/** 播种市场索引夹具（daemon 按请求现读索引，落盘即生效；落盘口径与审计夹具共用 lib）。 */
function seedMarketIndex(dataRoot) {
  writeMarketIndex(dataRoot, marketIndexFixture());
}

/** 轮询到 URL 满足谓词（避免依赖 playwright 版本相关的 waitForURL 形态）。 */
async function waitForUrl(page, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (predicate(new URL(page.url()))) return true;
    } catch {
      // 地址尚未成形：继续等
    }
    await page.waitForTimeout(120);
  }
  return false;
}

/** http(s) 请求的 origin（非 http(s) 如 data:/blob: 返回 null）。 */
function httpOrigin(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** 主入口。 */
export async function run(page, ctx) {
  // 全程监听：请求面（越权/串库判定）、页面异常与 console 错误（CORS 类判定）
  const requests = [];
  const pageErrors = [];
  const consoleErrors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const gateway = ctx.pageUrl; // 同源网关 origin（无查询串）
  const daemonParam = `${gateway}/df`; // 网关形态下的端点（同源，与生产形态一致）
  const daemonQuery = `daemon=${encodeURIComponent(daemonParam)}`;

  // --- 0) 前置：夹具 daemon 活着 ---
  const health = await fetch(`${ctx.daemonUrl}/health`).catch(() => null);
  ctx.assert(
    health !== null && health.ok,
    '本地服务（夹具 daemon）可达',
    health === null ? `不可达：${ctx.daemonUrl}` : `HTTP ${String(health.status)}`,
  );
  if (health === null || !health.ok) return { steps: [] };

  // --- 1) 播种市场索引 + 建一份文档（数据面就位；UI 全链路已由 home 场景覆盖） ---
  seedMarketIndex(ctx.dataRoot);
  const created = await fetch(`${ctx.daemonUrl}/documents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: DOCUMENT_NAME }),
  })
    .then((response) => response.json())
    .catch((error) => ({ ok: false, error: String(error) }));
  ctx.assert(
    created?.ok === true && created?.result?.document?.id === DOCUMENT_NAME,
    '夹具文档已创建（daemon API）',
    JSON.stringify(created).slice(0, 200),
  );

  // --- 2) ① 首页（带 ?daemon=）→ 点开卡片 → 编辑器 ---
  await page.goto(ctx.homeUrl, { waitUntil: 'networkidle' });
  const cardLink = page.getByRole('link', { name: `打开「${DOCUMENT_NAME}」` });
  let cardReady = true;
  await cardLink.waitFor({ timeout: 15_000 }).catch(() => {
    cardReady = false;
  });
  ctx.assert(cardReady, '首页卡片出现（跳转起点就绪）', page.url());
  if (!cardReady) return { steps: [] };

  // 链接地址本身要带端点参数：中键/修饰键新开标签走的是 href（不经 router.push）
  const cardHref = (await cardLink.getAttribute('href')) ?? '';
  ctx.assert(
    cardHref.includes(`?documentId=`) && cardHref.includes(daemonQuery),
    '首页卡片链接地址续写端点参数',
    cardHref,
  );

  await cardLink.click();
  const enteredEditor = await waitForUrl(
    page,
    (url) => url.pathname.startsWith('/editor') && url.searchParams.has('daemon'),
    15_000,
  );
  const editorUrl = page.url();
  ctx.assert(enteredEditor, '进入编辑器后 URL 保留端点参数（不丢 ?daemon=）', `url=${editorUrl}`);
  ctx.assert(
    new URL(editorUrl).searchParams.get('daemon') === daemonParam,
    '编辑器 URL 的端点指向同源网关（值未被改写）',
    `daemon=${String(new URL(editorUrl).searchParams.get('daemon'))}`,
  );

  // 编辑器渲染就绪（画布挂载）后再断言文案——避免把「还没画出来」当过失
  await page.waitForSelector('canvas[data-df-canvas]', { timeout: 30_000 }).catch(() => undefined);
  const editorBody = await page.locator('body').innerText();
  ctx.assert(
    !editorBody.includes('无法连接本地服务'),
    '编辑器内无「无法连接本地服务」',
    editorBody.slice(0, 160).replaceAll('\n', ' / '),
  );
  // 请求级携带端点：编辑器按 documentId 载入文档（工作包 A 的取数），端点来自刚续写的参数
  const editorLoadDeadline = Date.now() + 8_000;
  while (
    Date.now() < editorLoadDeadline &&
    !requests.some((url) => url.includes('/df/documents/'))
  ) {
    await page.waitForTimeout(150);
  }
  const editorLoadRequests = requests.filter((url) => url.includes('/df/documents/'));
  ctx.assert(
    editorLoadRequests.length > 0 && editorLoadRequests.every((url) => httpOrigin(url) === gateway),
    '编辑器取数经同源网关（请求级携带端点）',
    `${String(editorLoadRequests.length)} 次：${editorLoadRequests[0] ?? '无'}`,
  );

  // --- 3) ② 市场列表 → 详情 ---
  await page.goto(`${gateway}/market?${daemonQuery}`, { waitUntil: 'networkidle' });
  const cardCount = await page
    .locator('[data-df-market="card"]')
    .count()
    .catch(() => 0);
  ctx.assert(cardCount > 0, '市场列表渲染夹具卡片', `${String(cardCount)} 张`);
  if (cardCount === 0) return { steps: [] };
  const listBody = await page.locator('body').innerText();
  ctx.assert(
    listBody.includes(FIXTURE_ASSET_TITLE),
    '列表卡片渲染夹具资产（索引夹具已被消费）',
    listBody.slice(0, 160).replaceAll('\n', ' / '),
  );

  // 列表取数走网关 `/df`（请求级携带端点；4318 面由第 5 段统一判）
  const marketListRequests = requests.filter((url) => url.includes('/df/market/query'));
  ctx.assert(
    marketListRequests.length > 0 && marketListRequests.every((url) => httpOrigin(url) === gateway),
    '市场列表取数经同源网关（请求级携带端点）',
    `${String(marketListRequests.length)} 次：${marketListRequests[0] ?? '无'}`,
  );

  const clickedAsset = await page
    .locator('[data-df-market="card"]')
    .first()
    .getAttribute('data-df-asset');
  await page.locator('[data-df-market="card-open"]').first().click();
  const openedDetail = await waitForUrl(
    page,
    (url) => url.pathname.startsWith('/market/') && url.searchParams.has('daemon'),
    15_000,
  );
  const detailUrl = page.url();
  ctx.assert(openedDetail, '详情页 URL 保留端点参数（卡片→详情不丢参）', `url=${detailUrl}`);

  let detailReady = true;
  await page.waitForSelector('[data-df-page="market-detail"]', { timeout: 15_000 }).catch(() => {
    detailReady = false;
  });
  ctx.assert(detailReady, '详情视图渲染（data-df-page=market-detail）', page.url());
  const renderedAsset = await page
    .locator('[data-df-page="market-detail"]')
    .getAttribute('data-df-asset')
    .catch(() => null);
  ctx.assert(
    renderedAsset !== null && renderedAsset === clickedAsset,
    '详情渲染的是点开的那条资产（id 一致）',
    `clicked=${String(clickedAsset)} rendered=${String(renderedAsset)}`,
  );
  const detailIdText = await page
    .locator('[data-df-market="detail-id"]')
    .innerText()
    .catch(() => '');
  ctx.assert(
    detailIdText.includes(FIXTURE_ASSET_ID),
    '详情取到夹具资产（id 逐字一致）',
    detailIdText,
  );
  const detailBody = await page.locator('body').innerText();
  ctx.assert(
    !detailBody.includes('无法连接本地服务') && !detailBody.includes('DAEMON_UNREACHABLE'),
    '详情内无「无法连接本地服务 / DAEMON_UNREACHABLE」',
    detailBody.slice(0, 160).replaceAll('\n', ' / '),
  );
  const detailAssetRequests = requests.filter((url) => url.includes('/df/market/assets/'));
  ctx.assert(
    detailAssetRequests.length > 0 &&
      detailAssetRequests.every((url) => httpOrigin(url) === gateway),
    '详情取数经同源网关（请求级携带端点）',
    `${String(detailAssetRequests.length)} 次：${detailAssetRequests[0] ?? '无'}`,
  );

  // --- 4) 回跳「返回市场」同样保留参数 ---
  await page.locator('[data-df-market="detail-back"]').click();
  const backToList = await waitForUrl(
    page,
    (url) => url.pathname === '/market' && url.searchParams.has('daemon'),
    15_000,
  );
  ctx.assert(backToList, '「返回市场」回跳保留端点参数', `url=${page.url()}`);

  // --- 5) ③ 越权面：无 4318 / 非网关 origin 请求；无 CORS 类错误 ---
  const httpRequests = requests
    .map((url) => ({ url, origin: httpOrigin(url) }))
    .filter((entry) => entry.origin !== null);
  const foreign = httpRequests.filter((entry) => entry.origin !== gateway);
  ctx.assert(
    foreign.length === 0,
    '全程请求都在同源网关（无 4318 / 直连 daemon）',
    foreign.length === 0
      ? `${String(httpRequests.length)} 次请求，origin 均 = ${gateway}`
      : `越权请求：${foreign
          .slice(0, 3)
          .map((entry) => entry.url)
          .join(' | ')}`,
  );
  const port4318 = httpRequests.filter((entry) => entry.url.includes(':4318'));
  ctx.assert(
    port4318.length === 0,
    '无对 4318 缺省端口的调用（丢参即回退端口窗，属 D-3 复现面）',
    `${String(port4318.length)} 次`,
  );
  const corsLike = [...consoleErrors, ...pageErrors].filter((text) =>
    /CORS|Access to (fetch|XMLHttpRequest)|has been blocked by/i.test(text),
  );
  ctx.assert(
    corsLike.length === 0,
    '无 CORS 类错误（console/pageerror）',
    corsLike.slice(0, 2).join(' | ').slice(0, 240),
  );

  return { steps: [] };
}
