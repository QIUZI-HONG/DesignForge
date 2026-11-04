#!/usr/bin/env node
/**
 * verify-figma-inspector —— 页面级对照门禁（FE-05 交付；本票范围内自管，**不接 CI**）。
 *
 * 对照面：编辑器页的 Inspector 面板三态（清单 C5/C6/C7 · 深色 UI3）——
 *   ① 默认态（单选文本：六分区齐备）② 混选态（C6：混选「—」）③ 空选态（C7：画布设置）。
 * 参照集：`~/df-evidence/reference-v1/`（REF-01 冻结）中的三张对照图：
 *   `figma-editor-C5-inspector-dark-default.png` / `figma-editor-C6-inspector-dark-mixed.png`
 *   / `figma-editor-C7-canvas-settings-dark-empty.png`（命名口径见研究 #2 §2.3）。
 * 判定：pixelmatch 8.0.0（threshold 0.1，忽略抗锯齿）逐态比对，差异像素率 ≤ `--max-ratio`
 *   （默认 0.001，A 级 0.1%）；另有两类**功能性**断言（不依赖参照集）：
 *   - 结构不变量（DOM 级）：默认态六分区齐备（RW-10 分区口径：尺寸/填充/描边/圆角/效果/文字）/
 *     混选态字段显示「—」/ 空选态画布设置在场 / 控件高 = 28（深色族 `--dfg-control-height-md`）；
 *   - **提交时序**（300ms 语义）：连续输入后静默 300ms 只落**一条**命令，Esc 回滚零历史。
 *
 * 宿主协议（编辑器路由，FE-06 接线；`apps/web/src/features/inspector/preview.ts` 是预设来源）：
 *   1. `?df-state=default|mixed|empty` → 用 `previewSelection(state)` 作为选中集，
 *      `createPreviewDocument()` 作为文档，并把 `<html data-theme="dark">`；
 *   2. 暴露 `window.__dfInspectorProbe`：**对象挂点**（RW-04 起，见 canvas/register.tsx）——
 *      `{ undo: () => string[], redo: () => string[], node: (id) => Record<string, unknown> | undefined }`
 *      （读 CommandStack 历史与节点属性；门禁在页面内调用后取回普通数据）。
 *   缺任一项 → exit 2（阻塞：前置条件不成立，禁止假绿）。
 *
 * 取证实现统一在 `scripts/lib/figma-evidence.mjs`（arch-04）：本脚本只声明**状态单元表 +
 * DOM 不变量剧本 + 提交时序断言**。
 *
 * **语义变化（arch-04 登记）**：Chromium 解析统一走 `lib/browser-toolchain.mjs` 的
 * `resolveChromeExecutable()`，即 `BENCH_CHROME_EXECUTABLE` **存在才采用**。此前本门禁
 * 对非法 env 会带病进入浏览器阶段（稍后崩），现在直接 exit 2 阻塞（与 lib 及 shell-parity 同口径）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-figma-inspector.mjs                      # 默认 http://127.0.0.1:3210/editor
 *   DF_INSPECTOR_URL=http://127.0.0.1:3000/editor node scripts/verify-figma-inspector.mjs
 *   node scripts/verify-figma-inspector.mjs --state mixed --verbose
 *
 * 环境变量：DF_INSPECTOR_URL（宿主页）、DF_WEB_URL（站点前缀，默认 http://127.0.0.1:3210）、
 *           DF_REF_DIR（参照集）、DF_EVIDENCE_DIR（证据根）、BENCH_CHROME_EXECUTABLE（Chromium）、
 *           DF_INSPECTOR_NODE_ID（提交时序断言的目标节点 id，默认 pv_text）。
 *
 * 退出码（门禁三态，禁止假绿）：0 全部通过 / 1 有单元超差或不变量失败 / 2 **阻塞**
 * （参照集未冻结 / 站点不可达 / 宿主未按协议暴露 / Chromium 或依赖缺失）。
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { runFigmaGate } from './lib/figma-evidence.mjs';

const WEB_URL = process.env.DF_WEB_URL ?? 'http://127.0.0.1:3210';
const HOST_URL = process.env.DF_INSPECTOR_URL ?? `${WEB_URL}/editor`;
const REF_DIR = resolve(process.env.DF_REF_DIR ?? join(homedir(), 'df-evidence', 'reference-v1'));
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const TICKET = 'fe-05';
const THRESHOLD = 0.1;
const CONTROL_HEIGHT = 28; // 深色族「控件 28」（清单 C5）；来源 = --dfg-control-height-md
const COMMIT_WAIT_MS = 600; // > 300ms 提交窗口，留出渲染余量

/** 三态对照单元：状态名 → 参照图名 + 结构不变量。
 *  分区/字段 id 口径 = RW-10 重写后的实现（features/inspector/components/sections.tsx
 *  的 `data-df-inspector-section` / `data-df-inspector-field`），与
 *  InspectorPanel.test.tsx「折叠分区齐备」断言同源：默认态单选文本 → 六分区全开；
 *  混选态两个矩形 → 无文字分区；空选态画布设置无字段级挂点（只断根挂点）。 */
