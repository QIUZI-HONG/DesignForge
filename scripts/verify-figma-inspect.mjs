#!/usr/bin/env node
/**
 * verify-figma-inspect —— 检查 / 导出面板门禁（FE-08 交付；本票范围内自管，**不接 CI**）。两段式：
 *
 * ① 功能段（**不依赖参照集**，走 daemon HTTP）：
 *    `POST /export` 三档（PNG / SVG / PDF）各产出一份文件并逐项断言——
 *    HTTP 200、信封 `ok:true`、`length > 0`、base64 解码字节数 = `length`、
 *    sha256 本地重算一致、PNG 头 8 字节魔数校验、SVG 含 `<svg`、PDF 以 `%PDF-` 开头。
 *    **daemon 来源（arch-05 口径）**：显式 `DF_DAEMON_URL` → 用外部实例；未设 → 自起夹具
 *    daemon（临时数据根 + 空闲端口，见 `lib/daemon-fixture.mjs`），用完必停。
 *    夹具起不来 → exit 2 阻塞；**禁止缺省连开发机在跑的 daemon（4318）**。
 *    断言通过后删除自己建的临时文档（不留下垃圾）。
 *
 * ② 对照段（页面截图 + pixelmatch）：检查态与导出面板（C15 / F6）与组件面板（C17）逐单元比对。
 *    **无参照集 → exit 2 并打印「阻塞：参照集未冻结」**——禁止以自截图/近似图假绿。
 *    参照集契约（REF-01 冻结时按此落盘）：`<DF_REF_DIR>/figma-editor-C15-inspect-dark.png`、
 *    `figma-editor-F6-code-export-dark.png`、`figma-editor-C17-components-dark.png`
 *    （命名口径见研究 #2 §2.3；均为深色 UI3 基准页）。
 *
 * 宿主协议（编辑器路由，FE-06 接线；预设来源为这两个模块）：
 *   1. `?df-inspect=bound|unbound|empty` → `apps/web/src/features/inspect-export/preview.ts`
 *      的文档与选择集；`?df-components=plain|component|instance|variant|missing` →
 *      `apps/web/src/features/editor-components/preview.ts`；
 *   2. `<html data-theme="dark">`（验收标准 §3：编辑器族深色）；
 *   3. DOM 挂点（本脚本的不变量断言直接读它）：
 *      `[data-df-inspect="panel|properties|measurements|measurement|code-export|code|token-note-unbound|export-panel"]`、
 *      `[data-df-component="panel|badge|override-row|overrides-section|variant-select"]`。
 *   缺挂点 → 该单元判失败（1），宿主不可达 → exit 2（阻塞）。
 *
 * 取证实现统一在 `scripts/lib/figma-evidence.mjs`（arch-04）：本脚本只声明**单元表 + DOM
 * 不变量剧本 + 功能段**；`finish` 签名已从分叉的 `(code, message)` 统一为
 * `(evidence, code, message)`（阻塞原因按 `；` 合并入 `blockedReason`）。
 *
 * **语义变化（arch-04 登记）**：Chromium 解析统一走 `lib/browser-toolchain.mjs` 的
 * `resolveChromeExecutable()`，即 `BENCH_CHROME_EXECUTABLE` **存在才采用**。此前本门禁
 * 对非法 env 会带病进入浏览器阶段（稍后崩），现在直接 exit 2 阻塞（与 lib 及 shell-parity 同口径）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-figma-inspect.mjs                    # 站点默认 http://127.0.0.1:3210/editor；daemon 自起夹具
 *   DF_DAEMON_URL=http://127.0.0.1:5000 node scripts/verify-figma-inspect.mjs --only C15
 *
 * 环境变量：DF_WEB_URL（站点）、DF_INSPECT_URL（宿主页）、
 *           DF_DAEMON_URL（daemon 基址；缺省自起夹具，不设「本机缺省实例」）、
 *           DF_REF_DIR（参照集）、DF_EVIDENCE_DIR（证据根）、BENCH_CHROME_EXECUTABLE（Chromium）。
 *
 * 退出码（门禁三态，禁止假绿）：0 全部通过 / 1 有单元超差或断言失败 / 2 **阻塞**
 *（参照集未冻结 / daemon 不可达或夹具起不来 / 宿主不可达 / Chromium 或依赖缺失）——
 * `2` 绝不等价于通过。
 */
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { resolveDaemon } from './lib/daemon-fixture.mjs';
import { inspectReferenceDir, runFigmaGate } from './lib/figma-evidence.mjs';

