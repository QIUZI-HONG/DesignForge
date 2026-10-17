/**
 * 冒烟场景 · 编辑器主路径（修复批次 4 · 工作包 A；验收 D-1/D-2、UX-02/UX-03 的回归缝）。
 *
 * 为什么单开一条 `/editor` 域的场景：此前的浏览器断言只覆盖内部宿主 `/_canvas`
 * ——「工具接线」与「文档落盘」在 `/_canvas` 全绿、在**用户实际用的 `/editor` 上全失效**
 * （验收 D-1/D-2：点工具拖画 0 节点、打开自己的文档得到空画布、刷新即丢、导出 doc_not_found）。
 * 本场景把整条用户路径固定在 `/editor` 上：
 *
 *   首页新建 → 卡片进编辑器（顶栏真实文档名）→ 工具拖画落节点 → 选中改属性 →
 *   保存（保存态 + daemon 侧落盘证据）→ 回首页卡片更新 → 从卡片重开逐字段恢复 → 导出 PNG/SVG/PDF。
 *
 * 场景协议见 `scripts/e2e-smoke.mjs` 头部注释；runner 自带夹具 daemon 与同源网关，
 * 场景不假设任何仓外前置（gh 凭据/Electron/显示器一律不需要）。
 *
 * 审计 08 加固（F-07-01 回归资产）：导出段不再只看「已导出 …」文案与文件名——
 * 捕获 UI 实际收到的 `POST /export` 响应，落盘 base64 产物后做内容断言：
 * PNG 背景/矩形像素、SVG 背景之外的节点矩形、PDF 结构 + pdfinfo/pdftoppm 外部渲染像素。
 * 真实编辑器页信封（`dforge.canvas.page`）在缺陷修复前会如实判红（三格式全空白）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  decodeArtifactPayload,
  inspectPdf,
  inspectPng,
  inspectSvg,
  pdfHasFillColor,
  pdfInfo,
  renderPdfPage,
} from '../../lib/export-artifact.mjs';

export const id = 'editor';
export const title = '编辑器主路径（D-1/D-2 · 建→画→存→重开→导出）';

/** 场景内新建的文档名（同时也是 daemon 的文档标识）。 */
const DOCUMENT_NAME = '编辑器场景稿';

/** 拖画的目标世界坐标与尺寸（与 canvas 场景同口径：宽 160 / 高 110）。 */
const DRAW_FROM = { x: 300, y: 320 };
const DRAW_TO = { x: 460, y: 430 };
/** 改属性后的 X 值。 */
const MOVED_X = 240;

/** 记录一条步骤。 */
function step(name, status, detail) {
  return detail === undefined ? { name, status } : { name, status, detail };
}

/**
 * 卡片 href → 编辑器地址。
 *
 * 卡片产出的 href 是相对地址（`/editor?documentId=…`）。本场景额外把首页地址上的
 * `daemon` 参数带上：修复批次 4 工作包 B 之前，站内跳转不携带 `?daemon=`（缺陷 D-3），
 * 而编辑器内的 daemon 调用必须先拿到端点。补参只影响导航形态，不影响本场景的断言口径
 * ——工作包 B 落地后卡片 href 自带参数，这段补齐自动变成 no-op（保持两侧兼容）。
 */
function editorUrlFromCard(href, ctx) {
  const target = new URL(href, ctx.homeUrl);
  const home = new URL(ctx.homeUrl);
  const daemon = home.searchParams.get('daemon');
  if (daemon !== null && !target.searchParams.has('daemon')) {
    target.searchParams.set('daemon', daemon);
  }
  return target.toString();
}

/**
 * 等一次导出响应：URL 以 `/export` 结尾、POST、请求体的 format 匹配。
 * 返回的 response 由调用方 `json()` 解包——这就是 UI 实际收到的产物（不是二次请求）。
 */
