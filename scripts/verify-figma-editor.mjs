#!/usr/bin/env node
/**
 * verify-figma-editor —— 编辑器壳层对照门禁（FE-03 交付；本票范围内自管，**不接 CI**）。
 *
 * 对照面：`/editor` 页里带 `data-df-preview="editor/<单元>"` 的单元（顶栏/工具条/缩放菜单/
 * 画布列/命令面板/快捷键说明/HUD/主菜单）。静态单元直接取样；**交互态单元**先按剧本
 * 驱动页面（⌘K 开面板、点缩放菜单、⌘/ 开说明、⌘+ 触发 HUD…）再取样。
 * 参照集：`~/df-evidence/reference-v1/`（REF-01 冻结；文件名 = 取样名把 `/` 换成 `_`）。
 * 判定：pixelmatch 8.0.0（threshold 0.1，默认忽略抗锯齿像素；研究 #5 口径）逐单元比对，
 *       差异像素率 ≤ `--max-ratio`（默认 0.001，即 A 级 0.1%）为通过。
 * 状态覆盖：验收标准 §5 六态逐项挂点（见 `UNITS` 的 state 字段与 `STATE_NOTES`）；
 *           无参照集时全部记 `pending` 并整体 exit 2（禁止假绿）。
 *
 * 取证实现统一在 `scripts/lib/figma-evidence.mjs`（arch-04）：本脚本只声明**单元表 +
 * 每单元的 prepare 剧本**（另含本面独有的深色主题守卫）。每个单元开一张干净页，
 * 交互剧本互不污染。
 *
 * **语义变化（arch-04 登记）**：Chromium 解析统一走 `lib/browser-toolchain.mjs` 的
 * `resolveChromeExecutable()`，即 `BENCH_CHROME_EXECUTABLE` **存在才采用**。此前本门禁
 * 对非法 env 会带病进入浏览器阶段（稍后崩），现在直接 exit 2 阻塞（与 lib 及 shell-parity 同口径）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-figma-editor.mjs                    # 默认 http://127.0.0.1:3210/editor
 *   DF_WEB_URL=http://127.0.0.1:3000 node scripts/verify-figma-editor.mjs
 *   node scripts/verify-figma-editor.mjs --only editor/topbar --verbose
 *
 * 环境变量：DF_WEB_URL（站点）、DF_REF_DIR（参照集）、DF_EVIDENCE_DIR（证据根）、
 *           BENCH_CHROME_EXECUTABLE（Chromium 可执行文件；否则自动探测缓存）。
 *
 * 退出码（门禁三态，禁止假绿）：0 全部通过 / 1 有单元超差 / 2 **阻塞**
 * （参照集未冻结 / 站点不可达 / Chromium 或依赖缺失）——`2` 绝不等价于通过。
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { runFigmaGate } from './lib/figma-evidence.mjs';

const WEB_URL = process.env.DF_WEB_URL ?? 'http://127.0.0.1:3210';
const REF_DIR = resolve(process.env.DF_REF_DIR ?? join(homedir(), 'df-evidence', 'reference-v1'));
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const TICKET = 'fe-03';
const PAGE = '/editor';
const THRESHOLD = 0.1;
const STATES = ['hover', 'active', 'disabled', 'loading', 'empty', 'error'];

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = flagValue('--only');
const maxRatio = Number(flagValue('--max-ratio') ?? '0.001');

/**
 * 取样单元：`id` 即 `data-df-preview` 的值。
 * `prepare` 为交互剧本（在取样前执行）；`state` 用于状态覆盖清单归口。
 */
const UNITS = [
  {
    id: 'editor/topbar',
    state: 'disabled',
    note: '默认含禁用入口（分享/演示/评论/版本未注册命令）',
  },
  { id: 'editor/toolbar', state: 'active', note: '默认含 active 工具块（aria-pressed=true）' },
  { id: 'editor/canvas', state: 'empty', note: '空槽态（FE-06 挂载前）' },
  {
    id: 'editor/zoom-menu',
    state: 'hover',
    note: '开菜单后取样；hover 由脚本施加状态强制类 dfg-state-hover',
    prepare: async (page) => {
      await page.click('.dfg-editor-zoom__trigger');
    },
  },
  {
    id: 'editor/app-menu',
    state: 'hover',
    note: '开主菜单后取样（文件/视图/帮助三区，含禁用条目）',
    prepare: async (page) => {
      await page.click('.dfg-editor-appmenu__trigger');
    },
  },
  {
    id: 'editor/command-palette',
    state: 'default',
    note: '⌘K 打开；分组 + 最近使用 + 输入光标',
    prepare: async (page) => {
      await page.keyboard.press('Meta+k');
      await page.waitForSelector('[data-df-preview="editor/command-palette"]');
    },
  },
  {
    id: 'editor/shortcuts',
    state: 'default',
    note: '⌘/ 打开两栏对照表（命令 | 快捷键，内容由命令注册表派生）',
    prepare: async (page) => {
      await page.keyboard.press('Meta+Slash');
      await page.waitForSelector('[data-df-preview="editor/shortcuts"]', { timeout: 5000 });
    },
  },
  {
    id: 'editor/hud',
    state: 'default',
    note: '⌘+ 触发缩放 → HUD 反白小条（autoHideMs 内取样）',
    prepare: async (page) => {
      await page.keyboard.press('Meta+Equal');
      await page.waitForSelector('[data-df-preview="editor/hud"]', { timeout: 2000 });
    },
  },
];