const WEB_URL = process.env.DF_WEB_URL ?? 'http://127.0.0.1:3210';
const HOST_URL = process.env.DF_INSPECT_URL ?? `${WEB_URL}/editor`;
/**
 * daemon 基址**不设缺省值**：显式 `DF_DAEMON_URL` 才用外部实例；否则自起夹具
 * （见 `lib/daemon-fixture.mjs`）。禁止「缺省即连本机」（4318 = 开发机真实例端口窗起点）。
 */
let activeDaemon = null;
const REF_DIR = resolve(process.env.DF_REF_DIR ?? join(homedir(), 'df-evidence', 'reference-v1'));
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const TICKET = 'fe-08';
const THRESHOLD = 0.1;
/** 深色族控件高（清单 C5/C15 对标要点「控件 28」）。 */
const CONTROL_HEIGHT = 28;
/** 组件紫（清单 C4/C17：主↔实例提示 #9747FF 系）。 */
const COMPONENT_PURPLE = 'rgb(151, 71, 255)';
const MAX_SCALE = 4;

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = flagValue('--only');
const maxRatio = Number(flagValue('--max-ratio') ?? '0.001');

/** 导出功能段用的页面体（daemon 简化渲染子集：矩形 + 文本；来源形状见 daemon «最小场景» 文档）。 */
const PAGE_BODY = {
  width: 320,
  height: 200,
  background: '#1E1E1E',
  children: [
    { kind: 'rect', x: 24, y: 32, width: 240, height: 160, fill: '#0D99FF', cornerRadius: 8 },
    { kind: 'text', x: 24, y: 8, width: 200, height: 20, text: '设界导出', fontSize: 14 },
  ],
};

/** PNG 文件头（8 字节魔数）。 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 三档断言（功能段）。 */
const FORMAT_CHECKS = [
  { format: 'png', mimeType: 'image/png' },
  { format: 'svg', mimeType: 'image/svg+xml' },
  { format: 'pdf', mimeType: 'application/pdf' },
];

/** 对照单元（每单元 = 一个状态的一张参照图）。 */
const UNITS = [
  {
    id: 'C15',
    title: 'C15 检查 / 导出态（代码片段 + 测量标注）',
    query: 'df-inspect=bound',
    ref: 'figma-editor-C15-inspect-dark.png',
    root: '[data-df-inspect="panel"]',
    expect: {
      parts: ['properties', 'measurements', 'measurement', 'code-export', 'export-panel'],
      codeContains: '.df-node-card {',
      counters: [{ selector: '[data-df-inspect="measurement"]', min: 1 }],
      controlHeight: true,
      theme: 'dark',
    },
  },
  {
    id: 'F6',
    title: 'F6 代码导出面板（Token → CSS 变量说明 + 回退提示）',
    query: 'df-inspect=unbound',
    ref: 'figma-editor-F6-code-export-dark.png',
    root: '[data-df-inspect="code-export"]',
    expect: {
      parts: ['code-export', 'token-notes', 'token-note-unbound'],
      codeContains: '未绑定令牌',
      counters: [{ selector: '[data-df-inspect="token-note-unbound"]', min: 1 }],
      theme: 'dark',
    },
  },
  {
    id: 'C17',
    title: 'C17 组件创建 / 管理（主 ↔ 实例提示 + 覆盖清单）',
    query: 'df-components=instance',
    ref: 'figma-editor-C17-components-dark.png',
    root: '[data-df-component="panel"]',
    expect: {
      parts: ['overrides-section', 'override-row'],
      badgeKind: 'instance',
      badgeColor: COMPONENT_PURPLE,
      counters: [{ selector: '[data-df-component="override-row"]', min: 1 }],
      theme: 'dark',
    },
  },
];

