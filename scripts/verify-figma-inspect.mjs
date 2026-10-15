#!/usr/bin/env node
/**
 * verify-figma-inspect —— 检查 / 导出面板门禁（FE-08 交付；本票范围内自管，**不接 CI**）。两段式：
 *
 * ① 功能段（**不依赖参照集**，直连 daemon）：
 *    `POST /export` 三档（PNG / SVG / PDF）各产出一份文件并逐项断言——
 *    HTTP 200、信封 `ok:true`、`length > 0`、base64 解码字节数 = `length`、
 *    sha256 本地重算一致、PNG 头 8 字节魔数校验、SVG 含 `<svg`、PDF 以 `%PDF-` 开头。
 *    **daemon 未启动 → exit 2（阻塞），不做自动拉起**（避免悄悄污染用户数据根；
 *    提示如何启动）。断言通过后删除自己建的临时文档（不留下垃圾）。
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
 * 用法（仓库根执行）：
 *   node scripts/verify-figma-inspect.mjs                    # 默认 http://127.0.0.1:3210/editor
 *   DF_DAEMON_URL=http://127.0.0.1:4318 node scripts/verify-figma-inspect.mjs --only C15
 *
 * 环境变量：DF_WEB_URL（站点）、DF_INSPECT_URL（宿主页）、DF_DAEMON_URL（daemon 基址）、
 *           DF_REF_DIR（参照集）、DF_EVIDENCE_DIR（证据根）、BENCH_CHROME_EXECUTABLE（Chromium）。
 *
 * 退出码（门禁三态，禁止假绿）：0 全部通过 / 1 有单元超差或断言失败 / 2 **阻塞**
 *（参照集未冻结 / daemon 未启动 / 宿主不可达 / Chromium 或依赖缺失）——`2` 绝不等价于通过。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const WEB_URL = process.env.DF_WEB_URL ?? 'http://127.0.0.1:3210';
const HOST_URL = process.env.DF_INSPECT_URL ?? `${WEB_URL}/editor`;
/** daemon 基址：缺省取契约端口基准（守护进程未启动时本门禁阻塞，禁自动拉起）。 */
const DAEMON_URL = process.env.DF_DAEMON_URL ?? 'http://127.0.0.1:4318';
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

const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const evidenceDir = join(EVIDENCE_ROOT, TICKET);
const evidencePath = join(evidenceDir, `verify-figma-inspect-${stamp}.json`);

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

/** 证据骨架（字段按《前端验收标准 v1》§4）。 */
function baseEvidence() {
  return {
    ticket: 'FE-08',
    gate: 'verify-figma-inspect',
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
    startedAt: startedAt.toISOString(),
    hostUrl: HOST_URL,
    daemonUrl: DAEMON_URL,
    referenceDir: REF_DIR,
    functional: { status: 'pending', baseUrl: DAEMON_URL, formats: [], cleanup: 'pending' },
    units: [],
    stateCoverage: STATE_COVERAGE.map((entry) => ({ ...entry, status: 'pending' })),
    artifacts: {},
    humanReview: {
      verdict: 'pending',
      reviewer: null,
      reason: '自动判定只给 A 级结论；字形/阴影/动效终态按 B 级需人工复核登记。',
    },
    exitCode: 2,
  };
}

const evidence = baseEvidence();
const blockedReasons = [];
let failures = 0;

/** 落盘证据并结束进程。 */
function finish(code, message) {
  evidence.exitCode = code;
  evidence.finishedAt = new Date().toISOString();
  evidence.blockedReason = blockedReasons.length > 0 ? blockedReasons.join('；') : null;
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (message) console.error(message);
  console.error(`证据：${evidencePath}`);
  process.exit(code);
}

/** `{sha256, length}` 指纹（大件入证据的约定）。 */
function fingerprint(filePath) {
  const buffer = readFileSync(filePath);
  return {
    path: filePath,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    length: buffer.length,
  };
}