/** 六态挂点说明（无单元可取样时如实记录待办，不假绿）。 */
const STATE_NOTES = {
  hover: '缩放菜单/主菜单开合态 + 状态强制类（dfg-state-hover）',
  active: '工具块 aria-pressed=true（截图即默认态）；focus-visible 由强制类 dfg-state-focus 复现',
  disabled: '顶栏未注册命令入口（禁用 + 原因提示）',
  loading: '暂无挂点：壳层无异步加载面；画布加载态归 FE-06（verify-canvas）',
  empty: '画布/面板空槽态',
  error: '暂无挂点：命令失败态由 vitest 覆盖（面板 role="alert"）；页级错误态随 daemon 接入再取证',
};

await runFigmaGate({
  gateName: 'verify-figma-editor',
  ticket: TICKET,
  page: PAGE,
  level: 'A（布局/几何/颜色；字形与阴影按 B 级人工复核）',
  params: {
    threshold: THRESHOLD,
    maxRatio,
    engine: 'pixelmatch@8.0.0',
    aaIgnore: true,
    engineVersionNote: '升级比对库 = 重定基线（研究 #5 §3.4）',
  },
  viewport: { width: 1440, height: 900, dpr: 1.5 },
  extras: { webUrl: WEB_URL },
  stateCoverage: STATES.map((state) => ({
    state,
    units: UNITS.filter((unit) => unit.state === state).map((unit) => unit.id),
    status: 'pending',
    note: STATE_NOTES[state],
  })),
  recordKey: 'units',
  evidenceShape: 'editor',
  referenceDir: REF_DIR,
  evidenceRoot: EVIDENCE_ROOT,
  url: `${WEB_URL}${PAGE}`,
  only,
  units: UNITS,
  capture: { kind: 'element', freshContext: true, requireUnit: 'missing-unit' },
  thresholds: { threshold: THRESHOLD, maxRatio },
  reference: {
    when: 'early',
    message: (_ctx, reference) => [
      '阻塞：参照集未冻结（REF-01 未完成）。',
      `原因：${reference.reason}`,
      `待办：冻结 ${UNITS.length} 个单元（${UNITS.map((unit) => unit.id.replaceAll('/', '_')).join(
        ', ',
      )}）后运行本门禁取证；在此之前任何「通过」都是假绿。`,
    ],
    onBlocked: (ctx) => {
      ctx.evidence.units = UNITS.map((unit) => ({
        id: unit.id,
        status: 'missing-reference',
        reference: join(REF_DIR, `${unit.id.replaceAll('/', '_')}.png`),
      }));
      ctx.evidence.stateCoverage = ctx.evidence.stateCoverage.map((item) => ({
        ...item,
        status: 'pending',
        note: `${item.note ?? ''}（REF-01 未完成：参照集未冻结，本门禁按三态退出码记阻塞）`,
      }));
    },
  },
  probe: {
    url: `${WEB_URL}${PAGE}`,
    mode: 'follow',
    reason: (_ctx, result) => `站点不可达：${WEB_URL}${PAGE}（HTTP ${String(result.status)}）`,
    message: () => [
      '阻塞：编辑器站点不可达（本门禁需 `/editor` 可访问）。',
      '提示：先起站点（如 pnpm --filter @dforge/web build && pnpm --filter @dforge/web start），',
      '或设置 DF_WEB_URL 指向已运行实例。',
    ],
  },
  chrome: {},
  hooks: {
    // 深色基准守卫：编辑器页必须在根元素上落 data-theme="dark"（验收标准 §3 逐页对齐）
    beforeCapture: async ({ record, page }) => {
      const theme = await page.getAttribute('html', 'data-theme');
      if (theme !== 'dark') {
        record.status = 'theme-mismatch';
        record.theme = theme;
        return { skip: true, failure: true };
      }
      return undefined;
    },
    // 取样过的单元把状态清账为「已有取证」（结论 A 级=pass/fail，B 级=人工复核）
    afterUnits: (ctx) => {
      ctx.evidence.stateCoverage = ctx.evidence.stateCoverage.map((item) => {
        const sampled = ctx.targets.filter((unit) => unit.state === item.state);
        if (sampled.length === 0) return item;
        return { ...item, status: 'sampled', sampled: sampled.map((unit) => unit.id) };
      });
    },
  },
  verbose,
  messages: {
    pass: (ctx) =>
      `通过：${String(ctx.targets.length)} 个单元全部在容差内（≤ ${(maxRatio * 100).toFixed(2)}%）。`,
    fail: (ctx) =>
      `违规：${String(ctx.failures)} 个单元超差/参照缺失/挂点不稳（逐单元明细见证据 JSON）。`,
  },
});
