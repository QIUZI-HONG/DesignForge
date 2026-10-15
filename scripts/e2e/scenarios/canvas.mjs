/**
 * e2e 场景 · 画布（FE-06）：**拖画 → 持久化 → 导出/导入往返**。
 *
 * 契约（FE-02 简报 §3）：模块导出 `run(page, ctx)`，由 runner 提供
 * `ctx = { webUrl, daemonUrl, canvasUrl, log, assert, routeDaemon }`。
 * 本场景不依赖 runner 的具体实现，因此 FE-02 的正式 runner 合入后直接可用。
 *
 * 覆盖（对应 issue #19 的门禁要求）：
 * 1. 用「矩形工具」在画布上**拖画**出一个新节点（真实指针事件）；
 * 2. 保存到本地 daemon（`.dfg` 目录态）→ 带 `?doc=` 重载 → 断言节点恢复（持久化往返）；
 * 3. 导出 IR（稳定键序 JSON）→ 导入 → 断言节点数与几何往返一致（导出/导入往返）。
 */

const PREFIX = '[canvas]';

/** 读取调试句柄（门禁挂点：见 features/canvas/debug/canvas-debug.ts）。 */
async function handle(page, fn, arg) {
  return page.evaluate(fn, arg);
}

export async function run(page, ctx) {
  const log = (message) => ctx.log(`${PREFIX} ${message}`);
  ctx.assert(typeof ctx.routeDaemon === 'function', 'runner 提供 daemon 转发钩子');
  await ctx.routeDaemon();

  // 首屏放宽：next dev 首次编译 + 7MB Skia wasm 冷启动可能超过默认 30s
  await page.goto(ctx.canvasUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('canvas[data-df-canvas]');
  await page.waitForFunction(
    () => globalThis.__dforgeCanvas?.runtime().canvasKit === 'ready',
    null,
    {
      timeout: 90000,
    },
  );
  await page.waitForFunction(
    () => (globalThis.__dforgeCanvas?.runtime().frameCount ?? 0) >= 1,
    null,
    {
      timeout: 60000,
    },
  );
  log('画布挂载且首帧完成');

  const api = {
    geometry: (id) => handle(page, (nodeId) => globalThis.__dforgeCanvas.geometry(nodeId), id),
    nodeIds: () => handle(page, () => globalThis.__dforgeCanvas.nodeIds()),
    nodeCount: () => handle(page, () => globalThis.__dforgeCanvas.nodeCount()),
    documentId: () => handle(page, () => globalThis.__dforgeCanvas.documentId()),
    exportIr: () => handle(page, () => globalThis.__dforgeCanvas.exportIr()),
    importIr: (text) => handle(page, (value) => globalThis.__dforgeCanvas.importIr(value), text),
    viewport: () => handle(page, () => globalThis.__dforgeCanvas.viewport()),
    setSnap: (enabled) =>
      handle(page, (value) => globalThis.__dforgeCanvas.setSnap(value), enabled),
  };

  await api.setSnap(false);
  const countBefore = await api.nodeCount();

  // --- 1) 拖画：矩形工具 → 在画布上拖出一个矩形 ---
  await page.click('[data-df-studio-tool="rect"]').catch(async () => {
    // 宿主未暴露工具按钮时退化为键盘/命令路径：直接调用会话的创建工具（等价入口）
    await handle(page, () => globalThis.__dforgeCanvas.session().setTool('rect'));
  });
  const box = await page.locator('canvas[data-df-canvas]').boundingBox();
  const viewport = await api.viewport();
  const worldToPage = (world) => ({
    x: box.x + world.x * viewport.zoom + viewport.panX,
    y: box.y + world.y * viewport.zoom + viewport.panY,
  });
  const from = worldToPage({ x: 300, y: 500 });
  const to = worldToPage({ x: 460, y: 610 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const countAfterDraw = await api.nodeCount();
  ctx.assert(countAfterDraw === countBefore + 1, '拖画落成一个新节点', {
    before: countBefore,
    after: countAfterDraw,
  });
  const ids = await api.nodeIds();
  const drawnId = ids[ids.length - 1];
  const drawn = await api.geometry(drawnId);
  ctx.assert(
    drawn !== null && Math.abs(drawn.width - 160) < 2 && Math.abs(drawn.height - 110) < 2,
    '拖画尺寸与指针轨迹一致（宽 160 / 高 110）',
    drawn,
  );
  log(
    `拖画节点：${drawnId} ${JSON.stringify({ x: drawn.x, y: drawn.y, width: drawn.width, height: drawn.height })}`,
  );

  // --- 2) 持久化往返：保存 → 带 doc 重载 → 断言恢复 ---
  await page.click('[data-df-studio-action="save"]');
  const documentId = await page
    .waitForFunction(() => globalThis.__dforgeCanvas.documentId(), null, { timeout: 30000 })
    .then(() => api.documentId());
  ctx.assert(
    typeof documentId === 'string' && documentId.length > 0,
    '保存到本地 daemon 并拿到文档 id',
    documentId,
  );

  await page.goto(`${ctx.canvasUrl}&doc=${encodeURIComponent(documentId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('canvas[data-df-canvas]');
  await page.waitForFunction(
    ([id, x, y]) => {
      const node = globalThis.__dforgeCanvas?.geometry(id);
      return node !== null && node !== undefined && node.x === x && node.y === y;
    },
    [drawnId, drawn.x, drawn.y],
    { timeout: 45000 },
  );
  const restored = await api.geometry(drawnId);
  ctx.assert(
    restored !== null && restored.width === drawn.width && restored.height === drawn.height,
    '重载后拖画节点形状逐字段恢复',
    {
      drawn,
      restored,
    },
  );
  const restoredCount = await api.nodeCount();
  ctx.assert(restoredCount === countAfterDraw, '重载后节点数一致', {
    expected: countAfterDraw,
    actual: restoredCount,
  });
  log(`持久化往返完成（文档 ${documentId}）`);

  // --- 3) 导出 / 导入往返（稳定键序 IR） ---
  await api.setSnap(false);
  const exported = await api.exportIr();
  ctx.assert(
    typeof exported === 'string' && exported.includes('dforge.designir'),
    '导出 IR 带格式信封',
    {
      bytes: exported.length,
    },
  );
  const imported = await api.importIr(exported);
  ctx.assert(imported.ok === true, '导入 IR 通过结构校验', imported);
  await page.waitForTimeout(200);
  const afterImportCount = await api.nodeCount();
  const afterImport = await api.geometry(drawnId);
  ctx.assert(afterImportCount === restoredCount, '导入后节点数一致', {
    expected: restoredCount,
    actual: afterImportCount,
  });
  ctx.assert(
    afterImport !== null && afterImport.x === drawn.x && afterImport.y === drawn.y,
    '导入后几何逐字段一致（往返幂等）',
    { before: { x: drawn.x, y: drawn.y }, after: afterImport },
  );
  log('导出/导入往返完成');
}
