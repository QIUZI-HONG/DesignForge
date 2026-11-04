#!/usr/bin/env node
/**
 * verify-figma-panels —— 面板级对照门禁（FE-04 交付；本票范围内自管，**不接 CI**）。
 *
 * 对照面（C3/C4）：`/editor` 路由里挂载的图层面板与资产面板（`data-df-panel` 边界），
 * 以及验收标准 §5 的六态挂点（hover / active(focus-visible) / disabled / loading / empty / error）
 * 与 C3/C4 要点派生出的交互态（选中行、右键菜单、Token 分段、搜索无果）。
 *
 * 取样口径：**面板完整边界 + 8px 边距**（briefs/fe-04.md §4）——按元素包围盒外扩固定边距裁图，
 * 两侧（参照集与实际）同一 DPR（1.5，与《前端验收标准 v1》§3 一致）。
 *
 * 判定：pixelmatch 8.0.0（threshold 0.1，忽略抗锯齿像素）逐单元比对，
 * 差异像素率 ≤ `--max-ratio`（默认 0.001 = A 级 0.1%）为通过。
 *
 * 取证实现统一在 `scripts/lib/figma-evidence.mjs`（arch-04）：本脚本只声明**单元表 +
 * prepare 剧本**与面板级状态覆盖归口。
 *
 * **语义变化（arch-04 登记）**：Chromium 解析统一走 `lib/browser-toolchain.mjs` 的
 * `resolveChromeExecutable()`，即 `BENCH_CHROME_EXECUTABLE` **存在才采用**。此前本门禁
 * 对非法 env 会带病进入浏览器阶段（稍后崩），现在直接 exit 2 阻塞（与 lib 及 shell-parity 同口径）。
 *
 * 退出码（三态，**禁止假绿**）：
 *   0 = 全部通过；
 *   1 = 有单元超差或参照图缺失（参照集已冻结的前提下）；
 *   2 = **阻塞**——参照集未冻结（REF-01 未完成）/ 站点不可达 / 未找到 Chromium /
 *       或某些状态挂点在宿主页上还取不到（记录为 pending，绝不计为通过）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-figma-panels.mjs                      # 默认 http://127.0.0.1:3210/editor
 *   DF_PANELS_URL=http://127.0.0.1:3000/editor node scripts/verify-figma-panels.mjs
 *   node scripts/verify-figma-panels.mjs --only layers/panel --verbose
 *
 * 环境变量：DF_WEB_URL（站点根，默认 http://127.0.0.1:3210）、DF_PANELS_URL（面板页，优先）、
 *           DF_REF_DIR（参照集根，默认 ~/df-evidence/reference-v1，面板参照放在其 panels/ 子目录）、
 *           DF_EVIDENCE_DIR（证据根，默认 ~/df-evidence）、
 *           BENCH_CHROME_EXECUTABLE（Chromium 可执行文件；否则自动探测缓存）。
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { runFigmaGate } from './lib/figma-evidence.mjs';

const WEB_URL = process.env.DF_WEB_URL ?? 'http://127.0.0.1:3210';
const PANELS_URL = process.env.DF_PANELS_URL ?? `${WEB_URL}/editor`;
const REF_ROOT = resolve(process.env.DF_REF_DIR ?? join(homedir(), 'df-evidence', 'reference-v1'));
/** 面板参照集子目录：与组件级（FE-01）取样名空间隔离。 */
const REF_DIR = join(REF_ROOT, 'panels');
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const TICKET = 'fe-04';
const THRESHOLD = 0.1;
/** 面板取样边距（spec：面板完整边界 + 8px）。 */
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

/** 行选择器（面板行带 `data-df-layer-row`）。 */
const ROW = '[data-df-layer-row]';

/**
 * 取样单元：`root` 是面板/状态容器的选择器；`prepare` 把宿主页推进到该状态。
 * prepare 拿不到目标（宿主还没提供该状态）即抛错 → 记 pending + exit 2，绝不算通过。
 */