/** 验收标准 §5 六态在本门禁面域上的挂点（每态都要有证据，不许缺项）。 */
const STATE_COVERAGE = [
  { state: 'hover', hook: '变体下拉 hover 底（.dfc-variants__control:hover）', via: 'screenshot' },
  {
    state: 'active',
    hook: '代码区 focus-visible 焦点环（.dfx-code__block:focus-visible）',
    via: 'screenshot',
  },
  {
    state: 'disabled',
    hook: '「创建组件」禁用 + 原因（[data-df-component="create-component"]，F15）',
    via: 'screenshot+dom',
  },
  {
    state: 'loading',
    hook: '导出按钮忙碌（[data-df-inspect="export-png"] aria-busy，F13）',
    via: 'dom',
  },
  {
    state: 'empty',
    hook: '检查态空选（?df-inspect=empty）与组件面板空选（?df-components=plain）',
    via: 'dom',
  },
  {
    state: 'error',
    hook: '导出失败态（[data-df-inspect="export-png-error"] role=alert，F14）',
    via: 'dom',
  },
];

/** 夹具 daemon 的本地令牌（audit-d02 · D-02；resolveDaemon 返回，非 /health 直连必带）。 */
let daemonToken = null;

/** 极简 HTTP 客户端：返回 `{ status, json, text }`（与 verify-daemon 同口径；有令牌自动携带）。 */
async function call(baseUrl, method, path, body) {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(daemonToken === null ? {} : { 'x-df-token': daemonToken }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  } catch (error) {
    return { status: 0, json: null, text: String(error) };
  }
}

/**
 * 功能段：daemon /export 三档（不依赖参照集）。
 * daemon 不可达 → 记阻塞原因并**继续**跑对照段（它会独立再给出参照集阻塞）。
 *
 * @param {object} ctx runFigmaGate 上下文
 * @param {string} daemonUrl 已解析的基址（外部实例或自起夹具）
 */
async function runFunctional(ctx, daemonUrl) {
  const functional = ctx.evidence.functional;
  const mode = ctx.evidence.daemon?.mode ?? 'fixture';
  const health = await call(daemonUrl, 'GET', '/health');
  if (health.status !== 200) {
    functional.status = 'blocked';
    functional.reason = `daemon 不可达：${daemonUrl}/health（HTTP ${String(health.status)}）`;
    ctx.block({
      reason: '阻塞：daemon 不可达',
      stop: false,
      message: [
        '阻塞：daemon 不可达（门禁不连开发机缺省实例；外部实例须显式、夹具须能起）。',
        `原因：${functional.reason}`,
        mode === 'external'
          ? '提示：确认 DF_DAEMON_URL 指向的实例在跑；或清空该变量让本门禁自起夹具 daemon。'
          : '提示：夹具 daemon 已自起但 health 不通，检查 daemon 启动输出与临时数据根权限。',
      ],
    });
    return;
  }
  functional.health = { status: health.status };

  // 临时文档：建 → 存页面 → 导出三档 → 清理
  const created = await call(daemonUrl, 'POST', '/documents', { name: 'FE-08 门禁导出源' });
  const documentId = created.json?.result?.document?.id;
  if (created.status !== 201 || typeof documentId !== 'string') {
    functional.status = 'failed';
    functional.reason = `临时文档创建失败：HTTP ${String(created.status)} ${created.text.slice(0, 200)}`;
    ctx.failures += 1;
    return;
  }
  functional.documentId = documentId;

  // 页面 id 取新建文档的清单页（daemon 建文档时自带一页；缺失才退回约定 id）
  const createdPages = created.json?.result?.document?.pages;
  const pageId =
    Array.isArray(createdPages) && typeof createdPages[0]?.id === 'string'
      ? createdPages[0].id
      : 'page-1';
  functional.pageId = pageId;
  const saved = await call(
    daemonUrl,
    'PUT',
    `/documents/${encodeURIComponent(documentId)}/pages/${encodeURIComponent(pageId)}`,
    { body: PAGE_BODY },
  );
  if (saved.status !== 200) {
    functional.status = 'failed';
    functional.reason = `页面保存失败：HTTP ${String(saved.status)} ${saved.text.slice(0, 200)}`;
    ctx.failures += 1;
  }

  for (const check of FORMAT_CHECKS) {
    const unit = { format: check.format, status: 'pending', assertions: [] };
    functional.formats.push(unit);
    const response = await call(daemonUrl, 'POST', '/export', {
      documentId,
      pageId,
      format: check.format,
    });
    const artifact = response.json?.result?.artifact;
    const record = (id, ok, detail) => {
      unit.assertions.push({ id, ok, detail });
      if (ok) {
        if (verbose) ctx.log(`  ✓ ${check.format}/${id}`);
      } else {
        unit.status = 'failed';
        ctx.failures += 1;
        ctx.log(`  ✗ ${check.format}/${id} —— ${detail}`);
      }
    };

    record('http-200', response.status === 200, `HTTP ${String(response.status)}`);
    record('envelope-ok', response.json?.ok === true, '信封 ok:true');
    if (artifact === undefined) {
      record('artifact', false, '响应缺 artifact');
      unit.status = 'failed';
      continue;
    }
    record(
      'mime-type',
      artifact.mimeType === check.mimeType,
      `mimeType=${String(artifact.mimeType)}`,
    );
    record(
      'length>0',
      typeof artifact.length === 'number' && artifact.length > 0,
      `length=${String(artifact.length)}`,
    );

    let bytes = Buffer.alloc(0);
    if (typeof artifact.base64 === 'string') {
      bytes = Buffer.from(artifact.base64, 'base64');
    }
    record(
      'bytes-match-length',
      bytes.length === artifact.length && bytes.length > 0,
      `解码字节 ${String(bytes.length)} vs length ${String(artifact.length)}`,
    );
    const sha = createHash('sha256').update(bytes).digest('hex');
    record('sha256-match', sha === artifact.sha256, `sha256 本地重算 ${sha.slice(0, 12)}…`);

    if (check.format === 'png') {
      record('png-magic', bytes.subarray(0, 8).equals(PNG_MAGIC), 'PNG 头 89 50 4E 47 0D 0A 1A 0A');
    }
    if (check.format === 'svg') {
      record('svg-root', bytes.toString('utf8').includes('<svg'), '含 <svg 根元素');
    }
    if (check.format === 'pdf') {
      record('pdf-magic', bytes.toString('latin1').startsWith('%PDF-'), '以 %PDF- 开头');
    }
    if (unit.status === 'pending') unit.status = 'passed';
  }

  const cleanup = await call(daemonUrl, 'DELETE', `/documents/${encodeURIComponent(documentId)}`);
  functional.cleanup =
    cleanup.status === 200 ? 'deleted' : `failed(HTTP ${String(cleanup.status)})`;
  functional.status = functional.formats.some((unit) => unit.status === 'failed')
    ? 'failed'
    : 'passed';
  functional.maxScale = MAX_SCALE;

  if (functional.status === 'passed') {
    ctx.log('功能段通过：导出三档均产出文件（字节数 >0、PNG 头校验、sha256 一致）。');
  }
}

