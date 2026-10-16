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
 */

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

/** 主入口。 */
export async function run(page, ctx) {
  const steps = [];

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
  const cardMeta = (await cardAgain.locator('.dfg-home__card-meta').textContent()) ?? '';
  ctx.assert(cardMeta.includes('个页面'), '首页卡片仍列出该文档（元信息可见）', cardMeta);

  const summaryAfterSave = await daemonSummary();
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
  try {
    await page.locator('.dfg-segmented__item', { hasText: '导出' }).first().click();
    await page.locator('[data-df-inspect="export-png"]').waitFor({ timeout: 10_000 });
    for (const format of ['png', 'svg', 'pdf']) {
      await page.locator(`[data-df-inspect="export-${format}"]`).click();
      await page.locator(`[data-df-inspect="export-${format}-done"]`).waitFor({ timeout: 30_000 });
      const doneText =
        (await page.locator(`[data-df-inspect="export-${format}-done"]`).textContent()) ?? '';
      ctx.assert(
        doneText.includes(`.${format}`),
        `编辑器内导出 ${format.toUpperCase()} 成功`,
        doneText,
      );
    }
  } catch (error) {
    steps.push(step('编辑器内导出 PNG/SVG/PDF', 'fail', String(error).slice(0, 300)));
  }

  return { steps };
}
