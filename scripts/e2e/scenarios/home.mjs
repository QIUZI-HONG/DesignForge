/**
 * 冒烟场景 · 首页 / 文件浏览器（FE-02 · 清单 B 区）。
 *
 * 主路径（简报 §3）：打开首页 → 新建文档 → 进入编辑器 → 断言持久化。
 * 本场景把这条路径拆成可核对的步骤，并对「编辑器路由尚未落地」这一前置
 * **如实标记 blocked**（FE-03 并行落地中）——不伪造通过、也不把集成分支的
 * 缺口算成本票缺陷。
 *
 * 场景协议见 `scripts/e2e-smoke.mjs` 头部注释。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const id = 'home';
export const title = '首页 / 文件浏览器（FE-02 · B 区）';

/** 场景内新建的文档名（中文，本地优先口径；同时也是 `.dfg` 目录名）。 */
const DOCUMENT_NAME = '冒烟文档';

/** 断言辅助：passthrough 记录步骤。 */
function step(name, status, detail) {
  return detail === undefined ? { name, status } : { name, status, detail };
}

/** 主入口。 */
export async function run(page, ctx) {
  const steps = [];

  // 1) daemon 活着（本 runner 已把它拉起来；这里再核一次读链路口径）
  const health = await fetch(`${ctx.daemonUrl}/health`).catch(() => null);
  if (health === null || !health.ok) {
    steps.push(step('本地服务可达', 'blocked', `daemon /health 不可达：${ctx.daemonUrl}`));
    return { steps };
  }
  const healthBody = await health.json();
  steps.push(step('本地服务可达', 'pass', `dataRoot=${healthBody?.result?.dataRoot ?? '?'}`));

  // 2) 首页渲染（三区结构 + 空数据根下的「还没有设计文件」空态）
  await page.goto(ctx.homeUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('.dfg-home__sidebar');
  const hasSections =
    (await page.locator('.dfg-home__topbar').count()) > 0 &&
    (await page.locator('.dfg-home__content').count()) > 0;
  const emptyState = await page.getByText('还没有设计文件').count();
  steps.push(
    step(
      '首页渲染（侧栏/顶栏/内容区 + 空态）',
      hasSections && emptyState > 0 ? 'pass' : 'fail',
      hasSections ? `空态可见=${String(emptyState > 0)}` : '三区结构缺失',
    ),
  );

  // 3) 新建文档（走真实 UI：新建菜单 → 设计文件 → 命名 → 创建）
  // exact：顶栏「新建」与空态「新建设计文件」在模糊匹配下会撞名
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('menuitem', { name: '设计文件' }).click();
  const nameInput = page.getByRole('textbox', { name: '文件名称' });
  await nameInput.waitFor();
  await nameInput.fill(DOCUMENT_NAME);
  // 竞态硬化（UX-11）：fill 之后隔一次 CDP 往返再读——默认名若在「打开提交」之后
  // 才落位，会覆盖/拼接这次输入（实测形态「未命名设计冒烟文档」）。这里断言写入值
  // 立得住，把这类迟到覆盖固定在门禁上。
  const filledName = await nameInput.inputValue();
  steps.push(
    step(
      '名称输入立得住（无迟到覆盖）',
      filledName === DOCUMENT_NAME ? 'pass' : 'fail',
      `填入=${filledName}`,
    ),
  );
  if (filledName !== DOCUMENT_NAME) {
    await nameInput.fill(DOCUMENT_NAME);
  }
  await page.getByRole('button', { name: '创建', exact: true }).click();
  try {
    await page.getByRole('link', { name: `打开「${DOCUMENT_NAME}」` }).waitFor({ timeout: 8000 });
    steps.push(step('新建文档（UI 全链路）', 'pass', DOCUMENT_NAME));
  } catch (error) {
    steps.push(step('新建文档（UI 全链路）', 'fail', String(error)));
    return { steps };
  }

  // 4) 持久化：daemon 列表 + 磁盘上的 .dfg/manifest.json（两条独立证据）
  const listed = await fetch(`${ctx.daemonUrl}/documents`)
    .then((response) => response.json())
    .catch(() => null);
  const ids = (listed?.result?.documents ?? []).map((document) => document.id);
  const onDisk = existsSync(join(ctx.workspaceDir, `${DOCUMENT_NAME}.dfg`, 'manifest.json'));
  steps.push(
    step(
      '文档已落盘（daemon 列表 + 磁盘 manifest）',
      ids.includes(DOCUMENT_NAME) && onDisk ? 'pass' : 'fail',
      `daemonIds=[${ids.join(', ')}] onDisk=${String(onDisk)}`,
    ),
  );

  // 5) 刷新后仍在（持久化的第二证据；顺带覆盖载入态）
  await page.reload({ waitUntil: 'networkidle' });
  const survived = await page
    .getByRole('link', { name: `打开「${DOCUMENT_NAME}」` })
    .count()
    .catch(() => 0);
  steps.push(step('刷新后文档仍在列表', survived > 0 ? 'pass' : 'fail'));

  // 6) 卡片的跳转地址是编辑器契约（FE-03 的 /editor?documentId=…）
  const href =
    (await page.getByRole('link', { name: `打开「${DOCUMENT_NAME}」` }).getAttribute('href')) ?? '';
  const hrefOk =
    href.startsWith('/editor?documentId=') && href.includes(encodeURIComponent(DOCUMENT_NAME));
  steps.push(step('卡片指向编辑器路由', hrefOk ? 'pass' : 'fail', href));

  // 7) 进入编辑器：路由归 FE-03。未落地 → 置 blocked（不伪造通过）
  const editorResponse = await page.request.get(`${ctx.pageUrl}${href}`);
  if (editorResponse.status() === 404) {
    steps.push(
      step(
        '进入编辑器（/editor）',
        'blocked',
        'FE-03 的 /editor 尚未在集成分支落地（HTTP 404）；卡片跳转地址已按契约产出，待其合并后本步骤自动转 passthrough',
      ),
    );
    return { steps };
  }
  if (!editorResponse.ok()) {
    steps.push(
      step('进入编辑器（/editor）', 'blocked', `路由响应 HTTP ${String(editorResponse.status())}`),
    );
    return { steps };
  }

  await page.getByRole('link', { name: `打开「${DOCUMENT_NAME}」` }).click();
  await page.waitForURL('**/editor**', { timeout: 8000 });
  const editorBody = await page.locator('body').innerText();
  steps.push(
    step('进入编辑器（/editor）', editorBody.trim().length > 0 ? 'pass' : 'fail', page.url()),
  );
  return { steps };
}