/** 在浏览器里跑的 DOM 不变量检查（返回断言清单）。
 * 注意：本函数在**浏览器上下文**执行，只能依赖传入参数与浏览器全局（Node 侧常量必须显式传入）。 */
function domFindings(payload) {
  const { unit, controlHeight } = payload;
  const findings = [];
  const expect = unit.expect;
  const root = document.querySelector(unit.root);
  findings.push({ ok: root !== null, note: `宿主根 ${unit.root}` });
  for (const part of expect.parts ?? []) {
    const found = document.querySelector(
      `[data-df-inspect="${part}"], [data-df-component="${part}"]`,
    );
    findings.push({ ok: found !== null, note: `挂点 ${part}` });
  }
  for (const counter of expect.counters ?? []) {
    const count = document.querySelectorAll(counter.selector).length;
    findings.push({
      ok: count >= counter.min,
      note: `${counter.selector} ≥ ${counter.min}（实测 ${count}）`,
    });
  }
  if (expect.codeContains !== undefined) {
    // 限定在单元根内取代码区：多单元同页时不会串读别的单元
    const code = root?.querySelector('[data-df-inspect="code"]')?.textContent ?? '';
    findings.push({
      ok: code.includes(expect.codeContains),
      note: `代码含 ${expect.codeContains}`,
    });
  }
  if (expect.badgeKind !== undefined) {
    const badge = document.querySelector('[data-df-component="badge"]');
    findings.push({
      ok: badge?.getAttribute('data-df-kind') === expect.badgeKind,
      note: `徽标 data-df-kind=${expect.badgeKind}`,
    });
  }
  if (expect.badgeColor !== undefined) {
    const badge = document.querySelector('[data-df-component="badge"]');
    const color = badge === null ? '' : getComputedStyle(badge).color;
    findings.push({
      ok: color === expect.badgeColor,
      note: `徽标色 ${expect.badgeColor}（实测 ${color}）`,
    });
  }
  if (expect.controlHeight === true) {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue('--dfg-control-height-md')
      .trim();
    findings.push({ ok: value === `${controlHeight}px`, note: `控件高 token = ${value}` });
  }
  if (expect.theme !== undefined) {
    const theme = document.documentElement.dataset.theme ?? null;
    findings.push({ ok: theme === expect.theme, note: `data-theme=${expect.theme}` });
  }
  return findings;
}