const STATES = [
  {
    state: 'default',
    title: 'C5 Inspector 默认态（单选文本：六分区齐备）',
    ref: 'figma-editor-C5-inspector-dark-default.png',
    expect: {
      sections: ['size', 'fill', 'stroke', 'corner', 'effects', 'text'],
      fields: [
        'x',
        'y',
        'width',
        'height',
        'rotation',
        'blendMode',
        'opacity',
        'fillColor',
        'fillOpacity',
        'strokeColor',
        'strokeWidth',
        'cornerRadius',
        'effects',
        'textAlign',
        'export',
      ],
    },
  },
  {
    state: 'mixed',
    title: 'C6 混选态（混合值显示「—」）',
    ref: 'figma-editor-C6-inspector-dark-mixed.png',
    expect: {
      sections: ['size', 'fill', 'stroke', 'corner', 'effects'],
      mixedFields: ['x'],
      singleFields: [{ field: 'width', value: '100' }],
    },
  },
  {
    state: 'empty',
    title: 'C7 空选态（画布设置）',
    ref: 'figma-editor-C7-canvas-settings-dark-empty.png',
    expect: {
      canvasSettings: true,
    },
  },
];

/** 验收标准 §5 六态在 Inspector 上的挂点（每态都要有证据，不许缺项）。 */
const STATE_COVERAGE = [
  { state: 'hover', hook: '对齐按钮 hover 底（.dfi-alignrow__button:hover）', via: 'screenshot' },
  {
    state: 'active',
    hook: '字段 focus-visible 焦点环（.dfi-numberfield:focus-within）',
    via: 'screenshot',
  },
  {
    state: 'disabled',
    hook: '导出禁用桩 [data-df-inspector-field="export"][data-df-state="disabled"]',
    via: 'dom',
  },
  { state: 'loading', hook: 'N/A：Inspector 无异步加载态（提交为同步命令）', via: 'n/a' },
  {
    state: 'empty',
    hook: '空选态画布设置 [data-df-inspector="canvas-settings"]',
    via: 'screenshot+dom',
  },
  { state: 'error', hook: '非法颜色回滚（jsdom 断言；无独立视觉态）', via: 'vitest' },
];

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = flagValue('--state');
const maxRatio = Number(flagValue('--max-ratio') ?? '0.001');

/** 提交时序断言的目标节点（默认 = 预览预设的文本节点；宿主换夹具时用环境变量覆盖）。 */
const PROBE_NODE_ID = process.env.DF_INSPECTOR_NODE_ID ?? 'pv_text';
const panelSelector = '[data-df-inspector="panel"], [data-df-inspector="canvas-settings"]';