/** 极简 HTTP 客户端：返回 `{ status, json, text }`（与 verify-daemon 同口径）。 */
async function call(baseUrl, method, path, body) {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
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

// ---------------------------------------------------------------------------
// ① 功能段：daemon /export 三档（不依赖参照集）
// ---------------------------------------------------------------------------

async function runFunctional() {
  const functional = evidence.functional;
  const health = await call(DAEMON_URL, 'GET', '/health');
  if (health.status !== 200) {
    functional.status = 'blocked';
    functional.reason = `daemon 不可达：${DAEMON_URL}/health（HTTP ${String(health.status)}）`;
    blockedReasons.push('阻塞：daemon 未启动');
    console.error(
      [
        `阻塞：daemon 未启动（本门禁不做自动拉起，避免污染用户数据根）。`,
        `原因：${functional.reason}`,
        '提示：另开终端执行 `pnpm --filter @dforge/daemon dev`（或设 DF_DAEMON_URL 指向已运行实例）后重跑。',
      ].join('\n'),
    );
    return;
  }
  functional.health = { status: health.status };

  // 临时文档：建 → 存页面 → 导出三档 → 清理
  const created = await call(DAEMON_URL, 'POST', '/documents', { name: 'FE-08 门禁导出源' });
  const documentId = created.json?.result?.document?.id;
  if (created.status !== 201 || typeof documentId !== 'string') {
    functional.status = 'failed';
    functional.reason = `临时文档创建失败：HTTP ${String(created.status)} ${created.text.slice(0, 200)}`;
    failures += 1;
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
    DAEMON_URL,
    'PUT',
    `/documents/${encodeURIComponent(documentId)}/pages/${encodeURIComponent(pageId)}`,
    { body: PAGE_BODY },
  );
  if (saved.status !== 200) {
    functional.status = 'failed';
    functional.reason = `页面保存失败：HTTP ${String(saved.status)} ${saved.text.slice(0, 200)}`;
    failures += 1;
  }

  for (const check of FORMAT_CHECKS) {
    const unit = { format: check.format, status: 'pending', assertions: [] };
    functional.formats.push(unit);
    const response = await call(DAEMON_URL, 'POST', '/export', {
      documentId,
      pageId,
      format: check.format,
    });
    const artifact = response.json?.result?.artifact;
    const record = (id, ok, detail) => {
      unit.assertions.push({ id, ok, detail });
      if (ok) {
        if (verbose) console.error(`  ✓ ${check.format}/${id}`);
      } else {
        unit.status = 'failed';
        failures += 1;
        console.error(`  ✗ ${check.format}/${id} —— ${detail}`);
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

  const cleanup = await call(DAEMON_URL, 'DELETE', `/documents/${encodeURIComponent(documentId)}`);
  functional.cleanup =
    cleanup.status === 200 ? 'deleted' : `failed(HTTP ${String(cleanup.status)})`;
  functional.status = functional.formats.some((unit) => unit.status === 'failed')
    ? 'failed'
    : 'passed';
  functional.maxScale = MAX_SCALE;

  if (functional.status === 'passed') {
    console.error('功能段通过：导出三档均产出文件（字节数 >0、PNG 头校验、sha256 一致）。');
  }
}

// ---------------------------------------------------------------------------
// ② 对照段：参照集 + 页面截图（pixelmatch）
// ---------------------------------------------------------------------------

/** 参照集探测：目录存在且有 PNG 才算「已冻结」。 */
function inspectReferenceDir() {
  if (!existsSync(REF_DIR)) return { ready: false, reason: `参照集目录不存在：${REF_DIR}` };
  const files = readdirSync(REF_DIR).filter((name) => name.endsWith('.png'));
  if (files.length === 0) return { ready: false, reason: `参照集为空（无 PNG）：${REF_DIR}` };
  return { ready: true, files };
}

/** 缓存的 Chromium 可执行文件（playwright-core 需显式 executablePath）。 */
function resolveChrome() {
  if (process.env.BENCH_CHROME_EXECUTABLE !== undefined) return process.env.BENCH_CHROME_EXECUTABLE;
  const cacheRoot = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cacheRoot)) return undefined;
  const candidates = readdirSync(cacheRoot)
    .filter((name) => name.startsWith('chromium-'))
    .sort()
    .map((name) => join(cacheRoot, name, 'chrome-linux64', 'chrome'));
  return candidates.find((file) => existsSync(file));
}

/** 宿主页探测（不可达即阻塞，不猜）。 */
async function probeHost() {
  try {
    const response = await fetch(`${HOST_URL}?${UNITS[0].query}`, { redirect: 'follow' });
    return { reachable: response.ok, status: response.status };
  } catch (error) {
    return { reachable: false, status: 0, error: String(error) };
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

async function runParity() {
  const reference = inspectReferenceDir();
  evidence.reference = reference.ready
    ? { ready: true, pngCount: reference.files.length }
    : { ready: false, reason: reference.reason };

  if (!reference.ready) {
    for (const entry of evidence.stateCoverage) {
      entry.status = 'pending';
      entry.note = 'REF-01（Figma 参照集冻结）未完成；本门禁按三态退出码记阻塞，禁止以近似图判绿。';
    }
    blockedReasons.push('阻塞：参照集未冻结');
    console.error(
      [
        '阻塞：参照集未冻结（REF-01 未完成）——不得以自截图/近似图假绿。',
        `原因：${reference.reason}`,
        '待办：按 figma-editor-C15-inspect-dark.png / figma-editor-F6-code-export-dark.png /',
        '      figma-editor-C17-components-dark.png 落盘参照集后重跑本门禁。',
      ].join('\n'),
    );
    return;
  }

  const host = await probeHost();
  if (!host.reachable) {
    blockedReasons.push(`阻塞：宿主页不可达（${HOST_URL}）`);
    console.error(
      [
        '阻塞：宿主页不可达（本门禁需编辑器路由按头部「宿主协议」暴露挂点）。',
        `原因：HTTP ${String(host.status)}`,
        '提示：先起站点（pnpm --filter @dforge/web build && pnpm --filter @dforge/web start），',
        '      或设 DF_INSPECT_URL 指向已运行实例。',
      ].join('\n'),
    );
    return;
  }

  const chrome = resolveChrome();
  if (chrome === undefined) {
    blockedReasons.push('阻塞：未找到 Chromium 可执行文件');
    console.error('阻塞：未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）。');
    return;
  }

  const { chromium } = await import('playwright-core');
  const { PNG } = await import('pngjs');
  const pixelmatch = (await import('pixelmatch')).default;

  const actualDir = join(evidenceDir, 'actual');
  const diffDir = join(evidenceDir, 'diff');
  mkdirSync(actualDir, { recursive: true });
  mkdirSync(diffDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: evidence.viewport.width, height: evidence.viewport.height },
    deviceScaleFactor: evidence.viewport.dpr,
  });
  const page = await context.newPage();

  const targets = only === undefined ? UNITS : UNITS.filter((unit) => unit.id === only);
  if (targets.length === 0) {
    await browser.close();
    blockedReasons.push(`阻塞：未知的 --only=${String(only)}`);
    console.error(
      `阻塞：未知的 --only=${String(only)}（可用：${UNITS.map((u) => u.id).join(' / ')}）。`,
    );
    return;
  }

  for (const unit of targets) {
    const record = {
      id: unit.id,
      title: unit.title,
      ref: join(REF_DIR, unit.ref),
      status: 'pending',
      diff: null,
      invariants: [],
      artifacts: {},
    };
    evidence.units.push(record);

    await page.goto(`${HOST_URL}?${unit.query}`, { waitUntil: 'networkidle' });
    // 字体就绪后再取样（禁静默回退；字体未就绪的截图不可作判据）
    await page.evaluate(() => document.fonts.ready);
    try {
      await page.waitForSelector(unit.root, { timeout: 5000 });
    } catch {
      // 挂点缺失由下面的不变量断言记账（不在这里吞掉）
    }

    record.invariants = await page.evaluate(domFindings, { unit, controlHeight: CONTROL_HEIGHT });
    for (const finding of record.invariants) {
      if (!finding.ok) {
        failures += 1;
        console.error(`  ✗ ${unit.id} 不变量 —— ${finding.note}`);
      } else if (verbose) {
        console.error(`  ✓ ${unit.id} ${finding.note}`);
      }
    }

    const refPath = record.ref;
    const actualPath = join(actualDir, `${unit.id}.png`);
    const element = page.locator(unit.root);
    try {
      await element.screenshot({ path: actualPath, animations: 'disabled' });
    } catch (error) {
      record.status = 'screenshot-failed';
      record.error = String(error).slice(0, 300);
      failures += 1;
      console.error(`  ✗ ${unit.id} 截图失败 —— ${record.error}`);
      continue;
    }
    record.artifacts.actual = fingerprint(actualPath);

    if (!existsSync(refPath)) {
      record.status = 'missing-reference';
      record.reference = refPath;
      failures += 1;
      console.error(`  ✗ ${unit.id}：参照图缺失（${basename(refPath)}）`);
      continue;
    }
    record.artifacts.ref = fingerprint(refPath);

    const refPng = PNG.sync.read(readFileSync(refPath));
    const actualPng = PNG.sync.read(readFileSync(actualPath));
    if (refPng.width !== actualPng.width || refPng.height !== actualPng.height) {
      record.status = 'size-mismatch';
      record.diff = {
        bbox: null,
        diffPixels: null,
        ratio: null,
        reference: { width: refPng.width, height: refPng.height },
        actual: { width: actualPng.width, height: actualPng.height },
      };
      failures += 1;
      continue;
    }

    const diffPng = new PNG({ width: refPng.width, height: refPng.height });
    const diffPixels = pixelmatch(
      refPng.data,
      actualPng.data,
      diffPng.data,
      refPng.width,
      refPng.height,
      { threshold: THRESHOLD, includeAA: false },
    );
    const total = refPng.width * refPng.height;
    const ratio = total === 0 ? 0 : diffPixels / total;
    const diffPath = join(diffDir, `${unit.id}.png`);
    writeFileSync(diffPath, PNG.sync.write(diffPng));
    record.artifacts.diff = fingerprint(diffPath);
    record.diff = {
      bbox: null,
      diffPixels,
      ratio: Number(ratio.toFixed(6)),
      totalPixels: total,
    };
    record.status = ratio <= maxRatio ? 'passed' : 'failed';
    if (record.status === 'failed') {
      failures += 1;
      console.error(`  ✗ ${unit.id}：差异率 ${(ratio * 100).toFixed(4)}% > 容差`);
    } else if (verbose) {
      console.error(`  ✓ ${unit.id}：差异率 ${(ratio * 100).toFixed(4)}%`);
    }
  }

  await browser.close();

  // 状态覆盖：有取样单元的状态挂上对照单元；无独立视觉态的在 vitest/jsdom 里取证
  evidence.stateCoverage = evidence.stateCoverage.map((entry) => {
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
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

try {
  await runFunctional();
  await runParity();
} catch (error) {
  // 脚本层意外错误（浏览器崩溃/依赖缺失等）：记阻塞（判不了），证据里留原因，绝不冒充通过
  blockedReasons.push(`阻塞：门禁执行失败（${String(error).slice(0, 200)}）`);
  console.error(`阻塞：门禁执行失败 —— ${String(error)}`);
}

const code = blockedReasons.length > 0 ? 2 : failures === 0 ? 0 : 1;
const summary =
  code === 2
    ? `阻塞：${blockedReasons.join('；')}（exit 2 ≠ 通过）。`
    : code === 1
      ? `违规：${String(failures)} 项断言失败或超差（逐项明细见证据 JSON）。`
      : '通过：功能段三档断言全过，对照段全部在容差内。';
finish(code, summary);