await runFigmaGate({
  gateName: 'verify-figma-inspect',
  ticket: TICKET,
  page: '/editor（检查态 C15 / 代码导出 F6 / 组件 C17 · 深色 UI3）',
  level: 'A（布局/几何/尺寸/颜色；字形与阴影按 B 级人工复核）',
  params: {
    threshold: THRESHOLD,
    maxRatio,
    engine: 'pixelmatch@8.0.0',
    aaIgnore: true,
    controlHeight: CONTROL_HEIGHT,
    componentPurple: COMPONENT_PURPLE,
    engineVersionNote: '升级比对库 = 重定基线（研究 #5 §3.4）',
  },
  viewport: { width: 1440, height: 900, dpr: 1.5 },
  extras: {
    hostUrl: HOST_URL,
    // daemon 基址在 beforeReference 里解析后回填（显式外部 / 自起夹具；无缺省实例）。
    daemonUrl: null,
    daemon: { mode: 'pending', url: null },
    functional: { status: 'pending', baseUrl: null, formats: [], cleanup: 'pending' },
  },
  stateCoverage: STATE_COVERAGE.map((entry) => ({ ...entry, status: 'pending' })),
  recordKey: 'units',
  evidenceShape: 'inspect',
  referenceDir: REF_DIR,
  evidenceRoot: EVIDENCE_ROOT,
  url: HOST_URL,
  only,
  units: UNITS,
  capture: {
    kind: 'element',
    goto: false,
    perUnitGoto: true,
    fontsPerUnit: true,
    unitUrl: (unit) => `${HOST_URL}?${unit.query}`,
  },
  thresholds: { threshold: THRESHOLD, maxRatio },
  reference: {
    when: 'early',
    // 参照集未冻结 = 阻塞，但功能段原因继续累计（`blockedReason` 按 `；` 合并）。
    stop: false,
    skipUnitsOnBlock: true,
    reason: () => '阻塞：参照集未冻结',
    message: (_ctx, reference) => [
      '阻塞：参照集未冻结（REF-01 未完成）——不得以自截图/近似图假绿。',
      `原因：${reference.reason}`,
      '待办：按 figma-editor-C15-inspect-dark.png / figma-editor-F6-code-export-dark.png /',
      '      figma-editor-C17-components-dark.png 落盘参照集后重跑本门禁。',
    ],
    onBlocked: (ctx, reference) => {
      ctx.evidence.reference = { ready: false, reason: reference.reason };
      for (const entry of ctx.evidence.stateCoverage) {
        entry.status = 'pending';
        entry.note =
          'REF-01（Figma 参照集冻结）未完成；本门禁按三态退出码记阻塞，禁止以近似图判绿。';
      }
    },
  },
  probe: {
    url: `${HOST_URL}?${UNITS[0].query}`,
    mode: 'follow',
    stop: false,
    skipUnitsOnBlock: true,
    reason: () => `阻塞：宿主页不可达（${HOST_URL}）`,
    message: (_ctx, result) => [
      '阻塞：宿主页不可达（本门禁需编辑器路由按头部「宿主协议」暴露挂点）。',
      `原因：HTTP ${String(result.status)}`,
      '提示：先起站点（pnpm --filter @dforge/web build && pnpm --filter @dforge/web start），',
      '      或设 DF_INSPECT_URL 指向已运行实例。',
    ],
  },
  chrome: {
    stop: false,
    skipUnitsOnBlock: true,
    reason: () => '阻塞：未找到 Chromium 可执行文件',
    message: () => ['阻塞：未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）。'],
  },
  logFailures: true,
  logMissingReference: true,
  failLogSuffix: ' > 容差',
  blockedReason: 'joined',
  catchErrors: true,
  hooks: {
    // 功能段先跑（不依赖参照集；阻塞原因累计后继续）。
    beforeReference: async (ctx) => {
      // daemon 来源：显式 DF_DAEMON_URL → 外部实例；未设 → 自起夹具（无缺省实例、禁连 4318）。
      try {
        activeDaemon = await resolveDaemon({
          label: 'verify-figma-inspect',
          log: (line) => ctx.log(line),
        });
        daemonToken = activeDaemon.token;
      } catch (error) {
        ctx.evidence.daemon = { mode: 'fixture-failed', url: null };
        ctx.evidence.functional.status = 'blocked';
        ctx.evidence.functional.reason = String(error?.message ?? error).slice(0, 1000);
        ctx.block({
          reason: '阻塞：夹具 daemon 起不来',
          stop: true,
          message: [
            '阻塞：夹具 daemon 起不来（DF_DAEMON_URL 未设；门禁拒绝回退到本机缺省实例）。',
            `原因：${ctx.evidence.functional.reason}`,
            '口径：门禁要么显式 DF_DAEMON_URL 指向自管实例，要么自起夹具 daemon；',
            '      夹具起不来即 exit 2，不得降级为连接开发机在跑的 daemon。',
          ],
        });
        return;
      }
      ctx.evidence.daemon = { mode: activeDaemon.mode, url: activeDaemon.url };
      ctx.evidence.daemonUrl = activeDaemon.url;
      ctx.evidence.functional.baseUrl = activeDaemon.url;

      await runFunctional(ctx, activeDaemon.url);
      // 参照集落点也先记入证据（参照集判定随后由 module 执行）。
      const reference = inspectReferenceDir(REF_DIR);
      ctx.evidence.reference = reference.ready
        ? { ready: true, pngCount: reference.files.length }
        : { ready: false, reason: reference.reason };
    },
    // 每条出口（含早期阻塞）都回收夹具 daemon：进程组 SIGTERM → 端口释放核对 → 删临时数据根。
    cleanup: async () => {
      if (activeDaemon !== null) {
        await activeDaemon.close();
        activeDaemon = null;
      }
    },
    // DOM 不变量（每单元截图前）：缺挂点 = 失败（exit 1），但截图仍取（证据留档）。
    beforeCapture: async (ctx, { unit, record, page }) => {
      await page.waitForSelector(unit.root, { timeout: 5000 }).catch(() => null);
      record.invariants = await page.evaluate(domFindings, {
        unit,
        controlHeight: CONTROL_HEIGHT,
      });
      for (const finding of record.invariants) {
        if (!finding.ok) {
          ctx.failures += 1;
          ctx.log(`  ✗ ${unit.id} 不变量 —— ${finding.note}`);
        } else if (verbose) {
          ctx.log(`  ✓ ${unit.id} ${finding.note}`);
        }
      }
    },
    // 未知的 --only 在单元表解析后阻塞（原实现同口径：截图阶段前即返回）。
    afterUnitsResolved: (ctx) => {
      if (ctx.targets.length === 0) {
        ctx.block({
          reason: `阻塞：未知的 --only=${String(only)}`,
          message: `阻塞：未知的 --only=${String(only)}（可用：${UNITS.map((unit) => unit.id).join(
            ' / ',
          )}）。`,
        });
      }
    },
    afterUnits: (ctx) => {
      if (ctx.skipUnits || ctx.pendingFinish !== null) return;
      ctx.evidence.stateCoverage = ctx.evidence.stateCoverage.map((entry) => {
        if (entry.via === 'dom' || entry.via === 'screenshot+dom') {
          return {
            ...entry,
            status: 'covered-by-dom-assertions',
            note: '由本脚本的 DOM 不变量断言与 vitest 用例共同取证（见 units[].invariants）。',
          };
        }
        return {
          ...entry,
          status: 'pending-human-or-ref',
          note: '取终态截图对照（本段参照集冻结后纳入参照单元）。',
        };
      });
    },
  },
  verbose,
  messages: {
    blocked: (ctx) => `阻塞：${ctx.blockedReasons.join('；')}（exit 2 ≠ 通过）。`,
    fail: (ctx) => `违规：${String(ctx.failures)} 项断言失败或超差（逐项明细见证据 JSON）。`,
    pass: () => '通过：功能段三档断言全过，对照段全部在容差内。',
  },
});