/** 阻塞文案（统一形态：结论行 + 原因 + 可选提示；证据里的 blockedReason 只记原因）。 */
function blockedMessage(reason, hints = []) {
  return ['阻塞：前置条件不成立（exit 2 ≠ 通过）。', `原因：${reason}`, ...hints];
}

await runFigmaGate({
  gateName: 'verify-figma-inspector',
  ticket: TICKET,
  page: '/editor（Inspector 面板 · 深色 UI3）',
  level: 'A（布局/几何/尺寸/颜色；字形与阴影按 B 级人工复核）',
  params: {
    threshold: THRESHOLD,
    maxRatio,
    engine: 'pixelmatch@8.0.0',
    aaIgnore: true,
    controlHeight: CONTROL_HEIGHT,
    commitWindowMs: 300,
    engineVersionNote: '升级比对库 = 重定基线（研究 #5 §3.4）',
  },
  viewport: { width: 1440, height: 900, dpr: 1.5 },
  extras: { hostUrl: HOST_URL },
  trailingExtras: { functional: { status: 'pending', assertions: [] } },
  stateCoverage: STATE_COVERAGE.map((entry) => ({ ...entry, status: 'pending' })),
  recordKey: 'units',
  evidenceShape: 'inspector',
  referenceDir: REF_DIR,
  evidenceRoot: EVIDENCE_ROOT,
  url: HOST_URL,
  only,
  onlyKey: 'state',
  units: STATES,
  capture: {
    kind: 'element',
    goto: false,
    root: () => panelSelector,
    waitFor: panelSelector,
    perUnitGoto: true,
    fontsPerUnit: true,
    unitUrl: (unit) => `${HOST_URL}?df-state=${unit.state}`,
  },
  artifactName: (unit) => unit.state,
  thresholds: { threshold: THRESHOLD, maxRatio },
  reference: {
    when: 'early',
    reason: (_ctx, reference) => `参照集未冻结：${reference.reason}`,
    message: (_ctx, reference) =>
      blockedMessage(`参照集未冻结：${reference.reason}`, [
        '阻塞：参照集未冻结。',
        '待办：REF-01 冻结后，按 figma-editor-C5-inspector-dark-default.png /',
        '      figma-editor-C6-inspector-dark-mixed.png / figma-editor-C7-canvas-settings-dark-empty.png',
        '      放入参照集目录再运行本门禁；在此之前任何「通过」都是假绿。',
      ]),
    onBlocked: (ctx) => {
      ctx.evidence.stateCoverage = ctx.evidence.stateCoverage.map((entry) => ({
        ...entry,
        status: 'pending',
        note: 'REF-01（Figma 参照集冻结）未完成；本门禁按三态退出码记阻塞，禁止以近似图判绿。',
      }));
    },
  },
  probe: {
    url: `${HOST_URL}?df-state=default`,
    mode: 'follow',
    reason: (_ctx, result) => `宿主页不可达：${HOST_URL}（HTTP ${String(result.status)}）`,
    message: (_ctx, result) =>
      blockedMessage(`宿主页不可达：${HOST_URL}（HTTP ${String(result.status)}）`, [
        '提示：先起站点（如 pnpm --filter @dforge/web build && pnpm --filter @dforge/web start），',
        '并确保编辑器路由按本脚本头部「宿主协议」暴露 ?df-state= 与 window.__dfInspectorProbe。',
      ]),
  },
  chrome: {
    message: () =>
      blockedMessage('未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）', [
        '阻塞：未找到 Chromium 可执行文件（playwright-core 1.63 需显式 executablePath）。',
      ]),
  },
  hooks: {
    // 结构不变量（DOM 级）：任一不满足 → invariant-failed（失败，不取像素截图）。
    beforeCapture: async (ctx, { unit, record, page }) => {
      const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
      const findings = await page.evaluate(
        ({ selector, expect, controlHeight }) => {
          const list = [];
          const root = document.querySelector(selector);
          if (root === null) return [{ ok: false, note: `面板根未找到：${selector}` }];

          for (const id of expect.sections ?? []) {
            const found = document.querySelector(`[data-df-inspector-section="${id}"]`);
            list.push({ ok: found !== null, note: `分区 ${id}` });
          }
          for (const name of expect.fields ?? []) {
            const found = document.querySelector(`[data-df-inspector-field="${name}"]`);
            list.push({ ok: found !== null, note: `字段 ${name}` });
          }
          for (const name of expect.mixedFields ?? []) {
            const wrap = document.querySelector(`[data-df-inspector-field="${name}"]`);
            const input = wrap?.querySelector('input');
            list.push({
              ok: wrap?.getAttribute('data-df-state') === 'mixed' && input?.value === '—',
              note: `混选字段 ${name} 显示「—」`,
            });
          }
          for (const single of expect.singleFields ?? []) {
            const input = document
              .querySelector(`[data-df-inspector-field="${single.field}"]`)
              ?.querySelector('input');
            list.push({
              ok: input?.value === single.value,
              note: `一致字段 ${single.field} 显示实值 ${single.value}`,
            });
          }
          if (expect.canvasSettings === true) {
            const found = document.querySelector('[data-df-inspector="canvas-settings"]');
            list.push({ ok: found !== null, note: '画布设置在场' });
          }
          // 「控件 28」（深色族）：任取一个在场控件量高度（空选态画布设置无字段级挂点，跳过）
          const control = document.querySelector('[data-df-inspector-field="x"]');
          if (control !== null) {
            const height = Number.parseFloat(getComputedStyle(control).height);
            list.push({
              ok: Number.isFinite(height) && Math.abs(height - controlHeight) < 0.5,
              note: `控件高 ${height}（对标 ${controlHeight}）`,
            });
          }
          return list;
        },
        { selector: panelSelector, expect: unit.expect, controlHeight: CONTROL_HEIGHT },
      );

      record.invariants = findings;
      if (theme !== 'dark') {
        record.theme = theme;
        record.invariants.push({ ok: false, note: `页面主题应为 dark（当前 ${String(theme)}）` });
      }
      const bad = record.invariants.filter((item) => item.ok !== true);
      if (bad.length > 0) {
        record.status = 'invariant-failed';
        ctx.failures += 1;
        if (verbose) {
          for (const item of bad) ctx.log(`  ✗ ${unit.state}：${item.note}`);
        }
        return { skip: true };
      }
      return undefined;
    },
    // 单元表解析后：未知的 --state 直接阻塞（原实现同口径：截图前返回）。
    afterUnitsResolved: (ctx) => {
      if (ctx.targets.length === 0) {
        const reason = `未知的 --state=${String(only)}（可用：default / mixed / empty）`;
        ctx.block({ reason, message: blockedMessage(reason) });
      }
    },
    // 提交时序（300ms 语义；不依赖参照集）——需要页面仍打开，故在 afterUnitsWithPage 里跑。
    afterUnitsWithPage: async (ctx) => {
      if (only !== undefined && only !== 'default') return;
      const evidence = ctx.evidence;
      await ctx.page.goto(`${HOST_URL}?df-state=default`, { waitUntil: 'networkidle' });
      await ctx.page.waitForSelector('[data-df-inspector-field="x"]');

      // 探针协议（RW-04 起）：__dfInspectorProbe 是**对象挂点**（{undo(), redo(), node(id)}），
      // 在页面内调用后取回普通数据（page.evaluate 只序列化返回值）。
      const hasProbe = await ctx.page.evaluate(
        () =>
          typeof globalThis.__dfInspectorProbe === 'object' &&
          globalThis.__dfInspectorProbe !== null &&
          typeof globalThis.__dfInspectorProbe.undo === 'function' &&
          typeof globalThis.__dfInspectorProbe.node === 'function',
      );
      if (!hasProbe) {
        ctx.block({
          reason: '宿主页未暴露 window.__dfInspectorProbe（提交时序断言无法取证）',
          message: blockedMessage(
            '宿主页未暴露 window.__dfInspectorProbe（提交时序断言无法取证）',
            [
              '契约：window.__dfInspectorProbe = { undo: () => string[], redo: () => string[],',
              '  node: (id) => Record<string, unknown> | undefined }（对象挂点，非函数）；',
              'undo/redo 为 CommandStack.history() 的两个数组，node(id) 返回当前页面节点属性。',
              '见本脚本头部「宿主协议」第 2 条与 apps/web/src/features/canvas/register.tsx。',
            ],
          ),
        });
        return;
      }

      const readProbe = () =>
        ctx.page.evaluate(() => {
          const probe = globalThis.__dfInspectorProbe;
          return { undo: probe.undo(), redo: probe.redo() };
        });
      const readNode = (id) =>
        ctx.page.evaluate((nodeId) => globalThis.__dfInspectorProbe.node(nodeId), id);
      const before = await readProbe();
      const field = ctx.page.locator('[data-df-inspector-field="x"] input');

      // ① 连续输入 → 静默 300ms → 只落一条命令，且值为最后一次输入
      await field.click();
      await field.fill('1');
      await field.type('25');
      await ctx.page.waitForTimeout(COMMIT_WAIT_MS);
      const afterType = await readProbe();
      evidence.functional.assertions.push({
        name: '连续输入 300ms 后只提交一次',
        ok: afterType.undo.length === before.undo.length + 1,
        detail: { undoBefore: before.undo.length, undoAfter: afterType.undo.length },
      });
      evidence.functional.assertions.push({
        name: '提交值为最后一次输入（125）',
        ok: (await readNode(PROBE_NODE_ID))?.x === 125,
        detail: { x: (await readNode(PROBE_NODE_ID))?.x },
      });

      // ② Esc 回滚：不产生历史
      await field.fill('999');
      await field.press('Escape');
      await ctx.page.waitForTimeout(COMMIT_WAIT_MS);
      const afterEsc = await readProbe();
      const escNodeX = (await readNode(PROBE_NODE_ID))?.x;
      evidence.functional.assertions.push({
        name: 'Esc 回滚草稿（零历史、零副作用）',
        ok: afterEsc.undo.length === afterType.undo.length && escNodeX === 125,
        detail: {
          undo: afterEsc.undo.length,
          x: escNodeX,
        },
      });

      // ③ Enter 立即提交
      await field.fill('300');
      await field.press('Enter');
      const afterEnter = await readProbe();
      const enterNodeX = (await readNode(PROBE_NODE_ID))?.x;
      evidence.functional.assertions.push({
        name: 'Enter 立即提交（无需等待 300ms）',
        ok: afterEnter.undo.length === afterEsc.undo.length + 1 && enterNodeX === 300,
        detail: { undo: afterEnter.undo.length, x: enterNodeX },
      });

      const functionalFailed = evidence.functional.assertions.filter((item) => item.ok !== true);
      evidence.functional.status = functionalFailed.length === 0 ? 'pass' : 'fail';
      if (functionalFailed.length > 0) ctx.failures += 1;
    },
    afterUnits: (ctx) => {
      if (ctx.skipUnits || ctx.pendingFinish !== null) return;
      ctx.evidence.stateCoverage = STATE_COVERAGE.map((entry) => ({
        ...entry,
        status: entry.via === 'n/a' ? 'n/a' : ctx.failures === 0 ? 'covered' : 'pending',
      }));
    },
  },
  verbose,
  messages: {
    pass: (ctx) =>
      `通过：${String(ctx.evidence.units.length)} 个对照态在容差内，且提交时序断言全过。`,
    fail: (ctx) => `违规：${String(ctx.failures)} 项超差/不变量失败（逐项明细见证据 JSON）。`,
  },
});