const SAMPLES = [
  {
    id: 'layers/panel',
    root: '[data-df-panel="layers"]',
    note: '图层面板整体（默认态：展开树 + 行）',
  },
  {
    id: 'layers/row-hover',
    root: '[data-df-panel="layers"]',
    note: '行悬停（验收 §5 hover 挂点：data-df-state="hover"）',
    prepare: async (page) => {
      await page.locator(ROW).first().hover();
      await page.waitForSelector(`${ROW}[data-df-state="hover"]`, { timeout: 2000 });
    },
  },
  {
    id: 'layers/row-selected',
    root: '[data-df-panel="layers"]',
    note: '行选中（引擎选择 → 面板高亮，data-df-state="selected"）',
    prepare: async (page) => {
      await page.locator(ROW).first().click();
      await page.waitForSelector(`${ROW}[data-df-state="selected"]`, { timeout: 2000 });
    },
  },
  {
    id: 'layers/row-focus',
    root: '[data-df-panel="layers"]',
    note: '行键盘焦点（验收 §5 active/focus-visible：data-df-focus="true"）',
    prepare: async (page) => {
      await page.locator(ROW).first().focus();
      await page.keyboard.press('ArrowDown');
      await page.waitForSelector(`${ROW}[data-df-focus="true"]`, { timeout: 2000 });
    },
  },
  {
    id: 'layers/row-disabled',
    root: '[data-df-panel="layers"]',
    note: '禁用态（祖先锁定的行按钮；验收 §5 disabled）',
    prepare: async (page) => {
      await page
        .locator(`${ROW} button:disabled`)
        .first()
        .waitFor({ state: 'attached', timeout: 2000 });
    },
  },
  {
    id: 'layers/menu-open',
    root: '[data-df-sample="layers/menu-open"]',
    note: '右键菜单（重命名/删除/编组/解组/上移到顶/下移到底）',
    prepare: async (page) => {
      await page.locator(ROW).first().click({ button: 'right' });
      await page.waitForSelector('[data-df-sample="layers/menu-open"]', { timeout: 2000 });
    },
  },
  {
    id: 'layers/empty',
    root: '[data-df-sample="layers/empty"]',
    note: '空态（无图层；验收 §5 empty，需宿主页提供空文档）',
  },
  {
    id: 'layers/loading',
    root: '[data-df-sample="layers/loading"]',
    note: '加载态（骨架行；验收 §5 loading，需宿主页提供 loading 语义）',
  },
  {
    id: 'layers/error',
    root: '[data-df-sample="layers/error"]',
    note: '错误态 + 重试（验收 §5 error，需宿主页提供 error 语义）',
  },
  {
    id: 'assets/components',
    root: '[data-df-sample="assets/components"]',
    note: '资产面板 · 组件分段（组件卡 + 组件紫缩略图）',
    prepare: openAssetsTab,
  },
  {
    id: 'assets/tokens',
    root: '[data-df-sample="assets/tokens"]',
    note: '资产面板 · Token 分段（别名已解析）',
    prepare: async (page) => {
      await openAssetsTab(page);
      await page.getByRole('radio', { name: 'Token' }).click();
      await page.waitForSelector('[data-df-sample="assets/tokens"]', { timeout: 2000 });
    },
  },
  {
    id: 'assets/no-results',
    root: '[data-df-sample="assets/no-results"]',
    note: '搜索无果空态',
    prepare: async (page) => {
      await openAssetsTab(page);
      await page.getByPlaceholder('搜索资产').fill('不存在的资产名');
      await page.waitForSelector('[data-df-sample="assets/no-results"]', { timeout: 2000 });
    },
  },
  {
    id: 'assets/empty',
    root: '[data-df-sample="assets/empty"]',
    note: '空态（无组件；需宿主页提供无组件文档）',
  },
  {
    id: 'assets/loading',
    root: '[data-df-sample="assets/loading"]',
    note: '加载态（骨架卡）',
  },
  {
    id: 'assets/error',
    root: '[data-df-sample="assets/error"]',
    note: '错误态 + 重试',
  },
];