function waitForExportResponse(page, format) {
  return page.waitForResponse(
    (response) => {
      if (response.request().method() !== 'POST') return false;
      let pathname;
      try {
        pathname = new URL(response.url()).pathname;
      } catch {
        return false;
      }
      if (!pathname.endsWith('/export')) return false;
      try {
        const posted = JSON.parse(response.request().postData() ?? '{}');
        return posted.format === format;
      } catch {
        return false;
      }
    },
    { timeout: 30_000 },
  );
}

/** 主入口。 */
export async function run(page, ctx) {
  const steps = [];

  // 四类不变量（审计 08）：请求面（同源网关）、console/pageerror、产物内容（导出段）。
  const pageRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
  page.on('request', (request) => pageRequests.push(request.url()));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push({ text: message.text(), url: message.location().url });
    }
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  const api = {
    nodeCount: () => page.evaluate(() => globalThis.__dforgeCanvas.nodeCount()),
    nodeIds: () => page.evaluate(() => globalThis.__dforgeCanvas.nodeIds()),
    geometry: (nodeId) => page.evaluate((id) => globalThis.__dforgeCanvas.geometry(id), nodeId),
    selection: () => page.evaluate(() => globalThis.__dforgeCanvas.selection()),
    viewport: () => page.evaluate(() => globalThis.__dforgeCanvas.viewport()),
    documentId: () => page.evaluate(() => globalThis.__dforgeCanvas.documentId()),
    documentName: () => page.evaluate(() => globalThis.__dforgeCanvas.documentName()),
    pageId: () => page.evaluate(() => globalThis.__dforgeCanvas.pageId()),
  };

  /** 等画布挂载 + Skia 就绪 + 首帧（与 runner 的编辑器门禁同判据）。 */
  const waitCanvasReady = async () => {
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
  };

  /** 读 daemon 侧的文档摘要（`updatedAt`/`pageCount` 的独立证据源）。 */
  const daemonSummary = async () => {
    const response = await fetch(
      `${ctx.daemonUrl}/documents/${encodeURIComponent(DOCUMENT_NAME)}`,
    ).catch(() => null);
    if (response === null || !response.ok) return null;
    const payload = await response.json().catch(() => null);
    return payload?.result?.document ?? null;
  };

  // —— 1) 首页新建文档（真实 UI：新建菜单 → 设计文件 → 命名 → 创建）——
  await page.goto(ctx.homeUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('.dfg-home__sidebar');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('menuitem', { name: '设计文件' }).click();
  const nameInput = page.getByRole('textbox', { name: '文件名称' });
  await nameInput.waitFor();
  await nameInput.fill(DOCUMENT_NAME);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  const card = page.getByRole('link', { name: `打开「${DOCUMENT_NAME}」` });
  await card.waitFor({ timeout: 10_000 });
  const href = (await card.getAttribute('href')) ?? '';
  ctx.assert(href.startsWith('/editor?documentId='), '首页卡片指向编辑器契约地址', href);

  const summaryAtCreate = await daemonSummary();
  ctx.assert(
    summaryAtCreate !== null,
    '新建后 daemon 侧可见该文档',
    summaryAtCreate === null ? 'GET /documents/:id 失败' : summaryAtCreate.id,
  );

  // —— 2) 卡片 → 编辑器 ——
  await page.goto(editorUrlFromCard(href, ctx), {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  try {
    await waitCanvasReady();
  } catch (error) {
    steps.push(step('编辑器画布就绪（挂载 + Skia + 首帧）', 'fail', String(error).slice(0, 200)));
    return { steps };
  }

  // 顶栏显示**真实文档名**（缺陷现场恒为「未命名设计文件」）
  try {
    await page.waitForFunction(
      (name) => document.querySelector('[data-df-document-name]')?.textContent === name,
      DOCUMENT_NAME,
      { timeout: 30_000 },
    );
    ctx.assert(true, '顶栏显示真实文档名', DOCUMENT_NAME);
  } catch {
    const actual = await page
      .locator('[data-df-document-name]')
      .textContent()
      .catch(() => null);
    ctx.assert(false, '顶栏显示真实文档名', `实际显示：${actual ?? '(无读点)'}`);
  }

  // 载入结果落到画布会话：文档 id / 页面 id / 文档名三处一致
  const loadedDocumentId = await api.documentId();
  const loadedPageId = await api.pageId();
  ctx.assert(
    loadedDocumentId === DOCUMENT_NAME && loadedPageId === 'page-1',
    '载入的文档落到画布会话（daemon 文档 id + page-1）',
    { documentId: loadedDocumentId, pageId: loadedPageId, name: await api.documentName() },
  );

  // —— 3) 工具拖画（用户路径：点工具栏矩形工具 → 画布拖拽）——
  await page.locator('[data-df-tool="rect"]').click();
  const box = await page.locator('canvas[data-df-canvas]').boundingBox();
  const viewport = await api.viewport();
  const toPage = (point) => ({
    x: box.x + point.x * viewport.zoom + viewport.panX,
    y: box.y + point.y * viewport.zoom + viewport.panY,
  });
  const countBefore = await api.nodeCount();
  const from = toPage(DRAW_FROM);
  const to = toPage(DRAW_TO);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const countAfterDraw = await api.nodeCount();
  ctx.assert(countAfterDraw === countBefore + 1, '工具拖画落成一个新节点（D-1 回归）', {
    before: countBefore,
    after: countAfterDraw,
  });
  const ids = await api.nodeIds();
  const drawnId = ids[ids.length - 1];
  const drawn = drawnId === undefined ? null : await api.geometry(drawnId);
  ctx.assert(
    drawn !== null &&
      Math.abs(drawn.width - (DRAW_TO.x - DRAW_FROM.x)) < 2 &&
      Math.abs(drawn.height - (DRAW_TO.y - DRAW_FROM.y)) < 2,
    '拖画尺寸与指针轨迹一致',
    drawn,
  );

  // —— 4) 选中 + 改属性（Inspector 的 X 字段）——
  const center = toPage({
    x: (DRAW_FROM.x + DRAW_TO.x) / 2,
    y: (DRAW_FROM.y + DRAW_TO.y) / 2,
  });
  await page.mouse.click(center.x, center.y);
  const selection = await api.selection();
  ctx.assert(
    drawnId !== undefined && selection.includes(drawnId),
    '点击画布选中新节点（选择集与画布同源）',
    selection,
  );

  const xField = page.locator('[data-df-inspector-field="x"] input');
  await xField.waitFor({ timeout: 10_000 });
  await xField.fill(String(MOVED_X));
  await xField.press('Enter');
  await page.waitForFunction(
    ([id, x]) => {
      const node = globalThis.__dforgeCanvas?.geometry(id);
      return node !== null && node !== undefined && node.x === x;
    },
    [drawnId ?? '', MOVED_X],
    { timeout: 10_000 },
  );
  const moved = drawnId === undefined ? null : await api.geometry(drawnId);
  ctx.assert(moved !== null && moved.x === MOVED_X, 'Inspector 改 X 落进文档真值', moved);

  // —— 5) 保存（顶栏按钮 + 保存态）——
  const saveStateBefore = await page
    .locator('[data-df-save-state]')
    .getAttribute('data-df-save-state');
  ctx.assert(saveStateBefore === 'dirty', '编辑后保存态为「未保存」', saveStateBefore);

  await page.locator('[data-df-save-action="save"]').click();
  try {
    await page.waitForFunction(
      () =>
        document.querySelector('[data-df-save-state]')?.getAttribute('data-df-save-state') ===
        'saved',
      null,
      { timeout: 30_000 },
    );
    ctx.assert(true, '保存成功：顶栏保存态转「已保存」');
  } catch {
    const actual = await page
      .locator('[data-df-save-state]')
      .getAttribute('data-df-save-state')
      .catch(() => null);
    const text = await page
      .locator('[data-df-save-state]')
      .textContent()
      .catch(() => null);
    ctx.assert(
      false,
      '保存成功：顶栏保存态转「已保存」',
      `state=${actual ?? '?'} text=${text ?? '?'}`,
    );
  }

  // daemon 侧独立证据：页面正文里真的有这个节点（缺陷现场是 0 图层）
  const stored = await fetch(
    `${ctx.daemonUrl}/documents/${encodeURIComponent(DOCUMENT_NAME)}/pages/page-1`,
  )
    .then((response) => response.json())
    .catch(() => null);
  const storedNodes = stored?.result?.body?.page?.nodes ?? null;
  ctx.assert(
    storedNodes !== null && drawnId !== undefined && storedNodes[drawnId] !== undefined,
    '保存后 daemon 侧页面正文含该节点（不再 0 图层）',
    storedNodes === null ? '读取失败' : `${Object.keys(storedNodes).length} 个节点`,
  );

  // —— 6) 回首页：卡片仍在且元信息反映最新保存 ——
  await page.goto(ctx.homeUrl, { waitUntil: 'networkidle' });
  const cardAgain = page.getByRole('link', { name: `打开「${DOCUMENT_NAME}」` });
  await cardAgain.waitFor({ timeout: 10_000 });

  // daemon 侧独立证据（卡片的「更新于」与「N 个页面」都要对着它判）
  const summaryAfterSave = await daemonSummary();
  const cardMeta = (await cardAgain.locator('.dfg-home__card-meta').textContent()) ?? '';
  // 真实断言（复核 Spec c · e2e 断言加强）：卡片页面数取「N 个页面 · …」里的 N，
  // 必须与 daemon 实测 pageCount 逐数一致——旧断言只看「含『个页面』」，写死成
  // 「999 个页面」也会绿。
  const metaPageCount = /(\d+)\s*个页面/.exec(cardMeta)?.[1] ?? null;
  ctx.assert(
    metaPageCount !== null &&
      summaryAfterSave !== null &&
      metaPageCount === String(summaryAfterSave.pageCount),
    '首页卡片「N 个页面」与 daemon 实际页数一致',
    { cardMeta, pageCount: summaryAfterSave?.pageCount ?? null },
  );

  ctx.assert(
    summaryAfterSave !== null &&
      summaryAtCreate !== null &&
      summaryAfterSave.updatedAt !== summaryAtCreate.updatedAt,
    '保存后文档更新时间前进（首页卡片的「更新于」依据）',
    { before: summaryAtCreate?.updatedAt ?? null, after: summaryAfterSave?.updatedAt ?? null },
  );

  // —— 7) 从卡片重开：逐字段恢复 ——
  await page.goto(editorUrlFromCard((await cardAgain.getAttribute('href')) ?? href, ctx), {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  try {
    await waitCanvasReady();
    await page.waitForFunction(
      ([id, x, y, width, height]) => {
        const node = globalThis.__dforgeCanvas?.geometry(id);
        return (
          node !== null &&
          node !== undefined &&
          node.x === x &&
          node.y === y &&
          node.width === width &&
          node.height === height
        );
      },
      [drawnId ?? '', moved?.x ?? 0, moved?.y ?? 0, drawn?.width ?? 0, drawn?.height ?? 0],
      { timeout: 45_000 },
    );
    const restored = drawnId === undefined ? null : await api.geometry(drawnId);
    ctx.assert(
      restored !== null && restored.x === moved?.x && restored.width === drawn?.width,
      '重开逐字段恢复（几何往返一致）',
      restored,
    );
  } catch (error) {
    steps.push(step('重开逐字段恢复', 'fail', String(error).slice(0, 200)));
  }

  // —— 8) 导出（右栏「导出」页签：PNG / SVG / PDF）——
  //
  // 判定分两层：① UI 完成态只证明「面板收到响应」（保留，但名称注明非产物判定）；
  // ② 对 UI 实际收到的响应做产物内容断言（F-07-01 的回归面）。产物同时落盘到
  //    `<场景数据根>/../export-artifacts/`，供报告与外部工具复核。
  const pageBody = stored?.result?.body?.page ?? null;
  const shapeNode = pageBody?.nodes?.[drawnId] ?? null;
  const shapeColor =
    shapeNode?.fills?.find?.((fill) => typeof fill?.color === 'string')?.color ?? null;
  const expectedBackground = pageBody?.backgroundColor ?? null;
  const expected = {
    width: 1440,
    height: 900,
    background: expectedBackground,
    shapes:
      shapeNode === null || shapeNode === undefined
        ? []
        : [
            {
              x: shapeNode.x,
              y: shapeNode.y,
              width: shapeNode.width,
              height: shapeNode.height,
              color: shapeColor,
            },
          ],
  };
  const artifactDir = join(ctx.dataRoot, '..', 'export-artifacts');
  mkdirSync(artifactDir, { recursive: true });
  const exportReport = {
    ticket: 'audit-08',
    documentId: DOCUMENT_NAME,
    pageId: 'page-1',
    expected,
    artifacts: [],
  };
  ctx.assert(
    pageBody !== null &&
      shapeNode !== null &&
      shapeNode !== undefined &&
      shapeColor !== null &&
      expectedBackground !== null,
    '导出内容断言的期望值可独立取得（daemon 页面正文）',
    JSON.stringify({
      hasPage: pageBody !== null,
      hasNode: shapeNode !== null && shapeNode !== undefined,
      shapeColor,
      expectedBackground,
    }),
  );

  try {
    await page.locator('.dfg-segmented__item', { hasText: '导出' }).first().click();
    await page.locator('[data-df-inspect="export-png"]').waitFor({ timeout: 10_000 });
  } catch (error) {
    steps.push(step('打开导出页签', 'fail', String(error).slice(0, 300)));
    return { steps };
  }

  for (const format of ['png', 'svg', 'pdf']) {
    const upper = format.toUpperCase();
    try {
      // 先挂响应监听再点击：拿到的是 UI 本条请求的响应，不是事后二次请求。
      const responsePromise = waitForExportResponse(page, format).catch(() => null);
      await page.locator(`[data-df-inspect="export-${format}"]`).click();
      await page.waitForSelector(
        `[data-df-inspect="export-${format}-done"], [data-df-inspect="export-${format}-error"]`,
        { timeout: 30_000 },
      );

      const errorText = await page
        .locator(`[data-df-inspect="export-${format}-error"]`)
        .textContent()
        .catch(() => null);
      if (errorText !== null) {
        ctx.assert(false, `编辑器内导出 ${upper} 失败态`, errorText.slice(0, 300));
        exportReport.artifacts.push({ format, ui: 'error', errorText: errorText.slice(0, 500) });
        continue;
      }

      const doneText =
        (await page.locator(`[data-df-inspect="export-${format}-done"]`).textContent()) ?? '';
      // 仅 UI 完成态：明确标注「非产物判定」，避免下一轮又把文案绿当产物绿。
      ctx.assert(
        doneText.includes(`.${format}`),
        `编辑器内导出 ${upper} 完成态（UI 文案，非产物判定）`,
        doneText,
      );

      const response = await responsePromise;
      if (response === null) {
        ctx.assert(false, `导出 ${upper} 响应可捕获（UI 实际请求）`, '未捕获到 POST /export 响应');
        exportReport.artifacts.push({ format, ui: 'missing-response' });
        continue;
      }
      const payload = await response.json().catch(() => null);
      const artifact = decodeArtifactPayload(payload);
      const responseUrl = response.url();
      ctx.assert(
        response.status() === 200 && artifact !== null,
        `导出 ${upper} 响应信封含可用产物（HTTP 200 + base64）`,
        JSON.stringify({
          status: response.status(),
          url: responseUrl,
          ok: payload?.ok ?? null,
          code: payload?.error?.code ?? null,
        }),
      );
      if (artifact === null) {
        exportReport.artifacts.push({ format, ui: 'bad-response', status: response.status() });
        continue;
      }

      const filePath = join(artifactDir, basename(artifact.fileName || `export.${format}`));
      writeFileSync(filePath, artifact.bytes);
      const record = {
        format,
        fileName: artifact.fileName,
        filePath,
        length: artifact.length,
        sha256: artifact.sha256,
        sha256Matches: artifact.sha256Matches,
        lengthMatches: artifact.lengthMatches,
        responseUrl,
      };
      ctx.assert(
        artifact.sha256Matches === true && artifact.lengthMatches === true,
        `导出 ${upper} 产物的 length/sha256 与 bytes 自洽`,
        JSON.stringify({
          length: artifact.length,
          bytes: artifact.bytes.length,
          sha256Matches: artifact.sha256Matches,
          lengthMatches: artifact.lengthMatches,
        }),
      );

      if (format === 'png') {
        const inspection = inspectPng(artifact.bytes, expected);
        record.inspection = inspection;
        ctx.assert(
          inspection.width === expected.width && inspection.height === expected.height,
          '导出 PNG 尺寸正确（1440×900）',
          JSON.stringify({ width: inspection.width, height: inspection.height }),
        );
        ctx.assert(
          inspection.ok,
          '导出 PNG 含设计内容（页面底色 + 矩形填充像素）',
          JSON.stringify({
            problems: inspection.problems,
            backgroundSample: inspection.backgroundSample,
            backgroundMatches: inspection.backgroundMatches,
            nonBackgroundPixels: inspection.nonBackgroundPixels,
            shapes: inspection.shapes.map(({ match, sample, matchedPixels, area }) => ({
              match,
              sample,
              matchedPixels,
              area,
            })),
          }),
        );
      } else if (format === 'svg') {
        const text = artifact.bytes.toString('utf8');
        const inspection = inspectSvg(text, expected);
        record.inspection = inspection;
        ctx.assert(
          inspection.width === expected.width && inspection.height === expected.height,
          '导出 SVG 尺寸正确（1440×900）',
          JSON.stringify({ width: inspection.width, height: inspection.height }),
        );
        ctx.assert(
          inspection.ok,
          '导出 SVG 含设计节点（背景之外）',
          JSON.stringify({
            problems: inspection.problems,
            rectCount: inspection.rectCount,
            drawableCount: inspection.drawableCount,
            backgroundMatches: inspection.backgroundMatches,
            shapes: inspection.shapes,
          }),
        );
      } else if (format === 'pdf') {
        const structure = inspectPdf(artifact.bytes);
        const info = pdfInfo(filePath);
        const render = renderPdfPage(filePath, join(artifactDir, 'pdf-page-1'));
        const structureOk =
          structure.isPdf &&
          structure.pageCount === 1 &&
          structure.mediaBox !== null &&
          structure.mediaBox.width === expected.width &&
          structure.mediaBox.height === expected.height;
        ctx.assert(
          structureOk,
          '导出 PDF 结构/页尺寸正确（单页 1440×900）',
          JSON.stringify({
            isPdf: structure.isPdf,
            pageCount: structure.pageCount,
            mediaBox: structure.mediaBox,
            pdfinfo: info.blocked
              ? 'blocked: pdfinfo 不可用'
              : { pages: info.pages, pageSize: info.pageSize },
          }),
        );

        let contentOk = false;
        let contentDetail = {};
        if (!render.blocked && render.pngPath !== null) {
          const rendered = inspectPng(readFileSync(render.pngPath), expected);
          contentOk = rendered.ok;
          contentDetail = {
            mode: 'pdftoppm 外部渲染像素',
            problems: rendered.problems,
            backgroundSample: rendered.backgroundSample,
            backgroundMatches: rendered.backgroundMatches,
            nonBackgroundPixels: rendered.nonBackgroundPixels,
            shapes: rendered.shapes.map(({ match, sample, matchedPixels, area }) => ({
              match,
              sample,
              matchedPixels,
              area,
            })),
          };
        } else {
          // 降级：外部渲染工具缺失/失败 → 结构 + 内容流填充色断言（报告须注明）。
          contentOk =
            pdfHasFillColor(structure, shapeColor ?? '') &&
            structure.fillRectCount >= 2 &&
            structure.fillColors.length >= 2;
          contentDetail = {
            mode: '降级：内容流填充色断言',
            reason: render.reason ?? render.stderr ?? 'pdftoppm 失败',
            fillColors: structure.fillColors,
            fillRectCount: structure.fillRectCount,
            expectedFill: shapeColor,
            structureFillMatch: pdfHasFillColor(structure, shapeColor ?? ''),
          };
        }
        record.structure = structure;
        record.pdfInfo = info;
        record.pdfRender = render;
        record.pdfContent = contentDetail;
        ctx.assert(
          contentOk,
          '导出 PDF 含设计内容（外部渲染像素或内容流填充色）',
          JSON.stringify(contentDetail),
        );
      }
      exportReport.artifacts.push(record);
    } catch (error) {
      steps.push(step(`编辑器内导出 ${upper}`, 'fail', String(error).slice(0, 300)));
      exportReport.artifacts.push({ format, error: String(error).slice(0, 500) });
    }
  }
  writeFileSync(
    join(artifactDir, 'export-verification.json'),
    `${JSON.stringify(exportReport, null, 2)}\n`,
    'utf8',
  );

  // —— 9) 四类不变量（审计 08）：请求只在同源网关、无 console/pageerror ——
  const gatewayOrigin = new URL(ctx.pageUrl).origin;
  const httpRequests = pageRequests.filter((url) => /^https?:\/\//.test(url));
  const foreign = httpRequests.filter((url) => new URL(url).origin !== gatewayOrigin);
  ctx.assert(
    foreign.length === 0,
    '编辑器全程请求都在同源网关（无直连 daemon / 非网关 origin）',
    JSON.stringify({ requests: httpRequests.length, gatewayOrigin, foreign: foreign.slice(0, 5) }),
  );
  const resident = httpRequests.filter((url) => /:(?:3000|4318)(?:\/|$)/.test(url));
  ctx.assert(
    resident.length === 0,
    '无对 3000/4318 常驻实例的调用（不碰真实数据根）',
    JSON.stringify({ resident: resident.slice(0, 5) }),
  );
  // 已知且已登记的观察（审计 04 · F-04 文档探测 404）：打开文档时按 page-{N} 顺序探测，
  // 第一个缺失页产生一条资源 404 console 错误。它不属于本票缺陷，单独放行并计数；
  // 其余 console 错误一律判红。
  const probe404 = consoleErrors.filter((entry) =>
    /\/documents\/[^/]+\/pages\/page-\d+$/.test(entry.url),
  );
  const otherConsole = consoleErrors.filter((entry) => !probe404.includes(entry));
  ctx.assert(
    otherConsole.length === 0,
    '无 console 错误（仅允许已登记的文档页探测 404）',
    JSON.stringify({
      consoleErrors: consoleErrors.length,
      allowedProbe404: probe404.length,
      other: otherConsole.slice(0, 3),
    }),
  );
  ctx.assert(
    pageErrors.length === 0,
    '无未捕获异常（pageerror）',
    JSON.stringify({ pageErrors: pageErrors.slice(0, 3) }),
  );

  return { steps };
}
