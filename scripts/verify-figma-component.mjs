#!/usr/bin/env node
/**
 * verify-figma-component —— 组件级对照门禁（FE-01 交付；本票范围内自管，**不接 CI**）。
 *
 * 对照面：`/_design` 预览页里每个带 `data-df-preview="<组件>/<变体>/<状态>"` 的单元。
 * 参照集：`~/df-evidence/reference-v1/`（REF-01 冻结，逐单元 PNG；文件名 = 取样名把 `/` 换成 `_`）。
 * 判定：pixelmatch 8.0.0（threshold 0.1，默认忽略抗锯齿像素；研究 #5 口径）逐单元比对，
 *       差异像素率 ≤ `--max-ratio`（默认 0.001，即 A 级 0.1%）为通过。
 * 状态覆盖：验收标准 §5 六态逐项挂点；无参照集时全部记 `pending` 并整体 exit 2（禁止假绿）。
 *
 * 取证实现统一在 `scripts/lib/figma-evidence.mjs`（arch-04）：站点探测、参照集冻结判定、
 * 截图、像素比对、证据落盘与三态出口只此一处；本脚本只声明**单元表 + prepare 剧本**
 * （本门禁无交互剧本，单元由页面的 `data-df-preview` 现采）。
 *
 * **语义变化（arch-04 登记）**：Chromium 解析统一走 `lib/browser-toolchain.mjs` 的
 * `resolveChromeExecutable()`，即 `BENCH_CHROME_EXECUTABLE` **存在才采用**。此前本门禁
 * 对非法 env 会带病进入浏览器阶段（稍后崩），现在直接 exit 2 阻塞（与 lib 及 shell-parity 同口径）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-figma-component.mjs                 # 默认 http://127.0.0.1:3210/_design
 *   DF_WEB_URL=http://127.0.0.1:3000 node scripts/verify-figma-component.mjs
 *   node scripts/verify-figma-component.mjs --only button/primary/default --verbose
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
const TICKET = 'fe-01';
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

/** 页面现采的单元 id（`data-df-preview` 的值）；状态覆盖用**全量** ids，不受 `--only` 影响。 */
let allIds = [];

await runFigmaGate({
  gateName: 'verify-figma-component',
  ticket: TICKET,
  page: '/_design',
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
  stateCoverage: STATES.map((state) => ({ state, units: [], status: 'pending' })),
  recordKey: 'units',
  evidenceShape: 'unit',
  referenceDir: REF_DIR,
  evidenceRoot: EVIDENCE_ROOT,
  url: `${WEB_URL}/_design`,
  only,
  units: async (ctx) => {
    allIds = await ctx.page.$$eval('[data-df-preview]', (nodes) =>
      nodes.map((node) => node.getAttribute('data-df-preview') ?? '').filter((id) => id !== ''),
    );
    return allIds.map((id) => ({ id }));
  },
  capture: { kind: 'element', waitFor: '[data-df-preview]' },
  thresholds: { threshold: THRESHOLD, maxRatio },
  reference: {
    when: 'early',
    message: (_ctx, reference) => [
      '阻塞：REF-01 未完成（Figma 参照集未冻结）。',
      `原因：${reference.reason}`,
      '待办：冻结参照集后运行本门禁逐单元取证；在此之前任何「通过」都是假绿。',
    ],
    onBlocked: (ctx) => {
      ctx.evidence.units = [];
      ctx.evidence.stateCoverage = ctx.evidence.stateCoverage.map((item) => ({
        ...item,
        status: 'pending',
        note: 'REF-01（Figma 参照集冻结）未完成；本门禁按三态退出码记阻塞，禁止以近似图判绿。',
      }));
    },
  },
  probe: {
    url: `${WEB_URL}/_design`,
    mode: 'follow',
    reason: (_ctx, result) => `站点不可达：${WEB_URL}/_design（HTTP ${String(result.status)}）`,
    message: () => [
      '阻塞：预览站点不可达（本门禁需 `/_design` 可访问）。',
      '提示：先起站点（如 pnpm --filter @dforge/web build && pnpm --filter @dforge/web start），',
      '或设置 DF_WEB_URL 指向已运行实例。',
    ],
  },
  chrome: {},
  hooks: {
    // 取样单元的状态归口（与原实现同口径：按 id 后缀匹配六态，状态仍为 pending）。
    afterUnitsResolved: (ctx) => {
      ctx.evidence.stateCoverage = ctx.evidence.stateCoverage.map((item) => ({
        ...item,
        units: allIds.filter((id) => id.endsWith(`/${item.state}`)),
        status: 'pending',
        note: '有取样单元；待参照集冻结后逐单元出 A 级结论（缺项即缺陷）。',
      }));
    },
  },
  verbose,
  messages: {
    pass: (ctx) =>
      `通过：${String(ctx.targets.length)} 个单元全部在容差内（≤ ${(maxRatio * 100).toFixed(2)}%）。`,
    fail: (ctx) =>
      `违规：${String(ctx.failures)} 个单元超差或参照图缺失（逐单元明细见证据 JSON）。`,
  },
});