/** 切到资产页签（宿主若是组合左栏；若已直接渲染资产面板则跳过）。 */
async function openAssetsTab(page) {
  if ((await page.locator('[data-df-panel="assets"]').count()) > 0) return;
  await page.getByRole('radio', { name: '资产' }).click({ timeout: 3000 });
  await page.waitForSelector('[data-df-panel="assets"]', { timeout: 3000 });
}

await runFigmaGate({
  gateName: 'verify-figma-panels',
  ticket: TICKET,
  page: PANELS_URL,
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
  extras: { webUrl: WEB_URL, panelsUrl: PANELS_URL },
  stateCoverage: STATES.map((state) => ({ state, samples: [], status: 'pending' })),
  recordKey: 'samples',
  evidenceShape: 'sample',
  referenceDir: REF_DIR,
  evidenceRoot: EVIDENCE_ROOT,
  url: PANELS_URL,
  only,
  units: SAMPLES,
  capture: {
    kind: 'clip',
    margin: MARGIN,
    perUnitGoto: true,
    waitTimeout: 3000,
    unitError: 'pending',
  },
  thresholds: { threshold: THRESHOLD, maxRatio },
  reference: {
    when: 'early',
    message: (_ctx, reference) => [
      '阻塞：参照集未冻结（REF-01 未完成）。',
      `原因：${reference.reason}`,
      `面板参照集路径：${REF_DIR}（文件名 = 取样名把 / 换成 _，如 layers_panel.png）`,
      '待办：冻结参照集后运行本门禁逐单元取证；在此之前不得以自截图/近似图假绿。',
    ],
  },
  probe: {
    url: PANELS_URL,
    mode: 'manual',
    reason: (_ctx, result) => `面板页不可达：${PANELS_URL}（HTTP ${String(result.status)}）`,
    message: () => [
      '阻塞：面板页不可达（本门禁需面板可访问）。',
      '提示：先起站点（如 pnpm --filter @dforge/web build && pnpm --filter @dforge/web start），',
      '或设置 DF_PANELS_URL 指向已挂载面板的页面。',
    ],
  },
  chrome: {},
  mount: {
    selector: '[data-df-panel]',
    wait: false,
    reason: `页面未挂载面板（找不到 [data-df-panel]）：${PANELS_URL}`,
    message: () => [
      '阻塞：宿主页未挂载图层面板/资产面板。',
      '待办：FE-03 编辑器壳在编辑器路由挂载 `features/editor-panels` 的 EditorPanels（或单独挂 LayersPanel/AssetsPanel）后重跑。',
    ],
  },
  hooks: {
    afterUnits: (ctx) => {
      ctx.evidence.stateCoverage = ctx.evidence.stateCoverage.map((item) => {
        const hits = ctx.targets.filter((sample) => sample.id.endsWith(`/${item.state}`));
        return {
          ...item,
          samples: hits.map((sample) => sample.id),
          status: hits.length === 0 ? 'missing' : 'covered',
          note:
            hits.length === 0
              ? '本票未列出该态的独立取样单元（按需补挂点）。'
              : '有取样单元；待参照集冻结后逐单元出 A 级结论（缺项即缺陷）。',
        };
      });
    },
  },
  verbose,
  messages: {
    pass: (ctx) =>
      `通过：${String(ctx.targets.length)} 个取样单元全部在容差内（≤ ${(maxRatio * 100).toFixed(2)}%）。`,
    fail: (ctx) =>
      `违规：${String(ctx.failures)} 个单元超差或参照图缺失（逐单元明细见证据 JSON）。`,
    pending: (ctx) => [
      `阻塞：${String(ctx.pending)} 个取样单元的状态在宿主页上取不到（记录为 pending，不计通过）。`,
      '提示：宿主页需要提供对应状态（空文档 / loading / error / 锁定祖先等），见各单元 note。',
    ],
  },
});
